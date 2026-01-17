# API Testing Guide

Complete reference for testing the Medical Triage system.

---

## Quick Reference

| Endpoint | Purpose |
|----------|---------|
| `POST /session/start` | Create room, get tokens for user + doctor |
| `POST /session/end` | Destroy room |
| `POST /session/join` | Get new token for a participant |
| `GET /session/{room_name}/status` | Check room status + participants |
| `GET /sessions/active` | List all active sessions |
| `POST /api/classify` | LLM classification (your backend) |
| `POST /api/council` | LLM council voting (your backend) |
| `POST /api/send-sms` | Send SMS alert (your backend) |

---

## Room Manager Endpoints (Port 8080)

### 1. Start Session

Creates a room and returns tokens for **both** user and doctor.

```
POST http://localhost:8080/session/start
```

**Request:**
```json
{
  "patient_id": "TEST0041",
  "location": "Station-A",
  "hardware_id": "hw-001",
  "doctor_ids": ["dr-smith", "dr-jones"],
  "image_base64": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `patient_id` | Yes | Patient identifier |
| `location` | Yes | Station/location name |
| `hardware_id` | Yes | Hardware device ID |
| `doctor_ids` | No | List of doctors to notify |
| `image_base64` | No | Camera image from hardware |

**Response:**
```json
{
  "status": "created",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "livekit_url": "wss://your-livekit.cloud",
  "user_token": "eyJhbGciOiJIUzI1NiIs...",
  "doctor_token": "eyJhbGciOiJIUzI1NiIs...",
  "message": "Room created. Use user_token for patient, doctor_token for doctor."
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

**What to do with tokens:**
- `user_token` → Hardware uses this to connect patient to LiveKit
- `doctor_token` → Send to doctor via notification/SMS so they can join

---

### 2. End Session

Destroys the room when hardware flag goes OFF.

```
POST http://localhost:8080/session/end
```

**Request:**
```json
{
  "room_name": "triage-Station-A-TEST0041-20260117170000"
}
```

**Response:**
```json
{
  "status": "ended",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "patient_id": "TEST0041",
  "duration_seconds": 245
}
```

**cURL:**
```bash
curl -X POST http://localhost:8080/session/end \
  -H "Content-Type: application/json" \
  -d '{"room_name": "triage-Station-A-TEST0041-20260117170000"}'
```

---

### 3. Join Session (Get New Token)

Generate a new token for a participant to join an existing session.

```
POST http://localhost:8080/session/join
```

**Request:**
```json
{
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "role": "doctor",
  "participant_id": "dr-smith",
  "name": "Dr. Smith"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `room_name` | Yes | Existing room name |
| `role` | Yes | `"user"` or `"doctor"` |
| `participant_id` | Yes | Unique ID for this participant |
| `name` | No | Display name |

**Response:**
```json
{
  "status": "success",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "livekit_url": "wss://your-livekit.cloud",
  "role": "doctor"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8080/session/join \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-TEST0041-20260117170000",
    "role": "doctor",
    "participant_id": "dr-smith",
    "name": "Dr. Smith"
  }'
```

---

### 4. Get Session Status

Check if a session is active and who's in it.

```
GET http://localhost:8080/session/{room_name}/status
```

**Response (active):**
```json
{
  "status": "active",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "patient_id": "TEST0041",
  "location": "Station-A",
  "started_at": "2026-01-17T17:00:00.123456",
  "participants": [
    {"identity": "user-TEST0041", "name": "Patient TEST0041", "joined": true},
    {"identity": "doctor-on-call", "name": "Doctor", "joined": true}
  ],
  "participant_count": 2
}
```

**Response (not found):**
```json
{
  "status": "not_found"
}
```

**cURL:**
```bash
curl http://localhost:8080/session/triage-Station-A-TEST0041-20260117170000/status
```

---

### 5. List Active Sessions

```
GET http://localhost:8080/sessions/active
```

**Response:**
```json
{
  "count": 2,
  "sessions": [
    {
      "room_name": "triage-Station-A-TEST0041-20260117170000",
      "patient_id": "TEST0041",
      "location": "Station-A",
      "hardware_id": "hw-001",
      "started_at": "2026-01-17T17:00:00.123456"
    },
    {
      "room_name": "triage-Station-B-TEST0042-20260117171500",
      "patient_id": "TEST0042",
      "location": "Station-B",
      "hardware_id": "hw-002",
      "started_at": "2026-01-17T17:15:00.654321"
    }
  ]
}
```

**cURL:**
```bash
curl http://localhost:8080/sessions/active
```

---

### 6. Health Check

```
GET http://localhost:8080/health
```

**Response:**
```json
{
  "status": "healthy"
}
```

---

## LLM Backend Endpoints (Port 8000)

These endpoints are called by the **LiveKit Agent**. Your backend must implement these.

### 1. Classification Endpoint

Initial triage by Gemini to determine if it's an emergency.

```
POST http://localhost:8000/api/classify
```

**Request (from Agent):**
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
  "image": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

**Response - Normal (continue conversation):**
```json
{
  "category": "NORMAL",
  "response": "I understand you're experiencing chest pain. Can you describe the pain? Is it sharp, dull, burning, or does it feel like pressure?",
  "confidence": 0.72
}
```

**Response - Emergency (triggers council):**
```json
{
  "category": "CRITICAL",
  "response": "This sounds serious. Stay calm, I'm getting you immediate help.",
  "confidence": 0.91
}
```

**cURL:**
```bash
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "I have severe chest pain and I cant breathe"}],
    "patient_id": "TEST0041",
    "location": "Station-A"
  }'
```

---

### 2. Council Endpoint

Called when classification returns `CRITICAL` or `EMERGENCY`. Multiple LLMs vote.

```
POST http://localhost:8000/api/council
```

**Request (same format as classify):**
```json
{
  "text": [
    {"assistant": "Can you describe the pain?", "human": "it feels like pressure"},
    {"assistant": "Where is it located?", "human": "in my chest and spreading to my arm"},
    {"assistant": "Any other symptoms?", "human": "sweating and nausea"},
    {"assistant": "When did this start?", "human": "about 20 minutes ago"}
  ],
  "patient_id": "TEST0041",
  "location": "Station-A",
  "image": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

**Response:**
```json
{
  "response": "Assessment: Classic presentation of possible acute coronary syndrome - chest pressure radiating to arm with diaphoresis and nausea. Urgency: CRITICAL - Call 911 immediately. Action: Chew aspirin if available, do not drive yourself.",
  "urgency": "HIGH",
  "confidence": 0.93,
  "council_votes": {
    "gpt4": {
      "urgency": "HIGH",
      "confidence": 0.94,
      "model": "GPT-4o"
    },
    "claude": {
      "urgency": "HIGH",
      "confidence": 0.95,
      "model": "Claude Sonnet 4"
    },
    "gemini": {
      "urgency": "HIGH",
      "confidence": 0.91,
      "model": "Gemini 2.0 Flash"
    }
  },
  "route_taken": "council",
  "patient_id": "TEST0041",
  "location": "Station-A",
  "trace_id": "c2695fd2-b500-4a73-ba22-e3fd184c78db"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8000/api/council \
  -H "Content-Type: application/json" \
  -d '{
    "text": [
      {"assistant": "", "human": "severe chest pain spreading to my left arm, sweating, nausea"}
    ],
    "patient_id": "TEST0041",
    "location": "Station-A"
  }'
```

---

### 3. SMS Endpoint

Called by Agent when council confirms emergency.

```
POST http://localhost:8000/api/send-sms
```

**Request (from Agent):**
```json
{
  "patient_id": "TEST0041",
  "location": "Station-A",
  "urgency": "HIGH",
  "assessment": "Assessment: Possible acute coronary syndrome. Urgency: CRITICAL. Action: Call 911 immediately.",
  "confidence": 0.93,
  "council_votes": {
    "gpt4": {"urgency": "HIGH", "confidence": 0.94, "model": "GPT-4o"},
    "claude": {"urgency": "HIGH", "confidence": 0.95, "model": "Claude Sonnet 4"},
    "gemini": {"urgency": "HIGH", "confidence": 0.91, "model": "Gemini 2.0 Flash"}
  },
  "trace_id": "c2695fd2-b500-4a73-ba22-e3fd184c78db",
  "contacts": ["+1234567890", "+0987654321"],
  "timestamp": "2026-01-17T17:05:30.123456"
}
```

**Response:**
```json
{
  "status": "sent",
  "message_count": 2,
  "trace_id": "c2695fd2-b500-4a73-ba22-e3fd184c78db"
}
```

**cURL:**
```bash
curl -X POST http://localhost:8000/api/send-sms \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "TEST0041",
    "location": "Station-A",
    "urgency": "HIGH",
    "assessment": "Possible cardiac event",
    "confidence": 0.93,
    "contacts": ["+1234567890"],
    "timestamp": "2026-01-17T17:05:30"
  }'
```

---

## Complete Test Scenarios

### Scenario 1: Normal Conversation (No Emergency)

Patient has a mild headache. Normal triage flow, no emergency.

```bash
# Step 1: Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "NORMAL001",
    "location": "Station-A",
    "hardware_id": "hw-001"
  }'

# Save the room_name from response for later

# Step 2: User says "I have a mild headache"
# Agent calls classify endpoint:
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "Hello, how can I help?", "human": "I have a mild headache"}],
    "patient_id": "NORMAL001",
    "location": "Station-A"
  }'

# Expected response:
# {
#   "category": "NORMAL",
#   "response": "I understand. How long have you had this headache?",
#   "confidence": 0.65
# }

# Step 3: Conversation continues...
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [
      {"assistant": "Hello, how can I help?", "human": "I have a mild headache"},
      {"assistant": "How long have you had this headache?", "human": "since this morning"},
      {"assistant": "Any other symptoms?", "human": "no just the headache"}
    ],
    "patient_id": "NORMAL001",
    "location": "Station-A"
  }'

# Expected: Still NORMAL, no council, no SMS

# Step 4: Session ends (hardware flag OFF)
curl -X POST http://localhost:8080/session/end \
  -H "Content-Type: application/json" \
  -d '{"room_name": "triage-Station-A-NORMAL001-XXXXXX"}'
```

**Expected Flow:**
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   User      │────▶│   Classify   │────▶│   NORMAL    │
│  speaks     │     │   (Gemini)   │     │  response   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    Council: NOT called
                    SMS: NOT sent
```

---

### Scenario 2: Emergency - Council Confirms

Patient has classic heart attack symptoms. Council unanimously confirms.

```bash
# Step 1: Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "EMERG001",
    "location": "Station-B",
    "hardware_id": "hw-002"
  }'

# Step 2: User describes emergency symptoms
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "I have severe chest pain and I cant breathe, my left arm hurts"}],
    "patient_id": "EMERG001",
    "location": "Station-B"
  }'

# Expected response:
# {
#   "category": "CRITICAL",
#   "response": "This sounds serious. Stay calm.",
#   "confidence": 0.95
# }

# Step 3: Agent automatically calls council
curl -X POST http://localhost:8000/api/council \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "severe chest pain, cant breathe, left arm hurts"}],
    "patient_id": "EMERG001",
    "location": "Station-B"
  }'

# Expected response:
# {
#   "response": "Assessment: Classic MI presentation...",
#   "urgency": "HIGH",
#   "confidence": 0.94,
#   "council_votes": {
#     "gpt4": {"urgency": "HIGH", "confidence": 0.94},
#     "claude": {"urgency": "HIGH", "confidence": 0.96},
#     "gemini": {"urgency": "HIGH", "confidence": 0.92}
#   }
# }

# Step 4: Agent sends SMS (council confirmed: 3/3 HIGH votes)
curl -X POST http://localhost:8000/api/send-sms \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "EMERG001",
    "location": "Station-B",
    "urgency": "HIGH",
    "assessment": "Possible MI - chest pain, dyspnea, left arm pain",
    "confidence": 0.94,
    "contacts": ["+1234567890"],
    "timestamp": "2026-01-17T17:10:00"
  }'

# Expected: {"status": "sent", "message_count": 1}
```

**Expected Flow:**
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   User      │────▶│   Classify   │────▶│  CRITICAL   │
│  speaks     │     │   (Gemini)   │     │  detected   │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │                      COUNCIL                          │
                    │  ┌─────────┐   ┌─────────┐   ┌─────────┐            │
                    │  │  GPT-4  │   │  Claude │   │ Gemini  │            │
                    │  │  HIGH   │   │  HIGH   │   │  HIGH   │            │
                    │  └─────────┘   └─────────┘   └─────────┘            │
                    │                                                      │
                    │            Majority: 3/3 HIGH ✓                      │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │                   EMERGENCY CONFIRMED                  │
                    │                                                        │
                    │   ✓ SMS sent to emergency contacts                    │
                    │   ✓ Urgent voice response to patient                  │
                    └────────────────────────────────────────────────────────┘
```

---

### Scenario 3: Emergency - Council Downgrades (Split Vote)

Initial classification says CRITICAL but council disagrees.

```bash
# Step 1: Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "SPLIT001",
    "location": "Station-C",
    "hardware_id": "hw-003"
  }'

# Step 2: Ambiguous symptoms trigger CRITICAL (keyword: "chest")
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "I have chest discomfort after eating a big meal"}],
    "patient_id": "SPLIT001",
    "location": "Station-C"
  }'

# May return CRITICAL due to "chest" keyword

# Step 3: Council evaluates - split decision
# For testing, your backend should return:
# {
#   "response": "Your symptoms may be related to acid reflux or indigestion...",
#   "urgency": "MEDIUM",
#   "confidence": 0.65,
#   "council_votes": {
#     "gpt4": {"urgency": "MEDIUM", "confidence": 0.60},
#     "claude": {"urgency": "LOW", "confidence": 0.70},
#     "gemini": {"urgency": "HIGH", "confidence": 0.65}
#   }
# }

# Result: Only 1/3 voted HIGH
# Majority NOT reached → Emergency NOT confirmed
# SMS is NOT sent
```

**Expected Flow:**
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   User      │────▶│   Classify   │────▶│  CRITICAL   │
│  speaks     │     │   (Gemini)   │     │  detected   │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │                      COUNCIL                          │
                    │  ┌─────────┐   ┌─────────┐   ┌─────────┐            │
                    │  │  GPT-4  │   │  Claude │   │ Gemini  │            │
                    │  │ MEDIUM  │   │   LOW   │   │  HIGH   │            │
                    │  └─────────┘   └─────────┘   └─────────┘            │
                    │                                                      │
                    │            Majority: 1/3 HIGH ✗                      │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                    ┌───────────────────────────▼───────────────────────────┐
                    │                  EMERGENCY DOWNGRADED                  │
                    │                                                        │
                    │   ✗ SMS NOT sent                                      │
                    │   ✓ Advisory response: "Monitor symptoms, see doctor" │
                    └────────────────────────────────────────────────────────┘
```

---

### Scenario 4: Multi-Turn Conversation Escalates to Emergency

Normal conversation that gradually becomes concerning.

```bash
# Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "ESCAL001", "location": "Station-A", "hardware_id": "hw-001"}'

# Turn 1: Vague symptoms - NORMAL
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [{"assistant": "", "human": "I feel a bit unwell"}],
    "patient_id": "ESCAL001",
    "location": "Station-A"
  }'
# Expected: {"category": "NORMAL", ...}

# Turn 2: More detail - still NORMAL
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [
      {"assistant": "Can you describe how you feel?", "human": "I feel a bit unwell"},
      {"assistant": "What symptoms are you experiencing?", "human": "some discomfort in my chest"}
    ],
    "patient_id": "ESCAL001",
    "location": "Station-A"
  }'
# Expected: Could still be NORMAL

# Turn 3: Symptoms worsen - CRITICAL
curl -X POST http://localhost:8000/api/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": [
      {"assistant": "Can you describe how you feel?", "human": "I feel a bit unwell"},
      {"assistant": "What symptoms are you experiencing?", "human": "some discomfort in my chest"},
      {"assistant": "Can you describe the discomfort?", "human": "its getting worse and my arm feels numb"}
    ],
    "patient_id": "ESCAL001",
    "location": "Station-A"
  }'
# Expected: {"category": "CRITICAL", ...}

# Now council is called, and if confirmed, SMS is sent
```

**Expected Flow:**
```
Turn 1: "feel unwell"        → NORMAL  → Continue conversation
Turn 2: "chest discomfort"   → NORMAL  → Continue conversation  
Turn 3: "worse, arm numb"    → CRITICAL → Council → SMS
```

---

### Scenario 5: Doctor Joins Mid-Session

```bash
# Step 1: Start session
RESPONSE=$(curl -s -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "DOC001", "location": "Station-A", "hardware_id": "hw-001"}')

ROOM_NAME=$(echo $RESPONSE | jq -r '.room_name')
echo "Room: $ROOM_NAME"

# Step 2: Check status (user connected)
curl http://localhost:8080/session/$ROOM_NAME/status
# Expected: participant_count: 1

# Step 3: Doctor requests token to join
curl -X POST http://localhost:8080/session/join \
  -H "Content-Type: application/json" \
  -d "{
    \"room_name\": \"$ROOM_NAME\",
    \"role\": \"doctor\",
    \"participant_id\": \"dr-jones\",
    \"name\": \"Dr. Jones\"
  }"

# Response contains token for doctor to connect

# Step 4: After doctor joins
curl http://localhost:8080/session/$ROOM_NAME/status
# Expected: participant_count: 2
```

---

### Scenario 6: Multiple Doctors Join

```bash
# Start session
RESPONSE=$(curl -s -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "MULTI001", "location": "Station-A", "hardware_id": "hw-001"}')

ROOM_NAME=$(echo $RESPONSE | jq -r '.room_name')

# First doctor joins
curl -X POST http://localhost:8080/session/join \
  -H "Content-Type: application/json" \
  -d "{
    \"room_name\": \"$ROOM_NAME\",
    \"role\": \"doctor\",
    \"participant_id\": \"dr-smith\",
    \"name\": \"Dr. Smith\"
  }"

# Second doctor (specialist) joins
curl -X POST http://localhost:8080/session/join \
  -H "Content-Type: application/json" \
  -d "{
    \"room_name\": \"$ROOM_NAME\",
    \"role\": \"doctor\",
    \"participant_id\": \"dr-cardio\",
    \"name\": \"Dr. Cardio (Cardiologist)\"
  }"

# Check all participants
curl http://localhost:8080/session/$ROOM_NAME/status
# Expected: participant_count: 3 (user + 2 doctors)
```

---

### Scenario 7: Session Cleanup

```bash
# Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "CLEAN001", "location": "Station-A", "hardware_id": "hw-001"}'

# Verify active
curl http://localhost:8080/sessions/active
# Expected: count: 1

# End session
curl -X POST http://localhost:8080/session/end \
  -H "Content-Type: application/json" \
  -d '{"room_name": "triage-Station-A-CLEAN001-XXXXXX"}'

# Verify cleaned up
curl http://localhost:8080/sessions/active
# Expected: count: 0

# Try to join ended session
curl -X POST http://localhost:8080/session/join \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-CLEAN001-XXXXXX",
    "role": "doctor",
    "participant_id": "dr-late"
  }'
# Expected: 404 - Session not found
```

---

### Scenario 8: Invalid Requests

```bash
# Missing required field
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST001"}'
# Expected: 422 - Validation error (missing location, hardware_id)

# Invalid role
curl -X POST http://localhost:8080/session/join \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "some-room",
    "role": "nurse",
    "participant_id": "nurse-1"
  }'
# Expected: 400 - Role must be 'user' or 'doctor'

# Non-existent session
curl -X POST http://localhost:8080/session/join \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "fake-room-12345",
    "role": "doctor",
    "participant_id": "dr-test"
  }'
# Expected: 404 - Session not found
```

---

## Mock Backend Quick Start

For testing without real LLMs:

```bash
# Terminal 1: Start mock backend (port 8000)
python mock_backend.py

# Terminal 2: Start room manager (port 8080)  
python room_manager.py

# Terminal 3: Run test commands from this guide
```

**Mock backend keyword detection:**

| Keywords | Classification |
|----------|---------------|
| `chest pain`, `cant breathe`, `heart attack`, `severe`, `crushing`, `stroke`, `unconscious`, `seizure` | `CRITICAL` |
| `difficulty breathing`, `high fever`, `vomiting blood`, `severe headache`, `numbness` | `HIGH` urgency |
| Everything else | `NORMAL` |

---

## Council Decision Logic

The agent confirms emergency if:

```python
# Majority vote HIGH
high_votes = count of votes with urgency == "HIGH"
total_votes = total number of council members

if high_votes > total_votes / 2:
    emergency_confirmed = True

# OR average confidence > 0.85
avg_confidence = sum(all confidences) / total_votes
if avg_confidence > 0.85:
    emergency_confirmed = True
```

| Council Votes | Result |
|---------------|--------|
| 3 HIGH, 0 other | ✅ Confirmed (3/3 majority) |
| 2 HIGH, 1 MEDIUM | ✅ Confirmed (2/3 majority) |
| 1 HIGH, 2 MEDIUM | ❌ Not confirmed |
| 0 HIGH, 3 MEDIUM with avg confidence 0.87 | ✅ Confirmed (confidence threshold) |

---

## Environment Variables

```bash
# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxx
LIVEKIT_API_SECRET=xxxxx

# Your Backend  
LLM_BACKEND_URL=http://localhost:8000

# SMS Service (if separate)
SMS_SERVICE_URL=http://localhost:8001
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Session not found" | Room may have ended or never existed. Check `/sessions/active` |
| "Connection refused" on LiveKit | Check `LIVEKIT_URL` and that LiveKit server is running |
| SMS not sending | Check council votes - need majority HIGH or >0.85 confidence |
| Token expired | Generate new token via `/session/join` |
| Agent not joining room | Check LiveKit agent worker is running: `python agent.py dev` |