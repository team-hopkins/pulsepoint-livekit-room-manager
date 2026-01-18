import os
import logging
import asyncio
import json
import re
from pathlib import Path
from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.llm import ChatContext, ChatMessage
from livekit.plugins import openai, silero
from typing import List

load_dotenv()

logger = logging.getLogger("medical_note_agent")
logger.setLevel(logging.INFO)


class MedicalNoteAssistant:
    def __init__(self, ctx: JobContext):
        self.transcriptions: List[str] = []
        self.current_notes: str = ""
        self.note_update_task = None
        self.full_transcript: str = ""
        self._last_transcription_sent: str = ""
        self.llm = openai.LLM(model="gpt-4o-mini")
        self.ctx = ctx

    def build_display_transcript(self, partial: str | None = None, max_sentences: int = 3) -> str:
        """Return a trimmed transcript preview for the frontend."""
        segments: List[str] = []
        if self.full_transcript.strip():
            segments.append(self.full_transcript.strip())
        if partial and partial.strip():
            segments.append(partial.strip())

        combined = " ".join(segments).strip()
        if not combined:
            return ""

        sentences = [match.group().strip() for match in re.finditer(r'[^.!?]+[.!?]?', combined)]
        if not sentences:
            sentences = [combined]

        recent = sentences[-max_sentences:]
        return " ".join(recent).strip()

    async def update_notes(self, transcript: str):
        """Generate SOAP notes from transcript"""
        if not transcript.strip():
            logger.info("Skipping note update because transcript is empty")
            return
        try:
            prompt = f"""
                You are a medical note-taking assistant. Generate structured SOAP notes from this conversation.
                
                Current Notes:
                {self.current_notes if self.current_notes else "(No notes yet)"}

                Transcript:
                {transcript}

                Instructions:
                - Generate notes in SOAP format (Subjective, Objective, Assessment, Plan)
                - Only include information explicitly discussed
                - Keep notes organized and concise
                - Integrate new information with existing notes
                
                Format:
                ## Subjective
                - [Patient complaints, symptoms]
                
                ## Objective
                - [Observable findings, vital signs if mentioned]
                
                ## Assessment
                - [Diagnosis or differential diagnosis]
                
                ## Plan
                - [Treatment plan, follow-up]
                
                Updated Notes:
            """

            ctx = ChatContext([
                ChatMessage(
                    type="message",
                    role="system",
                    content=["You are a medical AI assistant creating SOAP format notes."]
                ),
                ChatMessage(
                    type="message",
                    role="user",
                    content=[prompt]
                )
            ])

            response = ""
            async with self.llm.chat(chat_ctx=ctx) as stream:
                async for chunk in stream:
                    if not chunk:
                        continue
                    content = getattr(chunk.delta, 'content', None) if hasattr(chunk, 'delta') else str(chunk)
                    if content:
                        response += content

            self.current_notes = response.strip()
            await self.send_to_frontend("notes", self.current_notes)

        except Exception as e:
            logger.error(f"Error updating notes: {e}")

    async def send_to_frontend(self, msg_type: str, content: str):
        """Send updates to frontend via Data Channel"""
        try:
            data = json.dumps({
                "type": msg_type,
                "content": content,
                "timestamp": asyncio.get_event_loop().time()
            })
            
            await self.ctx.room.local_participant.publish_data(
                data.encode('utf-8'),
                reliable=True
            )
            
            logger.info(f"Sent {msg_type} to frontend")
            
        except Exception as e:
            logger.error(f"Error sending {msg_type}: {e}")

    async def generate_diagnosis(self, notes: str) -> str:
        """Generate diagnosis from notes"""
        try:
            prompt = f"""
                Based on these medical notes, provide:
                
                Medical Notes:
                {notes}
                
                1. **Possible Diagnoses**: Most likely diagnoses
                2. **Differential Diagnoses**: Other conditions to consider
                3. **Recommended Tests**: Diagnostic tests if needed
                4. **Treatment Considerations**: Initial treatment approaches
                5. **Follow-up**: When and why to follow up
                
                IMPORTANT: For educational purposes only.
            """

            ctx = ChatContext([
                ChatMessage(
                    type="message",
                    role="system",
                    content=["You are a medical diagnostic assistant providing educational assessments."]
                ),
                ChatMessage(
                    type="message",
                    role="user",
                    content=[prompt]
                )
            ])

            response = ""
            async with self.llm.chat(chat_ctx=ctx) as stream:
                async for chunk in stream:
                    if not chunk:
                        continue
                    content = getattr(chunk.delta, 'content', None) if hasattr(chunk, 'delta') else str(chunk)
                    if content:
                        response += content

            return response.strip()
        except Exception as e:
            logger.error(f"Error generating diagnosis: {e}")
            return f"Error: {str(e)}"


async def entrypoint(ctx: JobContext):
    logger.info(f"Starting medical agent for room: {ctx.room.name}")
    logger.info(f"OpenAI API key configured: {bool(os.getenv('OPENAI_API_KEY'))}")

    session = AgentSession()

    # Create agent with both STT and TTS (TTS required for Agent to work properly)
    agent = Agent(
        instructions="You are a medical note-taking assistant. Listen carefully and transcribe accurately.",
        stt=openai.STT(),
        tts=openai.TTS(),  # Required for proper STT initialization
        vad=silero.VAD.load()
    )

    # Create note assistant
    note_assistant = MedicalNoteAssistant(ctx)

    @session.on("user_input_transcribed")
    def on_transcript(transcript):
        logger.info(f"🎤 Transcript received: {transcript.transcript}")
        fragment = transcript.transcript.strip()
        if not fragment:
            logger.warning("Empty transcript fragment, skipping")
            return

        logger.info(f"✅ Final transcript: {fragment}")
        note_assistant.transcriptions.append(fragment)
        if note_assistant.full_transcript:
            note_assistant.full_transcript = f"{note_assistant.full_transcript} {fragment}"
        else:
            note_assistant.full_transcript = fragment

        display_text = note_assistant.build_display_transcript()
        asyncio.create_task(
            note_assistant.send_to_frontend("transcription", display_text)
        )

        if len(note_assistant.transcriptions) >= 5:
            logger.info("🔄 Triggering note update (5+ transcriptions)")
            asyncio.create_task(
                note_assistant.update_notes(note_assistant.full_transcript)
            )

    logger.info("Medical note agent started. Listening for transcriptions...")

    await session.start(
        agent=agent,
        room=ctx.room
    )

    # Register RPC for diagnosis requests
    async def handle_diagnosis_request(rpc_invocation):
        try:
            payload = json.loads(rpc_invocation.payload)
            notes = payload.get("notes", note_assistant.current_notes)

            if not notes:
                return json.dumps({"error": "No notes available"})

            diagnosis = await note_assistant.generate_diagnosis(notes)
            await note_assistant.send_to_frontend("diagnosis", diagnosis)

            return json.dumps({"success": True})
        except Exception as e:
            logger.error(f"Error handling diagnosis: {e}")
            return json.dumps({"error": str(e)})

    ctx.room.local_participant.register_rpc_method("request_diagnosis", handle_diagnosis_request)

    logger.info("Agent ready and listening...")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
