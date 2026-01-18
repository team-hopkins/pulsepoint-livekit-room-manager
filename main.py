from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from livekit import api
from dotenv import load_dotenv
import os
import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from typing import Optional
from sinch import SinchClient

# Load environment variables from .env file
load_dotenv(".env")

app = FastAPI()

# MongoDB Configuration
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb+srv://pulsepoint:pulsepoint@cluster0.d7dh4ba.mongodb.net")
DATABASE_NAME = os.getenv("DATABASE_NAME", "carepoint_medical")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "consultations")

# MongoDB Client
mongodb_client = AsyncIOMotorClient(MONGODB_URL)
db = mongodb_client[DATABASE_NAME]
patients_collection = db[COLLECTION_NAME]

sinch_client = SinchClient(
    key_id=os.getenv("SINCH_KEY_ID"),
    key_secret=os.getenv("SINCH_KEY_SECRET"),
    project_id=os.getenv("SINCH_PROJECT_ID")
)

class HardwarePayload(BaseModel):
    patient_id: str
    text: str
    frame: str
    metadata: dict

class SessionControl(BaseModel):
    flag: str
    patient_id: str
    doctor_id: str

class TriageResult(BaseModel):
    patient_id: str

class DoctorJoinRequest(BaseModel):
    patient_id: str
    doctor_id: str

class EmergencyAlert(BaseModel):
    patient_id: str
    emergency_type: str
    location: Optional[str] = None
    contact_number: str

class LiveKitManager:
    def __init__(self):
        self._livekit_api = None
        self.active_rooms = {}
    
    @property
    def livekit_api(self):
        """Lazy initialization of LiveKit API client"""
        if self._livekit_api is None:
            self._livekit_api = api.LiveKitAPI(
                os.getenv("LIVEKIT_URL"),
                os.getenv("LIVEKIT_API_KEY"),
                os.getenv("LIVEKIT_API_SECRET")
            )
        return self._livekit_api
    
    async def create_patient_room(self, patient_id: str):
        """
        Create a LiveKit room for a patient after triage assessment.
        Patient is automatically added to the room.
        """
        room_name = f"patient_{patient_id}_{int(datetime.utcnow().timestamp())}"
        
        try:
            # Create the room
            await self.livekit_api.room.create_room(
                api.CreateRoomRequest(name=room_name)
            )
            
            # Generate patient token for auto-join
            patient_token = api.AccessToken(
                os.getenv("LIVEKIT_API_KEY"),
                os.getenv("LIVEKIT_API_SECRET")
            )
            patient_token.with_identity(f"patient_{patient_id}")
            patient_token.with_name(f"Patient {patient_id}")
            patient_token.with_grants(api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True
            ))
            
            self.active_rooms[room_name] = {
                "patient_id": patient_id,
                "created_at": datetime.utcnow().isoformat(),
                "doctor_id": None
            }
            
            return {
                "room_id": room_name,
                "room_name": room_name,
                "patient_token": patient_token.to_jwt(),
                "livekit_url": os.getenv("LIVEKIT_URL"),
                "created_at": datetime.utcnow().isoformat()
            }
        
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create room: {str(e)}")
    
    async def add_doctor_to_room(self, room_id: str, doctor_id: str):
        """
        Generate a token for a doctor to join an existing patient room.
        """
        try:
            # Generate doctor token
            doctor_token = api.AccessToken(
                os.getenv("LIVEKIT_API_KEY"),
                os.getenv("LIVEKIT_API_SECRET")
            )
            doctor_token.with_identity(f"doctor_{doctor_id}")
            doctor_token.with_name(f"Doctor {doctor_id}")
            doctor_token.with_grants(api.VideoGrants(
                room_join=True,
                room=room_id,
                can_publish=True,
                can_subscribe=True
            ))
            
            # Update active rooms
            if room_id in self.active_rooms:
                self.active_rooms[room_id]["doctor_id"] = doctor_id
            
            return {
                "room_id": room_id,
                "doctor_token": doctor_token.to_jwt(),
                "livekit_url": os.getenv("LIVEKIT_URL"),
                "doctor_joined_at": datetime.utcnow().isoformat()
            }
        
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to add doctor: {str(e)}")
    
    async def create_session(self, patient_id: str, doctor_id: str):
        room_name = f"session_{patient_id}_{doctor_id}"
        
        try:
            await self.livekit_api.room.create_room(
                api.CreateRoomRequest(name=room_name)
            )
            
            patient_token = api.AccessToken(
                os.getenv("LIVEKIT_API_KEY"),
                os.getenv("LIVEKIT_API_SECRET")
            )
            patient_token.with_identity(f"patient_{patient_id}")
            patient_token.with_name(f"Patient {patient_id}")
            patient_token.with_grants(api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True
            ))
            
            doctor_token = api.AccessToken(
                os.getenv("LIVEKIT_API_KEY"),
                os.getenv("LIVEKIT_API_SECRET")
            )
            doctor_token.with_identity(f"doctor_{doctor_id}")
            doctor_token.with_name(f"Doctor {doctor_id}")
            doctor_token.with_grants(api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True
            ))
            
            self.active_rooms[room_name] = {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            }
            
            return {
                "room_name": room_name,
                "patient_token": patient_token.to_jwt(),
                "doctor_token": doctor_token.to_jwt(),
                "livekit_url": os.getenv("LIVEKIT_URL")
            }
        
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    async def end_session(self, patient_id: str, doctor_id: str):
        room_name = f"session_{patient_id}_{doctor_id}"
        
        try:
            await self.livekit_api.room.delete_room(
                api.DeleteRoomRequest(room=room_name)
            )
            
            if room_name in self.active_rooms:
                del self.active_rooms[room_name]
            
            return {"status": "session_ended", "room_name": room_name}
        
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

livekit_manager = LiveKitManager()

@app.post("/hardware/input")
async def receive_hardware_input(payload: HardwarePayload):
    return {
        "status": "success",
        "data": {
            "text": payload.text,
            "patient_id": payload.patient_id,
            "frame": payload.frame,
            "metadata": payload.metadata
        }
    }

@app.post("/session/control")
async def control_session(control: SessionControl):
    if control.flag == "on":
        result = await livekit_manager.create_session(
            control.patient_id,
            control.doctor_id
        )
        return result
    
    elif control.flag == "off":
        result = await livekit_manager.end_session(
            control.patient_id,
            control.doctor_id
        )
        return result
    
    else:
        raise HTTPException(status_code=400, detail="Invalid flag value")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/test-mongodb")
async def test_mongodb():
    """
    Test endpoint to verify MongoDB connection and list patients.
    """
    try:
        # Try to connect and get count
        count = await patients_collection.count_documents({})
        
        # Get a few sample patient IDs
        patients = await patients_collection.find({}, {"patient_id": 1, "_id": 0}).limit(5).to_list(5)
        patient_ids = [p.get("patient_id") for p in patients]
        
        return {
            "status": "connected",
            "database": DATABASE_NAME,
            "collection": COLLECTION_NAME,
            "total_patients": count,
            "sample_patient_ids": patient_ids
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "mongodb_url": MONGODB_URL[:30] + "..." if len(MONGODB_URL) > 30 else MONGODB_URL
        }

# New endpoint: Create room after triage assessment
@app.post("/triage/complete")
async def complete_triage(triage_result: TriageResult):
    """
    Called after triage assessment is complete.
    Creates a LiveKit room for the patient and stores room_id in MongoDB.
    Fetches existing patient data from MongoDB.
    """
    try:
        # Debug: Check MongoDB connection
        total_count = await patients_collection.count_documents({})
        print(f"DEBUG: Total patients in DB: {total_count}")
        print(f"DEBUG: Looking for patient_id: {triage_result.patient_id}")
        
        # Fetch existing patient data from MongoDB
        patient = await patients_collection.find_one({"patient_id": triage_result.patient_id})
        
        if not patient:
            # Additional debug info
            sample_patients = await patients_collection.find({}, {"patient_id": 1}).limit(5).to_list(5)
            sample_ids = [p.get("patient_id") for p in sample_patients]
            
            raise HTTPException(
                status_code=404, 
                detail={
                    "error": f"Patient {triage_result.patient_id} not found in database",
                    "database": DATABASE_NAME,
                    "collection": COLLECTION_NAME,
                    "total_patients": total_count,
                    "sample_patient_ids": sample_ids,
                    "hint": "Make sure patient_id matches exactly (case-sensitive)"
                }
            )
        
        # Create LiveKit room for the patient
        room_data = await livekit_manager.create_patient_room(triage_result.patient_id)
        
        # Extract triage data from existing patient record
        triage_urgency = patient.get("output", {}).get("urgency", "UNKNOWN")
        triage_confidence = patient.get("output", {}).get("confidence", 0.0)
        
        # Update patient record in MongoDB with room_id and livekit info
        update_result = await patients_collection.update_one(
            {"patient_id": triage_result.patient_id},
            {
                "$set": {
                    "livekit_room": {
                        "room_id": room_data["room_id"],
                        "room_name": room_data["room_name"],
                        "created_at": room_data["created_at"],
                        "status": "waiting_for_doctor",
                        "patient_token": room_data["patient_token"],
                        "livekit_url": room_data["livekit_url"]
                    },
                    "triage_complete": True,
                    "updated_at": datetime.utcnow().isoformat()
                }
            }
        )
        
        return {
            "status": "success",
            "message": "Triage complete, LiveKit room created",
            "patient_id": triage_result.patient_id,
            "room_id": room_data["room_id"],
            "patient_token": room_data["patient_token"],
            "livekit_url": room_data["livekit_url"],
            "urgency": triage_urgency,
            "mongodb_updated": update_result.modified_count > 0
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to complete triage: {str(e)}")

# New endpoint: Doctor joins existing room
@app.post("/doctor/join-room")
async def doctor_join_room(request: DoctorJoinRequest):
    """
    Generate a token for a doctor to join an existing patient room.
    Fetches room_id from MongoDB using patient_id.
    """
    try:
        # Fetch patient record from MongoDB
        patient = await patients_collection.find_one({"patient_id": request.patient_id})
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        if "livekit_room" not in patient or not patient["livekit_room"].get("room_id"):
            raise HTTPException(status_code=404, detail="No active room found for this patient")
        
        room_id = patient["livekit_room"]["room_id"]
        
        # Generate doctor token
        doctor_data = await livekit_manager.add_doctor_to_room(room_id, request.doctor_id)
        
        # Update MongoDB with doctor info
        await patients_collection.update_one(
            {"patient_id": request.patient_id},
            {
                "$set": {
                    "livekit_room.status": "doctor_joined",
                    "livekit_room.doctor_id": request.doctor_id,
                    "livekit_room.doctor_joined_at": doctor_data["doctor_joined_at"],
                    "updated_at": datetime.utcnow().isoformat()
                }
            }
        )
        
        return {
            "status": "success",
            "message": "Doctor token generated",
            "patient_id": request.patient_id,
            "doctor_id": request.doctor_id,
            "room_id": room_id,
            "doctor_token": doctor_data["doctor_token"],
            "livekit_url": doctor_data["livekit_url"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add doctor to room: {str(e)}")

# New endpoint: Get patient room status
@app.get("/patient/{patient_id}/room-status")
async def get_room_status(patient_id: str):
    """
    Get the current LiveKit room status for a patient.
    """
    try:
        patient = await patients_collection.find_one({"patient_id": patient_id})
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        if "livekit_room" not in patient:
            return {
                "patient_id": patient_id,
                "has_room": False,
                "message": "No room created yet"
            }
        
        livekit_room = patient["livekit_room"]
        # Remove sensitive tokens from response
        room_status = {k: v for k, v in livekit_room.items() if k not in ["patient_token"]}
        
        return {
            "patient_id": patient_id,
            "has_room": True,
            "room_status": room_status,
            "triage_urgency": patient.get("triage_urgency"),
            "triage_confidence": patient.get("triage_confidence")
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get room status: {str(e)}")

# New endpoint: End patient session
@app.post("/session/end/{patient_id}")
async def end_patient_session(patient_id: str):
    """
    End a patient's LiveKit session and clean up.
    """
    try:
        # Fetch patient record
        patient = await patients_collection.find_one({"patient_id": patient_id})
        
        if not patient or "livekit_room" not in patient:
            raise HTTPException(status_code=404, detail="No active session found")
        
        room_id = patient["livekit_room"]["room_id"]
        
        # Delete the room
        await livekit_manager.livekit_api.room.delete_room(
            api.DeleteRoomRequest(room=room_id)
        )
        
        # Remove from active rooms
        if room_id in livekit_manager.active_rooms:
            del livekit_manager.active_rooms[room_id]
        
        # Update MongoDB
        await patients_collection.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "livekit_room.status": "completed",
                    "livekit_room.ended_at": datetime.utcnow().isoformat(),
                    "updated_at": datetime.utcnow().isoformat()
                }
            }
        )
        
        return {
            "status": "success",
            "message": "Session ended",
            "patient_id": patient_id,
            "room_id": room_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to end session: {str(e)}")

@app.post("/emergency/alert")
async def send_emergency_alert(alert: EmergencyAlert):
    """Send emergency SMS alert."""
    try:
        message = f"🚨 EMERGENCY: {alert.emergency_type}\nPatient ID: {alert.patient_id}\nLocation: {alert.location or 'Unknown'}\nRespond immediately!"
        
        response = sinch_client.sms.batches.send(
            body=message,
            to=[alert.contact_number],
            from_="+12085813509",
            delivery_report="none"
        )
        
        return {"status": "success", "batch_id": response.id}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))