# API Testing Guide

Complete reference for testing the Medical Triage system.

## Room Manager Endpoints (Port 8080)

### 1. Start Session (Hardware Flag ON)

```bash
POST http://localhost:8080/session/start
```

**Payload:**
```json
{
  "patient_id": "TEST0041",
  "location": "Station-A",
  "hardware_id": "hw-001",
  "image_base64": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
```

**Response:**
```json
{
  "status": "created",
  "room_name": "triage-Station-A-TEST0041-20240117143022",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "livekit_url": "ws://localhost:7880",
  "message": "Room created. Patient TEST0041 session started."
}
```

**cURL:**
```bash
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "TEST0041",
    "location": "Station-A",
    "hardware_id": "hw-001"
  }'
```

---

### 2. End Session (Hardware Flag OFF)

```bash
POST http://localhost:8080/session/end
```

**Payload:**
```json
{
  "room_name": "triage-Station-A-TEST0041-20240117143022",
  "hardware_id": "hw-001"
}
```

**Response:**
```json
{
  "status": "deleted",
  "room_name": "triage-Station-A-TEST0041-20240117143022",
  "message": "Session ended for patient TEST0041"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8080/session/end \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-TEST0041-20240117143022",
    "hardware_id": "hw-001"
  }'
```

---

### 3. Check Session Status

```bash
GET http://localhost:8080/session/{room_name}/status
```

**Response:**
```json
{
  "status": "active",
  "room_name": "triage-Station-A-TEST0041-20240117143022",
  "patient_id": "TEST0041",
  "location": "Station-A",
  "started_at": "2024-01-17T14:30:22.123456",
  "num_participants": 2
}
```

**cURL:**
```bash
curl http://localhost:8080/session/triage-Station-A-TEST0041-20240117143022/status
```

---

### 4. List All Active Sessions

```bash
GET http://localhost:8080/sessions/active
```

**Response:**
```json
{
  "count": 2,
  "sessions": [
    {
      "room_name": "triage-Station-A-TEST0041-20240117143022",
      "patient_id": "TEST0041",
      "location": "Station-A",
      "hardware_id": "hw-001",
      "started_at": "2024-01-17T14:30:22.123456"
    },
    {
      "room_name": "triage-Station-B-TEST0042-20240117143500",
      "patient_id": "TEST0042",
      "location": "Station-B",
      "hardware_id": "hw-002",
      "started_at": "2024-01-17T14:35:00.654321"
    }
  ]
}
```

**cURL:**
```bash
curl http://localhost:8080/sessions/active
```

---

### 5. Health Check

```bash
GET http://localhost:8080/health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "room-manager"
}
```

---

## LLM Backend Endpoints (Your Service - Port 8000)

These are the endpoints YOUR backend needs to implement. The LiveKit Agent will call these.

### 1. Classification Endpoint

```bash
POST http://localhost:8000/api/classify
```

**Payload (from Agent):**
```json
{
  "text": [
    {
      "assistant": "Hello, I'm your medical assistant. How can I help you today?",
      "human": "I have chest pain"
    }
  ],
  "patient_id": "TEST0041",
  "location": "Station-A",
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
```

**Expected Response - Normal Case:**
```json
{
  "category": "NORMAL",
  "response": "I understand you're experiencing chest pain. Can you describe the pain? Is it sharp, dull, burning, or does it feel like pressure or tightness?",
  "confidence": 0.75
}
```

**Expected Response - Emergency Case:**
```json
{
  "category": "CRITICAL",
  "response": "This sounds serious. I'm escalating this for immediate review.",
  "confidence": 0.92
}
```

---

### 2. Council Endpoint (Emergency Confirmation)

```bash
POST http://localhost:8000/api/council
```

**Payload (from Agent - same format):**
```json
{
  "text": [
    {
      "assistant": "Can you describe the pain? Is it sharp, dull, burning, or does it feel like pressure or tightness?",
      "human": "it feels like a pressure"
    },
    {
      "assistant": "Where exactly is the pain located, and does it spread to other areas like your arm, jaw, neck, or back?",
      "human": "it is happening in my back"
    },
    {
      "assistant": "When did the pain start, and how long does it last? Is it constant or does it come and go?",
      "human": "it comes and goes"
    },
    {
      "assistant": "What makes the pain better or worse? Does it change with breathing, eating, physical activity, or rest?",
      "human": "it changes with taking rest"
    },
    {
      "assistant": "Do you have any other symptoms along with the chest pain, such as shortness of breath, sweating, nausea, dizziness, or palpitations?",
      "human": "I am having a little bit of nausea"
    }
  ],
  "patient_id": "TEST0041",
  "location": "Station-A",
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
```

**Expected Response:**
```json
{
  "response": "Assessment: Back pressure with nausea could be cardiac ischemia or musculoskeletal pain. Urgency: Urgent—go to ER now. Action: Call emergency services immediately, especially if symptoms worsen or recur.",
  "urgency": "HIGH",
  "confidence": 0.9,
  "council_votes": {
    "gpt4": {
      "urgency": "HIGH",
      "confidence": 0.9,
      "model": "GPT-4o"
    },
    "claude": {
      "urgency": "HIGH",
      "confidence": 0.92,
      "model": "Claude Sonnet 4"
    },
    "gemini": {
      "urgency": "HIGH",
      "confidence": 0.88,
      "model": "Gemini 2.0 Flash"
    }
  },
  "route_taken": "council",
  "patient_id": "TEST0041",
  "location": "Station-A",
  "trace_id": "c2695fd2-b500-4a73-ba22-e3fd184c78db"
}
```

---

## SMS Service Endpoint (Port 8001)

The Agent will call this when emergency is confirmed.

### Send Emergency SMS

```bash
POST http://localhost:8001/api/send-sms
```

**Payload (from Agent):**
```json
{
  "patient_id": "TEST0041",
  "location": "Station-A",
  "urgency": "HIGH",
  "assessment": "Assessment: Back pressure with nausea could be cardiac ischemia or musculoskeletal pain. Urgency: Urgent—go to ER now. Action: Call emergency services immediately, especially if symptoms worsen or recur.",
  "confidence": 0.9,
  "council_votes": {
    "gpt4": {"urgency": "HIGH", "confidence": 0.9, "model": "GPT-4o"},
    "claude": {"urgency": "HIGH", "confidence": 0.92, "model": "Claude Sonnet 4"},
    "gemini": {"urgency": "HIGH", "confidence": 0.88, "model": "Gemini 2.0 Flash"}
  },
  "trace_id": "c2695fd2-b500-4a73-ba22-e3fd184c78db",
  "contacts": ["+1234567890"],
  "timestamp": "2024-01-17T14:35:22.123456"
}
```

**Expected Response:**
```json
{
  "status": "sent",
  "message_count": 1,
  "trace_id": "c2695fd2-b500-4a73-ba22-e3fd184c78db"
}
```

---

## Test Scenarios

### Scenario 1: Normal Conversation (No Emergency)

```bash
# 1. Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST0050", "location": "Station-A", "hardware_id": "hw-001"}'

# 2. Simulate classification call (your backend returns NORMAL)
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "I have a mild headache"}],
    "patient_id": "TEST0050",
    "location": "Station-A"
  }'

# Expected: category=NORMAL, conversation continues
# No council called, no SMS sent

# 3. End session
curl -X POST http://localhost:8080/session/end \
  -H "Content-Type: application/json" \
  -d '{"room_name": "triage-Station-A-TEST0050-...", "hardware_id": "hw-001"}'
```

---

### Scenario 2: Emergency - Council Confirms

```bash
# 1. Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST0051", "location": "Station-B", "hardware_id": "hw-002"}'

# 2. Classification returns CRITICAL
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "I have severe chest pain and cant breathe"}],
    "patient_id": "TEST0051",
    "location": "Station-B"
  }'

# Expected: category=CRITICAL

# 3. Agent automatically calls council
curl -X POST http://localhost:8000/api/council \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "I have severe chest pain and cant breathe"}],
    "patient_id": "TEST0051",
    "location": "Station-B"
  }'

# Expected: urgency=HIGH, council_votes all HIGH

# 4. Agent automatically sends SMS
curl -X POST http://localhost:8001/api/send-sms \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "TEST0051",
    "location": "Station-B",
    "urgency": "HIGH",
    "assessment": "Possible cardiac event...",
    "confidence": 0.9,
    "contacts": ["+1234567890"],
    "timestamp": "2024-01-17T14:40:00"
  }'
```

---

### Scenario 3: Emergency - Council Does NOT Confirm (Downgrade)

```bash
# Classification returns CRITICAL but council votes mixed

# Council response with split votes:
{
  "response": "Your symptoms are concerning but may not indicate an immediate emergency. Please monitor closely.",
  "urgency": "MEDIUM",
  "confidence": 0.6,
  "council_votes": {
    "gpt4": {"urgency": "MEDIUM", "confidence": 0.65, "model": "GPT-4o"},
    "claude": {"urgency": "HIGH", "confidence": 0.7, "model": "Claude Sonnet 4"},
    "gemini": {"urgency": "LOW", "confidence": 0.55, "model": "Gemini 2.0 Flash"}
  }
}

# Result: 1/3 HIGH votes = NOT majority
# Emergency NOT confirmed, NO SMS sent
# Patient receives cautionary response
```

---

### Scenario 4: Multiple Conversation Turns

```bash
# Full conversation flow
{
  "text": [
    {"assistant": "Hello, I'm your medical assistant. How can I help you today?", "human": "I have chest pain"},
    {"assistant": "Can you describe the pain?", "human": "it feels like pressure"},
    {"assistant": "Where is it located?", "human": "in my chest and back"},
    {"assistant": "Any other symptoms?", "human": "nausea and sweating"},
    {"assistant": "When did this start?", "human": "about 30 minutes ago"}
  ],
  "patient_id": "TEST0052",
  "location": "Station-C"
}
```

---

## Mock Backend for Testing

Here's a simple mock backend you can use for testing:

```python
# mock_backend.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Optional
import uuid

app = FastAPI()

class ConversationTurn(BaseModel):
    assistant: str
    human: str

class ClassifyRequest(BaseModel):
    text: List[ConversationTurn]
    patient_id: str
    location: str
    image: Optional[str] = None

class CouncilRequest(BaseModel):
    text: List[ConversationTurn]
    patient_id: str
    location: str
    image: Optional[str] = None

class SMSRequest(BaseModel):
    patient_id: str
    location: str
    urgency: str
    assessment: str
    confidence: float
    contacts: List[str]
    timestamp: str
    council_votes: Optional[Dict] = None
    trace_id: Optional[str] = None

# Emergency keywords for mock classification
EMERGENCY_KEYWORDS = ["chest pain", "cant breathe", "heart attack", "severe", "crushing"]

@app.post("/api/classify")
async def classify(request: ClassifyRequest):
    last_message = request.text[-1].human.lower() if request.text else ""
    
    is_emergency = any(kw in last_message for kw in EMERGENCY_KEYWORDS)
    
    if is_emergency:
        return {
            "category": "CRITICAL",
            "response": "This sounds serious. Stay calm, help is being coordinated.",
            "confidence": 0.9
        }
    else:
        return {
            "category": "NORMAL",
            "response": "I understand. Can you tell me more about your symptoms?",
            "confidence": 0.7
        }

@app.post("/api/council")
async def council(request: CouncilRequest):
    return {
        "response": "Assessment: Potential cardiac event. Urgency: Go to ER immediately. Action: Call 911.",
        "urgency": "HIGH",
        "confidence": 0.9,
        "council_votes": {
            "gpt4": {"urgency": "HIGH", "confidence": 0.9, "model": "GPT-4o"},
            "claude": {"urgency": "HIGH", "confidence": 0.92, "model": "Claude Sonnet 4"},
            "gemini": {"urgency": "HIGH", "confidence": 0.88, "model": "Gemini 2.0 Flash"}
        },
        "route_taken": "council",
        "patient_id": request.patient_id,
        "location": request.location,
        "trace_id": str(uuid.uuid4())
    }

@app.post("/api/send-sms")
async def send_sms(request: SMSRequest):
    print(f"[SMS] Emergency alert for {request.patient_id} at {request.location}")
    print(f"[SMS] Sending to: {request.contacts}")
    print(f"[SMS] Assessment: {request.assessment}")
    return {
        "status": "sent",
        "message_count": len(request.contacts),
        "trace_id": request.trace_id
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Run with: `python mock_backend.py`

---

## Quick Test Commands

```bash
# Health checks
curl http://localhost:8080/health
curl http://localhost:8000/health  # if you implement it

# Start a test session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST001", "location": "TestStation", "hardware_id": "test-hw"}'

# List active sessions
curl http://localhost:8080/sessions/active

# Test classification (normal)
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{"text": [{"assistant": "", "human": "I have a headache"}], "patient_id": "TEST001", "location": "TestStation"}'

# Test classification (emergency)
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{"text": [{"assistant": "", "human": "I have severe chest pain and cant breathe"}], "patient_id": "TEST001", "location": "TestStation"}'

# Test council
curl -X POST http://localhost:8000/api/council \
  -H "Content-Type: application/json" \
  -d '{"text": [{"assistant": "", "human": "severe chest pain"}], "patient_id": "TEST001", "location": "TestStation"}'
```