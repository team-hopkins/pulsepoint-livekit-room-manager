# Nexhacks Frontend

This is the Next.js frontend for the Nexhacks medical consultation platform.

## Setup

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Features

- **Join Confirmation Page**: Displays patient ID and urgency level before joining the consultation
- **Live Session View**: Real-time monitoring of the AI agent's status and session information
- **LiveKit Integration**: Uses LiveKit for audio/video communication with the AI agent

## How to Use

1. Pass the room payload from the backend to the frontend via URL parameters or localStorage:
   - `token`: JWT token for authentication
   - `roomId`: LiveKit room ID
   - `patientId`: Patient identifier
   - `likeKitUrl`: LiveKit server URL

2. The user will see a confirmation page with:
   - Patient ID
   - Urgency level (HIGH, MEDIUM, NORMAL)
   - Terms of service

3. After confirming, the session view opens showing:
   - Agent status (Listening, Processing, Speaking)
   - Number of participants
   - Session information

## Environment Variables

Create a `.env.local` file if needed for any custom configuration.

## Building for Production

```bash
npm run build
npm start
```
