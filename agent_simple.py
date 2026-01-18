import asyncio
import logging
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.plugins import deepgram, openai, silero
from dotenv import load_dotenv
import os
import json
from datetime import datetime

load_dotenv()

logger = logging.getLogger("medical-note-agent")
logger.setLevel(logging.INFO)


class MedicalNoteAgent:
    def __init__(self, ctx: JobContext):
        self.ctx = ctx
        self.transcription_buffer = []
        self.notes = ""
        self.llm = openai.LLM(model="gpt-4o-mini")
        
    async def start(self):
        logger.info("Medical Note Agent starting...")
        
        # Wait for participant
        participant = await self.ctx.wait_for_participant()
        logger.info(f"Participant joined: {participant.identity}")
        
        # Set up STT and voice pipeline
        stt = deepgram.STT(model="nova-2-medical")
        
        # Create voice assistant
        assistant = agents.VoiceAssistant(
            vad=silero.VAD.load(),
            stt=stt,
            llm=self.llm,
            fnc_ctx=None,
        )
        
        # Start the assistant
        assistant.start(self.ctx.room)
        
        # Listen to assistant speech events
        @assistant.on("agent_speech_committed")
        def on_agent_speech(msg: agents.llm.LLMStream):
            asyncio.create_task(self._handle_speech(msg))
        
        # Keep agent running
        await asyncio.sleep(float('inf'))
    
    async def _handle_speech(self, msg):
        """Handle speech from the assistant"""
        try:
            # Collect the full message
            full_text = ""
            async for chunk in msg:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        full_text += delta.content
            
            # Buffer transcription
            self.transcription_buffer.append(full_text)
            
            # Send transcription to frontend
            await self._send_transcription(full_text)
            
            # Generate notes every 5 messages
            if len(self.transcription_buffer) >= 5:
                await self._generate_notes()
                
        except Exception as e:
            logger.error(f"Error handling speech: {e}")
    
    async def _send_transcription(self, text: str):
        """Send transcription to frontend via Data Channel"""
        try:
            data = json.dumps({
                "type": "transcription",
                "content": text,
                "timestamp": datetime.now().isoformat()
            })
            
            await self.ctx.room.local_participant.publish_data(
                data.encode('utf-8'),
                reliable=True
            )
            
            logger.info(f"Sent transcription: {text[:100]}...")
            
        except Exception as e:
            logger.error(f"Error sending transcription: {e}")
    
    async def _generate_notes(self):
        """Generate SOAP notes from transcription buffer"""
        try:
            # Create prompt
            transcript = "\n".join(self.transcription_buffer)
            prompt = f"""Based on this medical conversation, generate structured SOAP notes:

{transcript}

Format as:
## Subjective
- [patient complaints and symptoms]

## Objective
- [observable findings]

## Assessment
- [diagnosis or differential]

## Plan
- [treatment plan]
"""
            
            # Get response from LLM
            response = await self.llm.chat(
                chat_ctx=agents.llm.ChatContext().append(
                    role="system",
                    text="You are a medical AI assistant."
                ).append(
                    role="user",
                    text=prompt
                )
            )
            
            # Collect response
            notes_text = ""
            async for chunk in response:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        notes_text += delta.content
            
            self.notes = notes_text
            
            # Send to frontend
            await self._send_notes(notes_text)
            
            # Clear buffer
            self.transcription_buffer = []
            
        except Exception as e:
            logger.error(f"Error generating notes: {e}")
    
    async def _send_notes(self, notes: str):
        """Send notes to frontend"""
        try:
            data = json.dumps({
                "type": "notes",
                "content": notes,
                "timestamp": datetime.now().isoformat()
            })
            
            await self.ctx.room.local_participant.publish_data(
                data.encode('utf-8'),
                reliable=True
            )
            
            logger.info("Sent SOAP notes to frontend")
            
        except Exception as e:
            logger.error(f"Error sending notes: {e}")


async def entrypoint(ctx: JobContext):
    """Agent entrypoint"""
    logger.info(f"Starting agent for room: {ctx.room.name}")
    
    agent = MedicalNoteAgent(ctx)
    await agent.start()


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
        )
    )
