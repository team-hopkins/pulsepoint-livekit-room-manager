# Nexhacks Frontend Integration Guide

This guide explains how the frontend integrates with the backend to create a complete patient consultation experience.

## Architecture Overview

```
Backend (FastAPI) -> Frontend (Next.js) -> LiveKit Agent
                  ↓
              MongoDB
```

## Workflow

### 1. Triage Completion

When triage is completed via the `/triage/complete` endpoint:

```python
POST /triage/complete
{
    "patient_id": "TEST00412"
}
```

**Response:**
```json
{
    "status": "success",
    "message": "Triage complete, LiveKit room created",
    "patient_id": "TEST00412",
    "room_id": "patient_TEST00412_1768720519",
    "patient_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "livekit_url": "wss://your-livekit.cloud",
    "patient_meet_url": "https://meet.livekit.io/custom/?...",
    "urgency": "HIGH",
    "mongodb_updated": true
}
```

The backend:
- Creates a LiveKit room
- Generates authentication tokens
- Stores room info in MongoDB
- Returns all necessary data

### 2. Generate Patient Meeting URL

To get a shareable link for the patient:

```python
POST /get-patient-meeting-url
{
    "patient_id": "TEST00412"
}
```

**Response:**
```json
{
    "status": "success",
    "message": "Patient meeting URL generated",
    "patient_id": "TEST00412",
    "meeting_url": "http://localhost:3000?token=eyJ...&roomId=patient_TEST00412_1768720519&patientId=TEST00412&likeKitUrl=wss://...",
    "urgency": "HIGH",
    "room_id": "patient_TEST00412_1768720519"
}
```

### 3. Patient Accesses Frontend

The patient receives the `meeting_url` and opens it in their browser.

The frontend (`http://localhost:3000?...`) will:

1. **Parse URL Parameters:**
   - `token`: JWT for LiveKit authentication
   - `roomId`: Room identifier
   - `patientId`: Patient identifier
   - `likeKitUrl`: LiveKit server URL

2. **Show Confirmation Page:**
   - Patient ID display
   - Urgency level badge (HIGH/MEDIUM/NORMAL)
   - Terms and conditions
   - Buttons to confirm or cancel

3. **Establish LiveKit Connection:**
   - On confirmation, connects to the LiveKit room
   - Enables audio automatically
   - Shows session status (Listening, Processing, Speaking)
   - Displays participant information

## Environment Setup

### Backend (.env)

```env
# LiveKit Configuration
LIVEKIT_URL=wss://your-livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Frontend URL (where the Next.js app is hosted)
FRONTEND_URL=http://localhost:3000
# For production: FRONTEND_URL=https://your-domain.com

# MongoDB Configuration
MONGODB_URL=mongodb+srv://user:pass@cluster.mongodb.net
DATABASE_NAME=carepoint_medical
COLLECTION_NAME=consultations
```

### Frontend (.env.local)

```env
# No required environment variables for development
# The frontend receives all necessary data via URL parameters
```

## Running the Applications

### Start Backend
```bash
cd /Users/joybhalla/nexhacks
pip install -r requirements.txt
python main.py
# Backend runs on http://localhost:8000
```

### Start Frontend
```bash
cd /Users/joybhalla/nexhacks/frontend
npm install
npm run dev
# Frontend runs on http://localhost:3000
```

## Data Flow Example

```
1. Doctor initiates triage for patient "TEST00412"
   ↓
2. Backend receives POST /triage/complete
   ├─ Creates LiveKit room
   ├─ Generates patient token
   ├─ Stores in MongoDB
   └─ Returns room details
   ↓
3. System calls POST /get-patient-meeting-url
   ├─ Retrieves patient data
   ├─ Builds meeting URL with parameters
   └─ Returns shareable link
   ↓
4. Patient clicks/receives link
   ├─ http://localhost:3000?token=...&roomId=...&patientId=...&likeKitUrl=...
   ↓
5. Frontend loads and parses parameters
   ├─ Shows confirmation page
   └─ Displays: Patient ID, Urgency level
   ↓
6. Patient clicks "Join Session"
   ├─ Frontend connects to LiveKit room
   ├─ Shows session view with agent status
   └─ Audio is enabled automatically
   ↓
7. Patient talks to AI Agent
   ├─ Agent listens, processes, responds
   ├─ UI shows agent state in real-time
   └─ Session information displayed
```

## Frontend Features

### Join Confirmation Page
- **Displays:**
  - Patient ID
  - Urgency level (with color coding)
    - RED: HIGH urgency
    - YELLOW: MEDIUM urgency  
    - GREEN: NORMAL urgency
  - Information about the session
  - Accept/Cancel buttons

### Session View
- **Shows:**
  - Agent status (Listening, Processing, Speaking)
  - Number of participants in room
  - Session duration
  - Connection status
  - End session button
  - Real-time agent state updates

## Component Structure

```
frontend/
├── app/
│   ├── page.tsx              # Main entry point
│   ├── layout.tsx            # Root layout
│   └── globals.css           # Tailwind CSS
├── components/
│   ├── join-confirmation.tsx # Confirmation dialog
│   └── session-view.tsx      # Active session display
├── lib/
│   └── types.ts              # TypeScript interfaces
└── tailwind.config.js        # Tailwind configuration
```

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/triage/complete` | POST | Complete triage and create room |
| `/get-patient-meeting-url` | POST | Generate patient meeting URL |
| `/doctor/join` | POST | Add doctor to room |
| `/session/end` | POST | End patient session |
| `/emergency/alert` | POST | Send emergency alert |

## Troubleshooting

### "No LiveKit room found for this patient"
- Make sure triage was completed first via `/triage/complete`
- Check MongoDB has the patient record with `livekit_room` field

### Patient page shows "Loading..." forever
- Verify `FRONTEND_URL` environment variable is set correctly
- Check network requests in browser DevTools
- Ensure backend is running and accessible

### Audio not working
- Check browser microphone permissions
- Verify LiveKit server is accessible
- Check LiveKit token is valid (not expired)

### Room connection fails
- Verify LiveKit URL and tokens are correct
- Check LiveKit server logs
- Ensure patient_token has `room_join` grant for the room

## Production Deployment

### Backend
- Deploy FastAPI app to a server/cloud platform
- Update `FRONTEND_URL` to production domain
- Set proper CORS headers if frontend is on different domain

### Frontend
- Build: `npm run build`
- Deploy Next.js app to Vercel, Netlify, or self-hosted
- Update `next.config.ts` with production domain if needed
- Ensure environment variables are set in deployment platform

## Security Considerations

1. **Token Expiration:** LiveKit tokens expire (set in token generation)
2. **CORS:** Configure backend CORS for frontend domain
3. **HTTPS:** Use HTTPS in production for token transmission
4. **MongoDB:** Use connection strings with proper authentication
5. **API Keys:** Never expose LiveKit API keys in frontend code (they're server-side only)

## Future Enhancements

- [ ] Chat feature during consultation
- [ ] Screen sharing capability
- [ ] Session recording and playback
- [ ] Vitals monitoring integration
- [ ] Prescription generation UI
- [ ] Follow-up appointment scheduling
