"""
Room Manager Service - Simplified

Handles session lifecycle for medical triage with two participant types:
- User (patient at hardware station)
- Doctor (remote monitoring)

Endpoints:
- POST /session/start - Create room, returns tokens for user + doctor
- POST /session/end - Destroy room
- POST /session/join - Get token for specific participant
- GET /session/{room_name}/status - Check room status
"""

import os
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from livekit import api
from dotenv import load_dotenv
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("room-manager")

app = FastAPI(title="Medical Triage Room Manager")
load_dotenv()
from pathlib import Path

# Load .env from the same directory as this script
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)
# In-memory session tracking (use Redis in production)
active_sessions: dict = {}


# ============== Request/Response Models ==============

class SessionStartRequest(BaseModel):
    """Request to start a new session"""
    patient_id: str
    location: str
    hardware_id: str
    doctor_ids: Optional[List[str]] = None  # Optional: specific doctors to notify
    image_base64: Optional[str] = None


class SessionStartResponse(BaseModel):
    """Response with tokens for all participants"""
    status: str
    room_name: str
    livekit_url: str
    user_token: str      # Token for patient/user at hardware
    doctor_token: str    # Token for doctor to join
    message: str


class SessionEndRequest(BaseModel):
    """Request to end a session"""
    room_name: str


class JoinRequest(BaseModel):
    """Request to join an existing session"""
    room_name: str
    role: str  # "user" or "doctor"
    participant_id: str
    name: Optional[str] = None


class JoinResponse(BaseModel):
    """Response with join token"""
    status: str
    room_name: str
    token: str
    livekit_url: str
    role: str


# ============== Helper Functions ==============

def get_livekit_api() -> api.LiveKitAPI:
    return api.LiveKitAPI(
        url=os.getenv("LIVEKIT_URL"),
        api_key=os.getenv("LIVEKIT_API_KEY"),
        api_secret=os.getenv("LIVEKIT_API_SECRET"),
    )


def generate_room_name(patient_id: str, location: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"triage-{location}-{patient_id}-{timestamp}"


def generate_token(room_name: str, identity: str, name: str) -> str:
    token = api.AccessToken(
        api_key=os.getenv("LIVEKIT_API_KEY"),
        api_secret=os.getenv("LIVEKIT_API_SECRET"),
    )
    token.with_identity(identity)
    token.with_name(name)
    token.with_grants(api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    ))
    return token.to_jwt()


# ============== Endpoints ==============

@app.post("/session/start", response_model=SessionStartResponse)
async def start_session(request: SessionStartRequest):
    """
    Start a new triage session.
    
    Returns tokens for BOTH user and doctor so they can join immediately.
    
    Flow:
    1. Hardware calls this endpoint
    2. Hardware uses user_token to connect (auto-join)
    3. Hardware/backend sends doctor_token to doctor via notification
    4. Doctor clicks link/notification to join with their token
    """
    room_name = generate_room_name(request.patient_id, request.location)
    livekit_url = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
    
    livekit_api = get_livekit_api()
    
    try:
        # Create the room
        await livekit_api.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                empty_timeout=300,  # 5 minutes
                max_participants=4,  # user + doctor + agent + buffer
                metadata=f'{{"patient_id": "{request.patient_id}", "location": "{request.location}"}}'
            )
        )
        
        # Generate tokens
        user_token = generate_token(
            room_name=room_name,
            identity=f"user-{request.patient_id}",
            name=f"Patient {request.patient_id}"
        )
        
        doctor_token = generate_token(
            room_name=room_name,
            identity="doctor-on-call",
            name="Doctor"
        )
        
        # Track session
        active_sessions[room_name] = {
            "patient_id": request.patient_id,
            "location": request.location,
            "hardware_id": request.hardware_id,
            "started_at": datetime.now().isoformat(),
            "image": request.image_base64,
            "doctor_ids": request.doctor_ids or []
        }
        
        logger.info(f"Session started: {room_name} for patient {request.patient_id}")
        
        return SessionStartResponse(
            status="created",
            room_name=room_name,
            livekit_url=livekit_url,
            user_token=user_token,
            doctor_token=doctor_token,
            message=f"Room created. Use user_token for patient, doctor_token for doctor."
        )
        
    except Exception as e:
        logger.error(f"Failed to create room: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await livekit_api.aclose()


@app.post("/session/join", response_model=JoinResponse)
async def join_session(request: JoinRequest):
    """
    Generate a new token for joining an existing session.
    
    Use when:
    - A different doctor needs to join
    - Token expired and need a new one
    - Additional participant needs access
    """
    if request.room_name not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if request.role not in ["user", "doctor"]:
        raise HTTPException(status_code=400, detail="Role must be 'user' or 'doctor'")
    
    identity = f"{request.role}-{request.participant_id}"
    name = request.name or f"{request.role.title()} {request.participant_id}"
    
    token = generate_token(
        room_name=request.room_name,
        identity=identity,
        name=name
    )
    
    logger.info(f"{request.role} token generated for {request.room_name}")
    
    return JoinResponse(
        status="success",
        room_name=request.room_name,
        token=token,
        livekit_url=os.getenv("LIVEKIT_URL", "ws://localhost:7880"),
        role=request.role
    )


@app.post("/session/end")
async def end_session(request: SessionEndRequest):
    """End a triage session and cleanup."""
    room_name = request.room_name
    
    if room_name not in active_sessions:
        return {"status": "not_found", "message": "Session already ended or not found"}
    
    livekit_api = get_livekit_api()
    
    try:
        await livekit_api.room.delete_room(
            api.DeleteRoomRequest(room=room_name)
        )
        
        session_info = active_sessions.pop(room_name, {})
        logger.info(f"Session ended: {room_name}")
        
        return {
            "status": "ended",
            "room_name": room_name,
            "patient_id": session_info.get("patient_id"),
            "duration_seconds": (datetime.now() - datetime.fromisoformat(session_info.get("started_at", datetime.now().isoformat()))).seconds
        }
        
    except Exception as e:
        logger.error(f"Failed to end session: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await livekit_api.aclose()


@app.get("/session/{room_name}/status")
async def get_session_status(room_name: str):
    """Get session status and participant info."""
    if room_name not in active_sessions:
        return {"status": "not_found"}
    
    livekit_api = get_livekit_api()
    
    try:
        rooms = await livekit_api.room.list_rooms(
            api.ListRoomsRequest(names=[room_name])
        )
        
        if not rooms.rooms:
            active_sessions.pop(room_name, None)
            return {"status": "ended"}
        
        room = rooms.rooms[0]
        session = active_sessions[room_name]
        
        # Get participant list
        participants = await livekit_api.room.list_participants(
            api.ListParticipantsRequest(room=room_name)
        )
        
        participant_list = [
            {"identity": p.identity, "name": p.name, "joined": True}
            for p in participants.participants
        ]
        
        return {
            "status": "active",
            "room_name": room_name,
            "patient_id": session["patient_id"],
            "location": session["location"],
            "started_at": session["started_at"],
            "participants": participant_list,
            "participant_count": len(participant_list)
        }
        
    finally:
        await livekit_api.aclose()


@app.get("/sessions/active")
async def list_active_sessions():
    """List all active sessions."""
    return {
        "count": len(active_sessions),
        "sessions": [
            {"room_name": name, **info}
            for name, info in active_sessions.items()
        ]
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)