# API Testing Guide

Complete reference for testing the Medical Triage system with Twilio alerts.

---

## Architecture Overview

```
┌─────────────┐                      ┌────────────────┐
│   Patient   │ ◄──── LiveKit ────► │   AI Agent     │
│  (Hardware) │       Audio          │  (STT/TTS)     │
└─────────────┘                      └───────┬────────┘
                                             │
                                             │ HTTP
                                             ▼
┌─────────────────────────────────────────────────────┐
│                    LLM Backend                       │
│         Gemini → Classification → Council            │
└─────────────────────────────────────────────────────┘
                         │
                         │ If Emergency Confirmed
                         ▼
┌─────────────────────────────────────────────────────┐
│                  Room Manager                        │
│                        │                             │
│                        ▼                             │
│              ┌─────────────────┐                    │
│              │     Twilio      │                    │
│              │   📞 Call       │                    │
│              │   📱 SMS        │                    │
│              └─────────────────┘                    │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────┐
              │  Doctor's Phone │
              │                 │
              │  📞 Rings       │
              │  📱 SMS arrives │
              │                 │
              │  Click link →   │
              │  Join via web   │
              └─────────────────┘
```

---

## Quick Reference

| Endpoint                        | Purpose                            |
| ------------------------------- | ---------------------------------- |
| `POST /session/start`           | Create room, get tokens + join URL |
| `POST /session/end`             | Destroy room                       |
| `POST /session/join`            | Get token for participant          |
| `POST /session/alert/call`      | Make voice call to doctor          |
| `POST /session/alert/sms`       | Send SMS to doctor                 |
| `POST /session/emergency-alert` | Trigger BOTH call + SMS            |
| `GET /session/{room}/status`    | Room status + alerts sent          |
| `GET /session/{room}/alerts`    | List alerts for room               |

---

## Room Manager Endpoints (Port 8080)

### 1. Start Session

Creates room and returns tokens + join URL for doctor.

```
POST http://localhost:8080/session/start
```

**Request:**

```json
{
  "patient_id": "TEST0041",
  "location": "Station-A",
  "hardware_id": "hw-001",
  "emergency_phones": ["+1234567890", "+0987654321"]
}
```

**Response:**

```json
{
  "status": "created",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "livekit_url": "wss://your-project.livekit.cloud",
  "user_token": "eyJhbGciOiJIUzI1NiIs...",
  "doctor_token": "eyJhbGciOiJIUzI1NiIs...",
  "join_url": "http://localhost:3000/join?room=triage-...&token=eyJ...",
  "message": "Room created. Doctor can join via: http://..."
}
```

**cURL:**

```bash
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "TEST0041",
    "location": "Station-A",
    "hardware_id": "hw-001",
    "emergency_phones": ["+1234567890"]
  }'
```

---

### 2. Make Alert Call (Voice)

Call a doctor's phone. They hear a spoken alert message.

```
POST http://localhost:8080/session/alert/call
```

**Request:**

```json
{
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "phone_number": "+1234567890",
  "message": "Medical emergency for patient TEST0041. Please check your dashboard."
}
```

**Response:**

```json
{
  "status": "calling",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "phone_number": "+1234567890",
  "alert_type": "call",
  "message": "Calling +1234567890. Call SID: CAxxxxxxxx"
}
```

**cURL:**

```bash
curl -X POST http://localhost:8080/session/alert/call \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-TEST0041-20260117170000",
    "phone_number": "+1234567890"
  }'
```

**What the doctor hears:**

> "Medical emergency. HIGH urgency. Patient TEST0041 at Station-A.
> Possible cardiac event. Check your SMS for the link to join immediately."

---

### 3. Send Alert SMS

Send SMS with join link to doctor.

```
POST http://localhost:8080/session/alert/sms
```

**Request:**

```json
{
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "phone_number": "+1234567890",
  "message": "🚨 MEDICAL ALERT\nPatient: TEST0041\nLocation: Station-A\nJoin now: http://..."
}
```

**Response:**

```json
{
  "status": "sent",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "phone_number": "+1234567890",
  "alert_type": "sms",
  "message": "SMS sent to +1234567890. Message SID: SMxxxxxxxx"
}
```

**cURL:**

```bash
curl -X POST http://localhost:8080/session/alert/sms \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-TEST0041-20260117170000",
    "phone_number": "+1234567890"
  }'
```

**SMS the doctor receives:**

```
🚨 MEDICAL ALERT
Patient: TEST0041
Location: Station-A
Join now: http://localhost:3000/join?room=triage-...&token=eyJ...
```

---

### 4. Trigger Emergency Alerts (Call + SMS)

**This is the main endpoint used by the agent.** Triggers BOTH call and SMS to all contacts.

```
POST http://localhost:8080/session/emergency-alert
```

**Request:**

```json
{
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "assessment": "Possible cardiac event - chest pain radiating to left arm",
  "urgency": "HIGH",
  "phone_numbers": ["+1234567890", "+0987654321"],
  "send_sms": true,
  "make_call": true
}
```

| Field           | Required | Description                     |
| --------------- | -------- | ------------------------------- |
| `room_name`     | Yes      | Room name                       |
| `assessment`    | Yes      | Medical assessment from council |
| `urgency`       | Yes      | HIGH, MEDIUM, LOW               |
| `phone_numbers` | No       | Override default contacts       |
| `send_sms`      | No       | Send SMS (default: true)        |
| `make_call`     | No       | Make call (default: true)       |

**Response:**

```json
{
  "status": "alerts_triggered",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "urgency": "HIGH",
  "join_url": "http://localhost:3000/join?room=...",
  "results": [
    { "phone": "+1234567890", "type": "sms", "status": "sent" },
    { "phone": "+1234567890", "type": "call", "status": "calling" },
    { "phone": "+0987654321", "type": "sms", "status": "sent" },
    { "phone": "+0987654321", "type": "call", "status": "calling" }
  ],
  "message": "Triggered 4 alerts to 2 contacts"
}
```

**cURL:**

```bash
curl -X POST http://localhost:8080/session/emergency-alert \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-TEST0041-20260117170000",
    "assessment": "Possible cardiac event",
    "urgency": "HIGH",
    "phone_numbers": ["+1234567890"]
  }'
```

---

### 5. End Session

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

---

### 6. Get Session Status

```
GET http://localhost:8080/session/{room_name}/status
```

**Response:**

```json
{
  "status": "active",
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "patient_id": "TEST0041",
  "location": "Station-A",
  "started_at": "2026-01-17T17:00:00",
  "join_url": "http://localhost:3000/join?room=...",
  "participants": [
    { "identity": "user-TEST0041", "name": "Patient TEST0041", "joined": true },
    { "identity": "doctor-on-call", "name": "Doctor", "joined": true }
  ],
  "participant_count": 2,
  "alerts_sent": [
    {
      "phone": "+1234567890",
      "type": "sms",
      "status": "sent",
      "timestamp": "..."
    },
    {
      "phone": "+1234567890",
      "type": "call",
      "status": "initiated",
      "timestamp": "..."
    }
  ],
  "emergency_phones": ["+1234567890"]
}
```

---

### 7. Get Alerts for Room

```
GET http://localhost:8080/session/{room_name}/alerts
```

**Response:**

```json
{
  "room_name": "triage-Station-A-TEST0041-20260117170000",
  "alerts": [
    {
      "phone": "+1234567890",
      "type": "sms",
      "status": "sent",
      "message_sid": "SMxxxxxxxx",
      "timestamp": "2026-01-17T17:05:00"
    },
    {
      "phone": "+1234567890",
      "type": "call",
      "status": "initiated",
      "call_sid": "CAxxxxxxxx",
      "timestamp": "2026-01-17T17:05:01"
    }
  ]
}
```

---

### 8. Health Check

```
GET http://localhost:8080/health
```

**Response:**

```json
{
  "status": "healthy",
  "config": {
    "livekit_url": true,
    "livekit_api_key": true,
    "livekit_api_secret": true,
    "twilio_account_sid": true,
    "twilio_auth_token": true,
    "twilio_phone_number": true
  }
}
```

---

## Complete Test Scenarios

### Scenario 1: Normal Conversation (No Alerts)

```bash
# Start session
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "NORMAL001", "location": "Station-A", "hardware_id": "hw-001"}'

# Classification returns NORMAL - no alerts sent
curl -X POST https://urchin-app-uibbb.ondigitalocean.app/api/classify \
  -H "Content-Type: application/json" \
  -d '{"text": [{"assistant": "", "human": "mild headache"}], "patient_id": "NORMAL001", "location": "Station-A"}'

# Check status - no alerts
curl http://localhost:8080/session/triage-Station-A-NORMAL001-.../status

# End session
curl -X POST http://localhost:8080/session/end \
  -H "Content-Type: application/json" \
  -d '{"room_name": "triage-Station-A-NORMAL001-..."}'
```

---

### Scenario 2: Emergency - Alerts Triggered

```bash
# Start session with emergency contacts
curl -X POST http://localhost:8080/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "EMERG001",
    "location": "Station-B",
    "hardware_id": "hw-002",
    "emergency_phones": ["+1234567890"]
  }'

# Save the room_name from response

# Classification returns CRITICAL
curl -X POST https://urchin-app-uibbb.ondigitalocean.app/api/classify \
  -H "Content-Type: application/json" \
  -d '{"text": [{"assistant": "", "human": "severe chest pain, cant breathe"}], "patient_id": "EMERG001", "location": "Station-B"}'

# Council confirms
curl -X POST https://urchin-app-uibbb.ondigitalocean.app/api/council \
  -H "Content-Type: application/json" \
  -d '{"text": [{"assistant": "", "human": "severe chest pain"}], "patient_id": "EMERG001", "location": "Station-B"}'

# Trigger alerts (normally done by agent automatically)
curl -X POST http://localhost:8080/session/emergency-alert \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-B-EMERG001-...",
    "assessment": "Possible cardiac event",
    "urgency": "HIGH"
  }'

# Doctor's phone:
# 1. Rings with voice message
# 2. SMS arrives with join link
# 3. Doctor clicks link → joins room via web → talks to patient
```

---

### Scenario 3: SMS Only (No Call)

```bash
curl -X POST http://localhost:8080/session/emergency-alert \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-TEST001-...",
    "assessment": "Moderate symptoms",
    "urgency": "MEDIUM",
    "send_sms": true,
    "make_call": false
  }'
```

---

### Scenario 4: Call Only (No SMS)

```bash
curl -X POST http://localhost:8080/session/emergency-alert \
  -H "Content-Type: application/json" \
  -d '{
    "room_name": "triage-Station-A-TEST001-...",
    "assessment": "Critical emergency",
    "urgency": "HIGH",
    "send_sms": false,
    "make_call": true
  }'
```

---

## Twilio Setup

### 1. Create Twilio Account

- Go to https://www.twilio.com
- Sign up and verify your account

### 2. Get Credentials

- Go to Console → Account Info
- Copy **Account SID** and **Auth Token**

### 3. Get a Phone Number

- Go to Phone Numbers → Manage → Buy a number
- Choose a number with Voice and SMS capability
- Copy the phone number

### 4. Configure .env

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

### 5. For Testing (Trial Account)

- Twilio trial accounts can only call/SMS **verified numbers**
- Go to Phone Numbers → Verified Caller IDs
- Add and verify the phone numbers you want to test with

---

## Environment Variables

```bash
# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxx
LIVEKIT_API_SECRET=your-secret

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE_NUMBER=+1234567890

# Emergency contacts (fallback)
EMERGENCY_PHONE_NUMBERS=+1234567890,+0987654321

# URLs
LLM_BACKEND_URL=https://urchin-app-uibbb.ondigitalocean.app
ROOM_MANAGER_URL=http://localhost:8080
FRONTEND_URL=http://localhost:3000
```

---

## Troubleshooting

| Issue                                         | Solution                                               |
| --------------------------------------------- | ------------------------------------------------------ |
| "Twilio credentials not configured"           | Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env |
| "Unable to create record"                     | Twilio trial - verify the destination number first     |
| "The 'To' number is not a valid phone number" | Use E.164 format: +1234567890                          |
| SMS not received                              | Check Twilio logs at console.twilio.com                |
| Call goes to voicemail                        | Normal - doctor can still get SMS and join             |

---

## Doctor Join Flow

```
1. Emergency confirmed
          │
          ▼
2. Doctor receives:
   📞 Phone call: "Medical emergency at Station-A..."
   📱 SMS: "🚨 MEDICAL ALERT... Join now: http://..."
          │
          ▼
3. Doctor clicks link in SMS
          │
          ▼
4. Browser opens: http://localhost:3000/join?room=...&token=...
          │
          ▼
5. Doctor joins LiveKit room via web
          │
          ▼
6. Doctor can now talk to patient in real-time!
```
