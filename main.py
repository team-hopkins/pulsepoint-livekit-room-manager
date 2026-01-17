from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from livekit import api
from dotenv import load_dotenv
import os
import httpx

load_dotenv(".env.local")

app = FastAPI()

class HardwarePayload(BaseModel):
    patient_id: str
    text: str
    frame: str
    metadata: dict

class SessionControl(BaseModel):
    flag: str
    patient_id: str
    doctor_id: str

class LiveKitManager:
    def __init__(self):
        self.livekit_api = api.LiveKitAPI(
            os.getenv("LIVEKIT_URL"),
            os.getenv("LIVEKIT_API_KEY"),
            os.getenv("LIVEKIT_API_SECRET")
        )
        self.active_rooms = {}
    
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