# LiveKit Integration Scenarios

## Overview
This document outlines the API scenarios for the LiveKit-based telemedicine system that routes data between hardware, LiveKit rooms, and LLM processing.

## Base URL
```
http://localhost:8000
```

---

## Scenario 1: Complete Session Flow

### Step 1: Start Session (Create Room)
**Endpoint:** `POST /session/control`

**Request:**
```json
{
  "flag": "on",
  "patient_id": "P123",
  "doctor_id": "D456"
}
```

**Response:**
```json
{
  "room_name": "session_P123_D456",
  "patient_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "doctor_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "livekit_url": "wss://your-project.livekit.cloud"
}
```

**What happens:**
- Room `session_P123_D456` is created
- Patient and doctor tokens are generated
- Both can now join the LiveKit room using their respective tokens

---

### Step 2: Send Hardware Data for LLM Processing
**Endpoint:** `POST /hardware/input`

**Request:**
```json
{
  "patient_id": "P123",
  "text": "I have a headache and feel dizzy",
  "frame": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "metadata": {
    "timestamp": "2024-01-17T10:30:00Z",
    "device_id": "HW001",
    "session_id": "session_P123_D456"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "text": "I have a headache and feel dizzy",
    "patient_id": "P123",
    "frame": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "metadata": {
      "timestamp": "2024-01-17T10:30:00Z",
      "device_id": "HW001",
      "session_id": "session_P123_D456"
    }
  }
}
```

**What happens:**
- Hardware sends patient speech (converted to text) + audio frame
- Server receives and returns the payload
- You can now forward this to your LLM API

---

### Step 3: End Session (Delete Room)
**Endpoint:** `POST /session/control`

**Request:**
```json
{
  "flag": "off",
  "patient_id": "P123",
  "doctor_id": "D456"
}
```

**Response:**
```json
{
  "status": "session_ended",
  "room_name": "session_P123_D456"
}
```

**What happens:**
- Room `session_P123_D456` is deleted
- Patient and doctor are disconnected

---

## Scenario 2: Multiple Concurrent Sessions

### Session 1: Patient A + Doctor X
```json
POST /session/control
{
  "flag": "on",
  "patient_id": "PA001",
  "doctor_id": "DX001"
}
```
Room created: `session_PA001_DX001`

### Session 2: Patient B + Doctor Y
```json
POST /session/control
{
  "flag": "on",
  "patient_id": "PB002",
  "doctor_id": "DY002"
}
```
Room created: `session_PB002_DY002`

### Send data from Patient A
```json
POST /hardware/input
{
  "patient_id": "PA001",
  "text": "My symptoms started yesterday",
  "frame": "base64_audio_frame_1",
  "metadata": {
    "session_id": "session_PA001_DX001"
  }
}
```

### Send data from Patient B
```json
POST /hardware/input
{
  "patient_id": "PB002",
  "text": "I need a prescription refill",
  "frame": "base64_audio_frame_2",
  "metadata": {
    "session_id": "session_PB002_DY002"
  }
}
```

---

## Scenario 3: Error Handling

### Trying to end a non-existent session
**Request:**
```json
POST /session/control
{
  "flag": "off",
  "patient_id": "P999",
  "doctor_id": "D999"
}
```

**Response:**
```json
{
  "detail": "Room not found or already deleted"
}
```

### Invalid flag value
**Request:**
```json
POST /session/control
{
  "flag": "pause",
  "patient_id": "P123",
  "doctor_id": "D456"
}
```

**Response:**
```json
{
  "detail": "Invalid flag value"
}
```

### Missing required fields
**Request:**
```json
POST /hardware/input
{
  "patient_id": "P123",
  "text": "Hello"
}
```

**Response:**
```json
{
  "detail": [
    {
      "type": "missing",
      "loc": ["body", "frame"],
      "msg": "Field required"
    },
    {
      "type": "missing",
      "loc": ["body", "metadata"],
      "msg": "Field required"
    }
  ]
}
```

---

## Scenario 4: Health Check

### Check if server is running
**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "healthy"
}
```

---

## Integration Flow Diagram
```
Hardware → /hardware/input → Server → LLM API
                                ↓
                          Return payload
                                ↓
                    Your LLM Processing
                                ↓
                         LLM Response
                                ↓
                    Send back to hardware
```

---

## Session Management Flow
```
1. POST /session/control (flag: "on")
   ↓
   Room created + Tokens generated
   ↓
2. Patient & Doctor join room with tokens
   ↓
3. POST /hardware/input (multiple times during session)
   ↓
   Data sent to LLM for processing
   ↓
4. POST /session/control (flag: "off")
   ↓
   Room deleted + Session ended
```

---

## Notes

- All timestamps should be in ISO 8601 format
- Audio frames should be base64 encoded
- Session IDs follow the pattern: `session_{patient_id}_{doctor_id}`
- Tokens are JWT format and expire based on LiveKit configuration
- Multiple sessions can run concurrently without interference