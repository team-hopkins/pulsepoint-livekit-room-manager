"""
Room Manager Service with Twilio Alerts

Handles session lifecycle for medical triage with:
- User (patient at hardware station)
- Doctor (remote monitoring via web, alerted by phone/SMS)

Alert Flow:
1. Emergency confirmed → Twilio calls/SMS doctor
2. Doctor receives alert with join link
3. Doctor joins via web using doctor_token

Endpoints:
- POST /session/start - Create room, returns tokens for user + doctor
- POST /session/end - Destroy room
- POST /session/join - Get token for specific participant
- POST /session/alert/call - Make alert call to doctor
- POST /session/alert/sms - Send SMS alert to doctor
- POST /session/emergency-alert - Trigger all alerts (call + SMS)
- GET /session/{room_name}/status - Check room status
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional, List
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from livekit import api
from dotenv import load_dotenv
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException

# Load .env from the same directory as this script
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("room-manager")

# Verify env vars on startup
logger.info(f"LIVEKIT_URL: {os.getenv('LIVEKIT_URL', 'NOT SET')}")
logger.info(f"LIVEKIT_API_KEY: {os.getenv('LIVEKIT_API_KEY', 'NOT SET')}")
logger.info(f"TWILIO_ACCOUNT_SID: {'SET' if os.getenv('TWILIO_ACCOUNT_SID') else 'NOT SET'}")
logger.info(f"TWILIO_AUTH_TOKEN: {'SET' if os.getenv('TWILIO_AUTH_TOKEN') else 'NOT SET'}")
logger.info(f"TWILIO_PHONE_NUMBER: {os.getenv('TWILIO_PHONE_NUMBER', 'NOT SET')}")

app = FastAPI(title="Medical Triage Room Manager")

# In-memory session tracking (use Redis in production)
active_sessions: dict = {}
# Track alerts sent per room
alerts_sent: dict = {}  # room_name -> [{phone, type, status, timestamp}]


# ============== Twilio Client ==============

def get_twilio_client() -> TwilioClient:
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    
    if not account_sid or not auth_token:
        raise ValueError("Twilio credentials not configured")
    
    return TwilioClient(account_sid, auth_token)


# ============== Request/Response Models ==============

class SessionStartRequest(BaseModel):
    """Request to start a new session"""
    patient_id: str
    location: str
    hardware_id: str
    doctor_ids: Optional[List[str]] = None
    emergency_phones: Optional[List[str]] = None  # Phone numbers for emergency alerts
    image_base64: Optional[str] = None


class SessionStartResponse(BaseModel):
    """Response with tokens for all participants"""
    status: str
    room_name: str
    livekit_url: str
    user_token: str
    doctor_token: str
    join_url: str  # URL for doctor to join
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


class AlertCallRequest(BaseModel):
    """Request to make an alert call"""
    room_name: str
    phone_number: str  # E.164 format: +1234567890
    message: Optional[str] = None  # Custom message to speak


class AlertSMSRequest(BaseModel):
    """Request to send an SMS alert"""
    room_name: str
    phone_number: str
    message: Optional[str] = None  # Custom message


class EmergencyAlertRequest(BaseModel):
    """Request to trigger all emergency alerts"""
    room_name: str
    assessment: str
    urgency: str
    phone_numbers: Optional[List[str]] = None  # Override default contacts
    send_sms: bool = True
    make_call: bool = True


class AlertResponse(BaseModel):
    """Response for alert requests"""
    status: str
    room_name: str
    phone_number: str
    alert_type: str  # "call" or "sms"
    message: str


# ============== Helper Functions ==============

def get_livekit_api() -> api.LiveKitAPI:
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    url = os.getenv("LIVEKIT_URL")
    
    if not api_key or not api_secret:
        raise ValueError(f"LiveKit credentials not set")
    
    return api.LiveKitAPI(
        url=url,
        api_key=api_key,
        api_secret=api_secret,
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


def normalize_phone(phone: str) -> str:
    """Ensure phone is in E.164 format"""
    phone = phone.strip()
    if not phone.startswith("+"):
        phone = "+1" + phone.replace("-", "").replace(" ", "").replace("(", "").replace(")", "")
    return phone


def generate_join_url(room_name: str, token: str) -> str:
    """Generate URL for doctor to join"""
    # Replace with your actual frontend URL
    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    return f"{base_url}/join?room={room_name}&token={token}"


def build_alert_message(session: dict, assessment: str, urgency: str, join_url: str) -> str:
    """Build the alert message for calls/SMS"""
    return (
        f"MEDICAL ALERT - {urgency} URGENCY\n"
        f"Patient: {session['patient_id']}\n"
        f"Location: {session['location']}\n"
        f"Assessment: {assessment}\n"
        f"Join now: {join_url}"
    )


def build_twiml_message(session: dict, assessment: str, urgency: str, join_url: str) -> str:
    """Build TwiML for voice call"""
    # Spoken message for the call
    spoken = (
        f"Medical alert. {urgency} urgency. "
        f"Patient {session['patient_id']} at {session['location']}. "
        f"{assessment}. "
        f"Please check your SMS for the link to join, or go to your dashboard immediately."
    )
    
    # TwiML response
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">{spoken}</Say>
    <Pause length="1"/>
    <Say voice="alice">Repeating: {spoken}</Say>
</Response>"""


# ============== Session Endpoints ==============

@app.post("/session/start", response_model=SessionStartResponse)
async def start_session(request: SessionStartRequest):
    """
    Start a new triage session.
    Returns tokens for both user and doctor, plus a join URL.
    """
    room_name = generate_room_name(request.patient_id, request.location)
    livekit_url = os.getenv("LIVEKIT_URL")
    
    livekit_api = get_livekit_api()
    
    try:
        # Create the room
        await livekit_api.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                empty_timeout=300,
                max_participants=5,
                metadata=json.dumps({
                    "patient_id": request.patient_id,
                    "location": request.location,
                    "emergency_phones": request.emergency_phones or []
                })
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
        
        # Generate join URL for doctor
        join_url = generate_join_url(room_name, doctor_token)
        
        # Track session
        active_sessions[room_name] = {
            "patient_id": request.patient_id,
            "location": request.location,
            "hardware_id": request.hardware_id,
            "started_at": datetime.now().isoformat(),
            "image": request.image_base64,
            "doctor_ids": request.doctor_ids or [],
            "emergency_phones": request.emergency_phones or [],
            "doctor_token": doctor_token,
            "join_url": join_url
        }
        
        # Initialize alert tracking
        alerts_sent[room_name] = []
        
        logger.info(f"Session started: {room_name} for patient {request.patient_id}")
        
        return SessionStartResponse(
            status="created",
            room_name=room_name,
            livekit_url=livekit_url,
            user_token=user_token,
            doctor_token=doctor_token,
            join_url=join_url,
            message=f"Room created. Doctor can join via: {join_url}"
        )
        
    except Exception as e:
        logger.error(f"Failed to create room: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await livekit_api.aclose()


@app.post("/session/join", response_model=JoinResponse)
async def join_session(request: JoinRequest):
    """Generate a new token for joining an existing session."""
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
        livekit_url=os.getenv("LIVEKIT_URL"),
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
        alerts_sent.pop(room_name, None)
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


# ============== Twilio Alert Endpoints ==============

@app.post("/session/alert/call", response_model=AlertResponse)
async def make_alert_call(request: AlertCallRequest):
    """
    Make a voice call to alert a doctor.
    The call will speak the emergency details and tell them to check SMS/dashboard.
    """
    if request.room_name not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = active_sessions[request.room_name]
    phone = normalize_phone(request.phone_number)
    twilio_phone = os.getenv("TWILIO_PHONE_NUMBER")
    
    if not twilio_phone:
        raise HTTPException(status_code=500, detail="Twilio phone number not configured")
    
    try:
        twilio = get_twilio_client()
        
        # Build the TwiML message
        message = request.message or f"Medical emergency for patient {session['patient_id']} at {session['location']}. Please check your dashboard or SMS for details."
        
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">{message}</Say>
    <Pause length="1"/>
    <Say voice="alice">Repeating: {message}</Say>
</Response>"""
        
        # Make the call
        call = twilio.calls.create(
            to=phone,
            from_=twilio_phone,
            twiml=twiml
        )
        
        # Track the alert
        alerts_sent[request.room_name].append({
            "phone": phone,
            "type": "call",
            "status": "initiated",
            "call_sid": call.sid,
            "timestamp": datetime.now().isoformat()
        })
        
        logger.info(f"Alert call initiated to {phone} for room {request.room_name}")
        
        return AlertResponse(
            status="calling",
            room_name=request.room_name,
            phone_number=phone,
            alert_type="call",
            message=f"Calling {phone}. Call SID: {call.sid}"
        )
        
    except TwilioRestException as e:
        logger.error(f"Twilio error: {e}")
        raise HTTPException(status_code=500, detail=f"Twilio error: {e.msg}")
    except Exception as e:
        logger.error(f"Failed to make call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/session/alert/sms", response_model=AlertResponse)
async def send_alert_sms(request: AlertSMSRequest):
    """
    Send an SMS alert to a doctor with the join link.
    """
    if request.room_name not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = active_sessions[request.room_name]
    phone = normalize_phone(request.phone_number)
    twilio_phone = os.getenv("TWILIO_PHONE_NUMBER")
    
    if not twilio_phone:
        raise HTTPException(status_code=500, detail="Twilio phone number not configured")
    
    try:
        twilio = get_twilio_client()
        
        # Build the SMS message
        join_url = session.get("join_url", "")
        message = request.message or (
            f"🚨 MEDICAL ALERT\n"
            f"Patient: {session['patient_id']}\n"
            f"Location: {session['location']}\n"
            f"Join now: {join_url}"
        )
        
        # Send the SMS
        sms = twilio.messages.create(
            to=phone,
            from_=twilio_phone,
            body=message
        )
        
        # Track the alert
        alerts_sent[request.room_name].append({
            "phone": phone,
            "type": "sms",
            "status": "sent",
            "message_sid": sms.sid,
            "timestamp": datetime.now().isoformat()
        })
        
        logger.info(f"Alert SMS sent to {phone} for room {request.room_name}")
        
        return AlertResponse(
            status="sent",
            room_name=request.room_name,
            phone_number=phone,
            alert_type="sms",
            message=f"SMS sent to {phone}. Message SID: {sms.sid}"
        )
        
    except TwilioRestException as e:
        logger.error(f"Twilio error: {e}")
        raise HTTPException(status_code=500, detail=f"Twilio error: {e.msg}")
    except Exception as e:
        logger.error(f"Failed to send SMS: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/session/emergency-alert")
async def trigger_emergency_alerts(request: EmergencyAlertRequest):
    """
    Trigger emergency alerts (call + SMS) to all configured contacts.
    Called by the agent when council confirms emergency.
    """
    if request.room_name not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = active_sessions[request.room_name]
    
    # Get phone numbers
    phone_numbers = (
        request.phone_numbers or 
        session.get("emergency_phones") or 
        [p.strip() for p in os.getenv("EMERGENCY_PHONE_NUMBERS", "").split(",") if p.strip()]
    )
    
    if not phone_numbers:
        raise HTTPException(status_code=400, detail="No emergency phone numbers configured")
    
    twilio_phone = os.getenv("TWILIO_PHONE_NUMBER")
    if not twilio_phone:
        raise HTTPException(status_code=500, detail="Twilio phone number not configured")
    
    try:
        twilio = get_twilio_client()
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    results = []
    join_url = session.get("join_url", "")
    
    for phone in phone_numbers:
        phone = normalize_phone(phone)
        
        # Send SMS
        if request.send_sms:
            try:
                sms_body = (
                    f"🚨 MEDICAL EMERGENCY - {request.urgency}\n"
                    f"Patient: {session['patient_id']}\n"
                    f"Location: {session['location']}\n"
                    f"Assessment: {request.assessment}\n"
                    f"Join now: {join_url}"
                )
                
                sms = twilio.messages.create(
                    to=phone,
                    from_=twilio_phone,
                    body=sms_body
                )
                
                alerts_sent[request.room_name].append({
                    "phone": phone,
                    "type": "sms",
                    "status": "sent",
                    "message_sid": sms.sid,
                    "timestamp": datetime.now().isoformat()
                })
                
                results.append({"phone": phone, "type": "sms", "status": "sent"})
                logger.info(f"Emergency SMS sent to {phone}")
                
            except Exception as e:
                logger.error(f"Failed to send SMS to {phone}: {e}")
                results.append({"phone": phone, "type": "sms", "status": "failed", "error": str(e)})
        
        # Make call
        if request.make_call:
            try:
                call_message = (
                    f"Medical emergency. {request.urgency} urgency. "
                    f"Patient {session['patient_id']} at {session['location']}. "
                    f"{request.assessment}. "
                    f"Check your SMS for the link to join immediately."
                )
                
                twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">{call_message}</Say>
    <Pause length="1"/>
    <Say voice="alice">Repeating: {call_message}</Say>
</Response>"""
                
                call = twilio.calls.create(
                    to=phone,
                    from_=twilio_phone,
                    twiml=twiml
                )
                
                alerts_sent[request.room_name].append({
                    "phone": phone,
                    "type": "call",
                    "status": "initiated",
                    "call_sid": call.sid,
                    "timestamp": datetime.now().isoformat()
                })
                
                results.append({"phone": phone, "type": "call", "status": "calling"})
                logger.info(f"Emergency call initiated to {phone}")
                
            except Exception as e:
                logger.error(f"Failed to call {phone}: {e}")
                results.append({"phone": phone, "type": "call", "status": "failed", "error": str(e)})
    
    successful = len([r for r in results if r["status"] in ["sent", "calling"]])
    
    return {
        "status": "alerts_triggered",
        "room_name": request.room_name,
        "urgency": request.urgency,
        "join_url": join_url,
        "results": results,
        "message": f"Triggered {successful} alerts to {len(phone_numbers)} contacts"
    }


# ============== Status Endpoints ==============

@app.get("/session/{room_name}/status")
async def get_session_status(room_name: str):
    """Get session status including alerts sent."""
    if room_name not in active_sessions:
        return {"status": "not_found"}
    
    livekit_api = get_livekit_api()
    
    try:
        rooms = await livekit_api.room.list_rooms(
            api.ListRoomsRequest(names=[room_name])
        )
        
        if not rooms.rooms:
            active_sessions.pop(room_name, None)
            alerts_sent.pop(room_name, None)
            return {"status": "ended"}
        
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
            "join_url": session.get("join_url"),
            "participants": participant_list,
            "participant_count": len(participant_list),
            "alerts_sent": alerts_sent.get(room_name, []),
            "emergency_phones": session.get("emergency_phones", [])
        }
        
    finally:
        await livekit_api.aclose()


@app.get("/session/{room_name}/alerts")
async def get_alerts(room_name: str):
    """Get list of alerts sent for a room."""
    if room_name not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "room_name": room_name,
        "alerts": alerts_sent.get(room_name, [])
    }


@app.get("/sessions/active")
async def list_active_sessions():
    """List all active sessions."""
    return {
        "count": len(active_sessions),
        "sessions": [
            {
                "room_name": name,
                "patient_id": info["patient_id"],
                "location": info["location"],
                "started_at": info["started_at"],
                "alerts_count": len(alerts_sent.get(name, [])),
                "join_url": info.get("join_url")
            }
            for name, info in active_sessions.items()
        ]
    }


@app.get("/health")
async def health_check():
    """Health check with config status."""
    return {
        "status": "healthy",
        "config": {
            "livekit_url": bool(os.getenv("LIVEKIT_URL")),
            "livekit_api_key": bool(os.getenv("LIVEKIT_API_KEY")),
            "livekit_api_secret": bool(os.getenv("LIVEKIT_API_SECRET")),
            "twilio_account_sid": bool(os.getenv("TWILIO_ACCOUNT_SID")),
            "twilio_auth_token": bool(os.getenv("TWILIO_AUTH_TOKEN")),
            "twilio_phone_number": bool(os.getenv("TWILIO_PHONE_NUMBER")),
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)