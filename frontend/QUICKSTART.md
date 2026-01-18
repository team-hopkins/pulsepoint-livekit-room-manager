# Frontend Quick Start

## Installation

```bash
cd frontend
npm install
```

## Development Server

```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`

## How It Works

### Receiving Room Details

The frontend expects room details via URL parameters:

```
http://localhost:3000?token=JWT_TOKEN&roomId=ROOM_ID&patientId=PATIENT_ID&likeKitUrl=LIVEKIT_URL
```

You can test it by:

1. **Completing triage on the backend:**
   ```bash
   curl -X POST http://localhost:8000/triage/complete \
     -H "Content-Type: application/json" \
     -d '{"patient_id": "TEST00412"}'
   ```

2. **Getting the meeting URL:**
   ```bash
   curl -X POST http://localhost:8000/get-patient-meeting-url \
     -H "Content-Type: application/json" \
     -d '{"patient_id": "TEST00412"}'
   ```

3. **Opening the returned `meeting_url` in a browser**

### Confirmation Page

When you open the link:
1. A confirmation dialog appears
2. Shows patient ID and urgency level
3. Click "Join Session" to proceed

### Active Session

Once confirmed:
1. Frontend connects to LiveKit room
2. Audio is automatically enabled
3. You'll see agent status updates:
   - **Listening**: Agent is listening to your input
   - **Processing**: Agent is thinking about your query
   - **Speaking**: Agent is responding
4. Real-time participant count and connection status

## Features

✅ Confirmation before joining  
✅ Real-time agent status display  
✅ Automatic microphone handling  
✅ Session duration tracking  
✅ Clean, modern UI with Tailwind CSS  
✅ Responsive design for all devices  

## Testing Locally

### Scenario 1: Manual URL Testing

```bash
# 1. Start backend
cd /Users/joybhalla/nexhacks
python main.py

# 2. Start frontend
cd /Users/joybhalla/nexhacks/frontend
npm run dev

# 3. In another terminal, trigger triage
curl -X POST http://localhost:8000/triage/complete \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST00412"}'

# 4. Copy the patient_token, room_id, etc. from response
# 5. Build URL manually: http://localhost:3000?token=TOKEN&roomId=ROOM_ID&...
# 6. Open in browser
```

### Scenario 2: Using the Backend Endpoint

```bash
# Get the full meeting URL directly
curl -X POST http://localhost:8000/get-patient-meeting-url \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST00412"}'

# Copy the meeting_url from response and open in browser
```

## Build for Production

```bash
npm run build
npm start
```

## Environment Variables

Optional `.env.local` file (most settings come from URL parameters):

```env
# If needed for custom backend URLs
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Troubleshooting

**Issue: Page stuck on "Loading..."**
- Check browser console for errors (F12)
- Verify backend is running and accessible
- Check network tab for failed requests

**Issue: "Failed to connect to LiveKit"**
- Verify livekit_url parameter is correct
- Check token hasn't expired
- Ensure LiveKit server is accessible

**Issue: Microphone not working**
- Check browser microphone permissions
- Try in incognito mode
- Test microphone in OS settings

## File Structure

```
frontend/
├── app/
│   ├── page.tsx              # Main page, handles URL params and room logic
│   ├── layout.tsx            # App layout with metadata
│   └── globals.css           # Tailwind styles
├── components/
│   ├── join-confirmation.tsx # Pre-join dialog showing patient info
│   └── session-view.tsx      # Active session with agent status
├── lib/
│   └── types.ts              # TypeScript type definitions
├── package.json              # Dependencies
├── next.config.ts            # Next.js configuration
└── tailwind.config.js        # Tailwind CSS config
```

## Backend Integration Points

The frontend communicates with:

1. **Initial page load:** Parses URL parameters (no backend call needed)
2. **LiveKit connection:** Connects directly to LiveKit server using token

No direct API calls to backend from frontend - all room details come via URL parameters for security.

## Next Steps

- See [FRONTEND_INTEGRATION.md](../FRONTEND_INTEGRATION.md) for complete architecture
- Check [LiveKit Components Documentation](https://docs.livekit.io/components/react/)
- Deploy to production when ready
