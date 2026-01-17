"""
Medical Triage LiveKit Agent

Responsibilities:
- Handle participant joining
- Audio ↔ Text conversion (STT/TTS)
- Forward conversation data to LLM backend for classification
- Trigger emergency alerts (call + SMS via Twilio) when emergency confirmed
"""

import asyncio
import aiohttp
import logging
import os
import json
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
from pathlib import Path

from livekit import rtc, api
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    RoomInputOptions,
    RunContext,
    WorkerOptions,
    cli,
)
from livekit.agents.llm import function_tool
from livekit.plugins import deepgram, cartesia, silero
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

logger = logging.getLogger("medical-triage-agent")
logger.setLevel(logging.INFO)


# Configuration
@dataclass
class Config:
    # LLM Backend API
    llm_backend_url: str = os.getenv("LLM_BACKEND_URL", "http://localhost:8000")
    classification_endpoint: str = "/api/classify"
    council_endpoint: str = "/api/council"
    
    # Room Manager API (for Twilio alerts)
    room_manager_url: str = os.getenv("ROOM_MANAGER_URL", "http://localhost:8080")
    emergency_alert_endpoint: str = "/session/emergency-alert"
    
    # Thresholds
    emergency_categories: list = field(default_factory=lambda: ["CRITICAL", "EMERGENCY"])


config = Config()


@dataclass
class SessionState:
    """Tracks the state of a patient session"""
    room_name: Optional[str] = None
    patient_id: Optional[str] = None
    location: Optional[str] = None
    conversation_history: list = field(default_factory=list)
    current_image: Optional[str] = None
    session_start: datetime = field(default_factory=datetime.now)
    is_emergency: bool = False
    emergency_confirmed: bool = False
    alerts_triggered: bool = False
    council_response: Optional[dict] = None


class MedicalTriageAgent(Agent):
    """
    LiveKit Agent for medical triage.
    
    Handles:
    - Speech-to-text conversion of patient input
    - Forwarding to LLM backend for classification/conversation
    - Text-to-speech for responses
    - Triggering emergency alerts (call + SMS) via Twilio
    """
    
    def __init__(self) -> None:
        super().__init__(
            instructions="""You are a medical triage assistant. 
            Your role is to relay responses from the medical AI system.
            Speak clearly and calmly. For emergencies, speak with appropriate urgency."""
        )
        self.session_state = SessionState()
        self.http_session: Optional[aiohttp.ClientSession] = None
    
    async def on_enter(self) -> None:
        """Called when agent joins the room"""
        self.http_session = aiohttp.ClientSession()
        logger.info(f"Agent entered room, session started at {self.session_state.session_start}")
    
    async def on_exit(self) -> None:
        """Called when agent leaves the room"""
        if self.http_session:
            await self.http_session.close()
        logger.info(f"Agent exited room, session ended for patient {self.session_state.patient_id}")
    
    async def on_user_turn_completed(
        self, 
        turn_ctx: RunContext, 
        new_message: str
    ) -> Optional[str]:
        """
        Called when the user finishes speaking.
        
        Flow:
        1. Add user message to conversation history
        2. Send to LLM backend for classification
        3. If emergency → trigger council → send alerts (call + SMS)
        4. Return response for TTS
        """
        if not new_message.strip():
            return None
        
        # Add to conversation history
        self.session_state.conversation_history.append({
            "human": new_message,
            "assistant": None
        })
        
        try:
            # Prepare payload for LLM backend
            payload = self._build_llm_payload()
            
            # Step 1: Get classification from Gemini
            classification = await self._classify_message(payload)
            
            if classification.get("category") in config.emergency_categories:
                # Step 2: Emergency detected - invoke council for confirmation
                logger.warning(f"Emergency detected for patient {self.session_state.patient_id}")
                self.session_state.is_emergency = True
                
                council_response = await self._invoke_council(payload)
                self.session_state.council_response = council_response
                
                # Check if council confirms emergency
                if self._council_confirms_emergency(council_response):
                    self.session_state.emergency_confirmed = True
                    
                    # Step 3: Trigger alerts (call + SMS via Twilio)
                    await self._trigger_emergency_alerts(council_response)
                    
                    response_text = council_response.get("response", 
                        "This is an emergency. I'm alerting medical staff right now. "
                        "Help is on the way. Please stay calm and stay where you are.")
                else:
                    # Council didn't confirm - downgrade
                    logger.info("Council did not confirm emergency")
                    self.session_state.is_emergency = False
                    response_text = council_response.get("response",
                        "After careful review, your symptoms need attention but may not be immediately critical. "
                        "Please monitor your condition and seek medical care soon.")
            else:
                # Not emergency - continue conversation
                response_text = classification.get("response", 
                    "I understand. Can you tell me more about your symptoms?")
            
            # Update conversation history with response
            if self.session_state.conversation_history:
                self.session_state.conversation_history[-1]["assistant"] = response_text
            
            return response_text
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            return "I'm having trouble processing that. Could you please repeat?"
    
    def _build_llm_payload(self) -> dict:
        """Build the payload to send to LLM backend"""
        formatted_history = []
        for turn in self.session_state.conversation_history:
            if turn.get("assistant") and turn.get("human"):
                formatted_history.append({
                    "assistant": turn["assistant"],
                    "human": turn["human"]
                })
            elif turn.get("human"):
                formatted_history.append({
                    "assistant": "",
                    "human": turn["human"]
                })
        
        payload = {
            "text": formatted_history,
            "patient_id": self.session_state.patient_id or "UNKNOWN",
            "location": self.session_state.location or "UNKNOWN",
        }
        
        if self.session_state.current_image:
            payload["image"] = self.session_state.current_image
        
        return payload
    
    async def _classify_message(self, payload: dict) -> dict:
        """Send to Gemini for initial classification"""
        url = f"{config.llm_backend_url}{config.classification_endpoint}"
        
        try:
            async with self.http_session.post(url, json=payload) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    logger.error(f"Classification API error: {response.status}")
                    return {"category": "UNKNOWN", "response": "Could you describe your symptoms?"}
        except Exception as e:
            logger.error(f"Classification request failed: {e}")
            return {"category": "UNKNOWN", "response": "Could you describe your symptoms?"}
    
    async def _invoke_council(self, payload: dict) -> dict:
        """Invoke the LLM council for emergency confirmation"""
        url = f"{config.llm_backend_url}{config.council_endpoint}"
        
        try:
            async with self.http_session.post(url, json=payload) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    logger.error(f"Council API error: {response.status}")
                    return {
                        "response": "Emergency help is being alerted. Please stay calm.",
                        "urgency": "HIGH",
                        "confidence": 0.8
                    }
        except Exception as e:
            logger.error(f"Council request failed: {e}")
            return {
                "response": "Emergency help is being alerted. Please stay calm.",
                "urgency": "HIGH",
                "confidence": 0.8
            }
    
    def _council_confirms_emergency(self, council_response: dict) -> bool:
        """
        Determine if council confirms the emergency.
        Logic: Majority vote with HIGH urgency or average confidence > 0.85
        """
        votes = council_response.get("council_votes", {})
        if not votes:
            return council_response.get("urgency") == "HIGH"
        
        high_votes = sum(1 for v in votes.values() if v.get("urgency") == "HIGH")
        total_votes = len(votes)
        
        if high_votes > total_votes / 2:
            return True
        
        avg_confidence = sum(v.get("confidence", 0) for v in votes.values()) / total_votes
        return avg_confidence > 0.85
    
    async def _trigger_emergency_alerts(self, council_response: dict) -> None:
        """Trigger emergency alerts (call + SMS) via Room Manager / Twilio"""
        
        if self.session_state.alerts_triggered:
            logger.info("Alerts already triggered for this session")
            return
        
        if not self.session_state.room_name:
            logger.error("Cannot trigger alerts: room_name not set")
            return
        
        url = f"{config.room_manager_url}{config.emergency_alert_endpoint}"
        
        alert_payload = {
            "room_name": self.session_state.room_name,
            "assessment": council_response.get("response", "Medical emergency detected"),
            "urgency": council_response.get("urgency", "HIGH"),
            "send_sms": True,
            "make_call": True
        }
        
        try:
            async with self.http_session.post(url, json=alert_payload) as response:
                if response.status == 200:
                    result = await response.json()
                    self.session_state.alerts_triggered = True
                    logger.info(f"Emergency alerts triggered: {result}")
                else:
                    error_text = await response.text()
                    logger.error(f"Alert API error: {response.status} - {error_text}")
        except Exception as e:
            logger.error(f"Alert request failed: {e}")
    
    @function_tool
    async def set_session_info(
        self,
        room_name: str,
        patient_id: str,
        location: str,
        image_base64: Optional[str] = None
    ) -> str:
        """Set session information when agent joins a room."""
        self.session_state.room_name = room_name
        self.session_state.patient_id = patient_id
        self.session_state.location = location
        if image_base64:
            self.session_state.current_image = image_base64
        
        logger.info(f"Session info set: room={room_name}, patient={patient_id}")
        return f"Session initialized for patient {patient_id}"
    
    @function_tool
    async def update_image(self, image_base64: str) -> str:
        """Update the current image for visual assessment."""
        self.session_state.current_image = image_base64
        return "Image updated"
    
    @function_tool
    async def get_session_status(self) -> str:
        """Get current session status"""
        return json.dumps({
            "room_name": self.session_state.room_name,
            "patient_id": self.session_state.patient_id,
            "location": self.session_state.location,
            "is_emergency": self.session_state.is_emergency,
            "emergency_confirmed": self.session_state.emergency_confirmed,
            "alerts_triggered": self.session_state.alerts_triggered,
            "conversation_turns": len(self.session_state.conversation_history)
        })


def prewarm(proc: JobProcess) -> None:
    """Preload models for faster startup"""
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext) -> None:
    """Main entry point for the agent"""
    await ctx.connect()
    
    room_name = ctx.room.name
    logger.info(f"Connected to room: {room_name}")
    
    # Parse room metadata for patient info
    patient_id = "UNKNOWN"
    location = "UNKNOWN"
    
    try:
        if ctx.room.metadata:
            metadata = json.loads(ctx.room.metadata)
            patient_id = metadata.get("patient_id", "UNKNOWN")
            location = metadata.get("location", "UNKNOWN")
    except Exception as e:
        logger.warning(f"Could not parse room metadata: {e}")
    
    # Create the agent
    agent = MedicalTriageAgent()
    
    # Set session info from room
    agent.session_state.room_name = room_name
    agent.session_state.patient_id = patient_id
    agent.session_state.location = location
    
    # Configure audio input/output
    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(),
        tts=cartesia.TTS(),
        llm=None,  # We handle LLM calls manually
    )
    
    # Start the agent session
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(),
    )
    
    # Initial greeting
    await session.say(
        "Hello, I'm your medical assistant. How can I help you today?",
        allow_interruptions=True
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        ),
    )