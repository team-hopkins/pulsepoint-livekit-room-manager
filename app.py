"""
Medical Triage LiveKit Agent

Responsibilities:
- Create/destroy LiveKit rooms based on hardware session flags
- Handle participant joining
- Audio ↔ Text conversion (STT/TTS)
- Forward conversation data to LLM backend for classification
- Send SMS alerts when emergency is confirmed by council
"""

import asyncio
import aiohttp
import logging
import os
import json
import base64
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

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

logger = logging.getLogger("medical-triage-agent")
logger.setLevel(logging.INFO)


# Configuration
@dataclass
class Config:
    # LLM Backend API
    llm_backend_url: str = os.getenv("LLM_BACKEND_URL", "http://localhost:8000")
    classification_endpoint: str = "/api/classify"
    conversation_endpoint: str = "/api/conversation"
    council_endpoint: str = "/api/council"
    
    # SMS Service
    sms_service_url: str = os.getenv("SMS_SERVICE_URL", "http://localhost:8001")
    sms_endpoint: str = "/api/send-sms"
    
    # Emergency contacts (could be fetched per patient)
    default_emergency_contacts: list = field(default_factory=lambda: [
        os.getenv("EMERGENCY_CONTACT_1", "+1234567890"),
    ])
    
    # Thresholds
    emergency_categories: list = field(default_factory=lambda: ["CRITICAL", "EMERGENCY"])
    

config = Config()


@dataclass
class SessionState:
    """Tracks the state of a patient session"""
    patient_id: Optional[str] = None
    location: Optional[str] = None
    conversation_history: list = field(default_factory=list)
    current_image: Optional[str] = None  # Base64 encoded
    session_start: datetime = field(default_factory=datetime.now)
    is_emergency: bool = False
    emergency_confirmed: bool = False
    council_response: Optional[dict] = None


class MedicalTriageAgent(Agent):
    """
    LiveKit Agent for medical triage.
    
    Handles:
    - Speech-to-text conversion of patient input
    - Forwarding to LLM backend for classification/conversation
    - Text-to-speech for responses
    - SMS alerts for emergencies
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
        3. If emergency → trigger council → send SMS
        4. Return response for TTS
        """
        if not new_message.strip():
            return None
        
        # Add to conversation history
        self.session_state.conversation_history.append({
            "human": new_message,
            "assistant": None  # Will be filled with response
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
                
                # Check if council confirms emergency (majority vote or threshold)
                if self._council_confirms_emergency(council_response):
                    self.session_state.emergency_confirmed = True
                    
                    # Step 3: Send SMS alert
                    await self._send_emergency_sms(council_response)
                    
                    response_text = council_response.get("response", 
                        "This is an emergency. Help is being dispatched. Please stay calm.")
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
        # Format conversation history as expected by backend
        formatted_history = []
        for turn in self.session_state.conversation_history:
            if turn.get("assistant") and turn.get("human"):
                formatted_history.append({
                    "assistant": turn["assistant"],
                    "human": turn["human"]
                })
            elif turn.get("human"):
                # Current turn - human spoke but no assistant response yet
                formatted_history.append({
                    "assistant": "",  # Placeholder
                    "human": turn["human"]
                })
        
        payload = {
            "text": formatted_history,
            "patient_id": self.session_state.patient_id or "UNKNOWN",
            "location": self.session_state.location or "UNKNOWN",
        }
        
        # Include image if available
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
                    # Fail safe - treat as confirmed emergency
                    return {
                        "response": "Emergency services have been notified. Please stay calm.",
                        "urgency": "HIGH",
                        "confidence": 0.8
                    }
        except Exception as e:
            logger.error(f"Council request failed: {e}")
            return {
                "response": "Emergency services have been notified. Please stay calm.",
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
            # No votes - use top-level urgency
            return council_response.get("urgency") == "HIGH"
        
        high_votes = sum(1 for v in votes.values() if v.get("urgency") == "HIGH")
        total_votes = len(votes)
        
        # Majority rule
        if high_votes > total_votes / 2:
            return True
        
        # Or high average confidence
        avg_confidence = sum(v.get("confidence", 0) for v in votes.values()) / total_votes
        return avg_confidence > 0.85
    
    async def _send_emergency_sms(self, council_response: dict) -> None:
        """Send SMS alert for confirmed emergency"""
        url = f"{config.sms_service_url}{config.sms_endpoint}"
        
        sms_payload = {
            "patient_id": self.session_state.patient_id,
            "location": self.session_state.location,
            "urgency": council_response.get("urgency", "HIGH"),
            "assessment": council_response.get("response", "Emergency detected"),
            "confidence": council_response.get("confidence", 0.9),
            "council_votes": council_response.get("council_votes", {}),
            "trace_id": council_response.get("trace_id"),
            "contacts": config.default_emergency_contacts,
            "timestamp": datetime.now().isoformat()
        }
        
        try:
            async with self.http_session.post(url, json=sms_payload) as response:
                if response.status == 200:
                    logger.info(f"SMS sent successfully for patient {self.session_state.patient_id}")
                else:
                    logger.error(f"SMS API error: {response.status}")
        except Exception as e:
            logger.error(f"SMS request failed: {e}")
    
    # Tools for session management (called from hardware signals)
    @function_tool
    async def set_patient_info(
        self,
        patient_id: str,
        location: str,
        image_base64: Optional[str] = None
    ) -> str:
        """
        Set patient information for the session.
        Called when hardware initiates a session.
        
        Args:
            patient_id: The patient's ID
            location: Station/location identifier
            image_base64: Optional base64 encoded image from camera
        """
        self.session_state.patient_id = patient_id
        self.session_state.location = location
        if image_base64:
            self.session_state.current_image = image_base64
        
        logger.info(f"Patient info set: {patient_id} at {location}")
        return f"Session initialized for patient {patient_id}"
    
    @function_tool
    async def update_image(self, image_base64: str) -> str:
        """
        Update the current image for visual assessment.
        Called when hardware sends new camera frame.
        
        Args:
            image_base64: Base64 encoded image data
        """
        self.session_state.current_image = image_base64
        return "Image updated"
    
    @function_tool
    async def end_session(self) -> str:
        """
        End the current patient session.
        Called when hardware signals session end (flag off).
        """
        patient_id = self.session_state.patient_id
        
        # Log session summary
        logger.info(f"Session ended for {patient_id}: "
                   f"Emergency={self.session_state.is_emergency}, "
                   f"Confirmed={self.session_state.emergency_confirmed}, "
                   f"Turns={len(self.session_state.conversation_history)}")
        
        # Reset state for next session
        self.session_state = SessionState()
        
        return f"Session ended for patient {patient_id}"


# Room management functions
async def create_room(room_name: str) -> dict:
    """Create a new LiveKit room for a hardware session"""
    livekit_api = api.LiveKitAPI(
        url=os.getenv("LIVEKIT_URL", "ws://localhost:7880"),
        api_key=os.getenv("LIVEKIT_API_KEY"),
        api_secret=os.getenv("LIVEKIT_API_SECRET"),
    )
    
    try:
        room = await livekit_api.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                empty_timeout=300,  # 5 minutes
                max_participants=3,  # Hardware + Agent + optional observer
            )
        )
        logger.info(f"Room created: {room_name}")
        return {"status": "created", "room": room_name}
    except Exception as e:
        logger.error(f"Failed to create room {room_name}: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        await livekit_api.aclose()


async def delete_room(room_name: str) -> dict:
    """Delete a LiveKit room when hardware session ends"""
    livekit_api = api.LiveKitAPI(
        url=os.getenv("LIVEKIT_URL", "ws://localhost:7880"),
        api_key=os.getenv("LIVEKIT_API_KEY"),
        api_secret=os.getenv("LIVEKIT_API_SECRET"),
    )
    
    try:
        await livekit_api.room.delete_room(
            api.DeleteRoomRequest(room=room_name)
        )
        logger.info(f"Room deleted: {room_name}")
        return {"status": "deleted", "room": room_name}
    except Exception as e:
        logger.error(f"Failed to delete room {room_name}: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        await livekit_api.aclose()


def prewarm(proc: JobProcess) -> None:
    """Preload models for faster startup"""
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext) -> None:
    """Main entry point for the agent"""
    await ctx.connect()
    
    logger.info(f"Connected to room: {ctx.room.name}")
    
    # Create the agent
    agent = MedicalTriageAgent()
    
    # Configure audio input/output
    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        stt=deepgram.STT(),  # Speech-to-text
        tts=cartesia.TTS(),  # Text-to-speech
        llm=None,  # We handle LLM calls manually through HTTP
    )
    
    # Start the agent session
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(
            # Subscribe to audio from hardware participant
        ),
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