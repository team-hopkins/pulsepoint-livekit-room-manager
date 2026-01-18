import asyncio
import logging
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, cli, llm
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
        self.full_transcript = []
        self.notes = ""
        self.patient_info = {}
        self.doctor_info = {}
        
        self.system_prompt = """You are a medical AI assistant specializing in creating structured medical notes from doctor-patient consultations.

Your tasks:
1. Listen to the conversation between doctor and patient
2. Generate structured medical notes in SOAP format:
   - **Subjective**: Patient's complaints, symptoms, and history
   - **Objective**: Observable findings (vital signs if mentioned, physical examination)
   - **Assessment**: Diagnosis or differential diagnosis
   - **Plan**: Treatment plan, medications, follow-up

3. Continuously update notes as the conversation progresses
4. Use medical terminology appropriately
5. Format output in clear markdown with proper sections

Guidelines:
- Be concise but thorough
- Highlight critical information
- Use bullet points for clarity
- Include timestamps for important events
- Flag any urgent concerns
"""
        
        # Initialize chat context with system message
        self.chat_context.messages.append(
            ChatMessage.create(
                role="system",
                content=self.system_prompt
            )
        )

    async def start(self):
        logger.info("Medical Note Agent starting...")
        
        participant = await self.ctx.wait_for_participant()
        logger.info(f"Participant joined: {participant.identity}")
        
        if participant.identity.startswith("patient_"):
            self.patient_info["id"] = participant.identity
            self.patient_info["name"] = participant.name
        elif participant.identity.startswith("doctor_"):
            self.doctor_info["id"] = participant.identity
            self.doctor_info["name"] = participant.name
        
        logger.info("Starting transcription and note-taking...")
        
        assistant = agents.llm.LLM.with_deepgram(
            model="nova-2-medical",
            language="en"
        )
        
        stt = deepgram.STT(
            model="nova-2-medical",
            language="en",
        )
        
        llm = openai.LLM(model="gpt-4o-mini")
        
        assistant_manager = agents.VoicePipelineAgent(
            vad=silero.VAD.load(),
            stt=stt,
            llm=llm,
            tts=None,
            chat_ctx=self.chat_context,
            turn_detector=agents.TurnDetector(
                silence_duration=0.8,
            ),
        )
        
        assistant_manager.start(self.ctx.room)
        
        await self._subscribe_to_transcription(assistant_manager)
        
        await asyncio.sleep(float('inf'))

    async def _subscribe_to_transcription(self, assistant):
        @assistant.on("user_speech_committed")
        def on_user_speech(msg: agents.llm.ChatMessage):
            logger.info(f"User speech: {msg.content}")
            self._handle_transcription(msg.content, "user")
        
        @assistant.on("agent_speech_committed")
        def on_agent_speech(msg: agents.llm.ChatMessage):
            logger.info(f"Agent speech: {msg.content}")
            self._handle_transcription(msg.content, "agent")

    def _handle_transcription(self, text: str, speaker: str):
        timestamp = datetime.now().isoformat()
        
        transcription_entry = {
            "speaker": speaker,
            "text": text,
            "timestamp": timestamp
        }
        
        self.transcription_buffer.append(transcription_entry)
        self.full_transcript.append(transcription_entry)
        
        asyncio.create_task(self._send_transcription(text))
        
        if len(self.transcription_buffer) >= 5:
            asyncio.create_task(self._generate_notes())

    async def _send_transcription(self, text: str):
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
            logger.info(f"Sent transcription: {text[:50]}...")
        except Exception as e:
            logger.error(f"Error sending transcription: {e}")

    async def _generate_notes(self):
        try:
            transcript_text = "\n".join([
                f"[{entry['speaker']}]: {entry['text']}" 
                for entry in self.transcription_buffer
            ])
            
            prompt = f"""Based on this conversation segment, update the medical notes:

Previous Notes:
{self.notes if self.notes else "None yet"}

New Conversation:
{transcript_text}

Generate updated SOAP notes in markdown format. Be concise and professional."""

            messages = [
                ChatMessage(role="system", content=self.system_prompt),
                ChatMessage(role="user", content=prompt)
            ]
            
            llm = openai.LLM(model="gpt-4o-mini")
            
            response_text = ""
            async for chunk in llm.chat(messages=messages):
                if isinstance(chunk, agents.llm.ChatChunk):
                    response_text += chunk.delta
            
            self.notes = response_text
            self.transcription_buffer.clear()
            
            await self._send_notes(self.notes)
            
            logger.info("Generated and sent updated notes")
        except Exception as e:
            logger.error(f"Error generating notes: {e}")

    async def _send_notes(self, notes: str):
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
            logger.info("Sent updated notes")
        except Exception as e:
            logger.error(f"Error sending notes: {e}")

    async def _handle_command(self, command_data: dict):
        command = command_data.get("command")
        
        if command == "request_diagnosis":
            await self._generate_diagnosis()
        elif command == "generate_summary":
            await self._generate_summary()

    async def _generate_diagnosis(self):
        try:
            transcript_text = "\n".join([
                f"[{entry['speaker']}]: {entry['text']}" 
                for entry in self.full_transcript
            ])
            
            prompt = f"""Based on the full consultation, provide a concise diagnosis or differential diagnosis:

Full Transcript:
{transcript_text}

Current Notes:
{self.notes}

Provide a clear, professional diagnosis with reasoning."""

            messages = [
                ChatMessage(role="system", content=self.system_prompt),
                ChatMessage(role="user", content=prompt)
            ]
            
            llm = openai.LLM(model="gpt-4o-mini")
            
            response_text = ""
            async for chunk in llm.chat(messages=messages):
                if isinstance(chunk, agents.llm.ChatChunk):
                    response_text += chunk.delta
            
            data = json.dumps({
                "type": "diagnosis",
                "content": response_text,
                "timestamp": datetime.now().isoformat()
            })
            
            await self.ctx.room.local_participant.publish_data(
                data.encode('utf-8'),
                reliable=True
            )
            
            logger.info("Generated and sent diagnosis")
        except Exception as e:
            logger.error(f"Error generating diagnosis: {e}")

    async def _generate_summary(self):
        try:
            prompt = f"""Create a concise summary of the consultation:

Current SOAP Notes:
{self.notes}

Provide a brief executive summary suitable for medical records."""

            messages = [
                ChatMessage(role="system", content=self.system_prompt),
                ChatMessage(role="user", content=prompt)
            ]
            
            llm = openai.LLM(model="gpt-4o-mini")
            
            response_text = ""
            async for chunk in llm.chat(messages=messages):
                if isinstance(chunk, agents.llm.ChatChunk):
                    response_text += chunk.delta
            
            data = json.dumps({
                "type": "summary",
                "content": response_text,
                "timestamp": datetime.now().isoformat()
            })
            
            await self.ctx.room.local_participant.publish_data(
                data.encode('utf-8'),
                reliable=True
            )
            
            logger.info("Generated and sent summary")
        except Exception as e:
            logger.error(f"Error generating summary: {e}")


async def entrypoint(ctx: JobContext):
    logger.info(f"Connecting to room: {ctx.room.name}")
    await ctx.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)
    
    agent = MedicalNoteAgent(ctx)
    
    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        try:
            message = json.loads(data.data.decode('utf-8'))
            if message.get("type") == "command":
                asyncio.create_task(agent._handle_command(message))
        except Exception as e:
            logger.error(f"Error handling data: {e}")
    
    await agent.start()


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
