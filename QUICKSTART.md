# Quick Start - Triage + LiveKit Integration

## 🎯 Main Endpoint

**POST** `http://localhost:8000/triage/complete`

### Request (Super Simple!)

```json
{
  "patient_id": "TEST0041"
}
```

### Response

```json
{
  "status": "success",
  "message": "Triage complete, LiveKit room created",
  "patient_id": "TEST0041",
  "room_id": "patient_TEST0041_1737146924",
  "patient_token": "eyJhbGci...",
  "livekit_url": "wss://abcd-vaim7omd.livekit.cloud",
  "urgency": "HIGH",
  "mongodb_updated": true
}
```

---

## 🔄 Complete Flow

### 1. Your Triage Agent Saves Data to MongoDB

Your existing triage system saves patient data:

```json
{
  "patient_id": "TEST0041",
  "output": {
    "urgency": "HIGH",
    "confidence": 0.9
  },
  ...
}
```

### 2. Call `/triage/complete` with Just patient_id

```bash
POST http://localhost:8000/triage/complete
{
  "patient_id": "TEST0041"
}
```

### 3. System Creates Room & Updates MongoDB

The system:

- ✅ Fetches patient data from MongoDB
- ✅ Creates LiveKit room
- ✅ Adds `livekit_room` field to patient document
- ✅ Returns patient_token for auto-join

### 4. Doctor Joins Later

```bash
POST http://localhost:8000/doctor/join-room
{
  "patient_id": "TEST0041",
  "doctor_id": "DR456"
}
```

---

## 📋 All Endpoints

| Endpoint                    | Method | Purpose                    |
| --------------------------- | ------ | -------------------------- |
| `/health`                   | GET    | Check if server is running |
| `/triage/complete`          | POST   | Create room after triage   |
| `/patient/{id}/room-status` | GET    | Check room status          |
| `/doctor/join-room`         | POST   | Doctor joins room          |
| `/session/end/{id}`         | POST   | End session                |

---

## 🚀 Run the Server

```bash
cd nexhacks-livekit
uvicorn main:app --reload --port 8000
```

---

## ✅ Test in Postman

1. **Health Check**: `GET http://localhost:8000/health`

2. **Create Room**:

```
POST http://localhost:8000/triage/complete
Body: { "patient_id": "TEST0041" }
```

3. **Check Status**: `GET http://localhost:8000/patient/TEST0041/room-status`

4. **Doctor Joins**:

```
POST http://localhost:8000/doctor/join-room
Body: { "patient_id": "TEST0041", "doctor_id": "DR456" }
```

5. **End Session**: `POST http://localhost:8000/session/end/TEST0041`

---

## 📦 MongoDB Updates

After calling `/triage/complete`, your patient document gets this added:

```json
{
  "patient_id": "TEST0041",
  "livekit_room": {
    "room_id": "patient_TEST0041_1737146924",
    "status": "waiting_for_doctor",
    "patient_token": "...",
    "livekit_url": "wss://...",
    "doctor_id": null
  },
  "triage_complete": true
}
```

---

## 💡 Integration with Your Triage Agent

```python
# After your triage agent completes
import httpx

async def complete_triage_and_create_room(patient_id: str):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/triage/complete",
            json={"patient_id": patient_id}
        )
        result = response.json()

        # Patient can now join with this token
        patient_token = result["patient_token"]
        room_id = result["room_id"]

        return room_id, patient_token
```

That's it! Super simple! 🎉
