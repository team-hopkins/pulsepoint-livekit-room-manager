# Medical Note-Taking Agent Setup

This guide will help you set up and run the AI-powered medical note-taking and transcription agent.

## Prerequisites

1. **LiveKit Cloud Account**: Get your credentials from [LiveKit Cloud](https://cloud.livekit.io)
2. **OpenAI API Key**: For LLM-powered note generation
3. **Deepgram API Key**: For medical-grade speech-to-text

## Installation

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy the example environment file and add your credentials:

```bash
cp .env.agent.example .env
```

Edit `.env` and add:

```bash
# LiveKit Configuration
LIVEKIT_URL=wss://your-livekit-url.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Deepgram Configuration
DEEPGRAM_API_KEY=your_deepgram_api_key
```

## Running the Agent

### Option 1: Development Mode (Auto-connects to new rooms)

```bash
./run_agent.sh
```

Or manually:

```bash
python agent.py dev
```

### Option 2: Connect to Specific Room

```bash
python agent.py connect --room <room_name>
```

## How It Works

### 1. Agent Lifecycle

- Agent automatically joins when a doctor connects to a patient room
- Listens to audio from all participants
- Processes speech in real-time using Deepgram STT
- Generates medical notes using GPT-4

### 2. Data Flow

```
Patient/Doctor Speech → Deepgram STT → Transcription
                                              ↓
                                   LiveKit Data Channel
                                              ↓
                                    Frontend (Real-time)

Transcription Buffer (5 messages) → GPT-4 → SOAP Notes
                                              ↓
                                   LiveKit Data Channel
                                              ↓
                                    Frontend (Real-time)
```

### 3. Message Types

The agent sends JSON messages via LiveKit Data Channel:

#### Transcription Messages
```json
{
  "type": "transcription",
  "content": "Patient reports headache for 3 days...",
  "timestamp": "2026-01-18T10:30:00Z"
}
```

#### Notes Messages
```json
{
  "type": "notes",
  "content": "## Subjective\n- Chief Complaint: Headache...",
  "timestamp": "2026-01-18T10:31:00Z"
}
```

#### Diagnosis Messages
```json
{
  "type": "diagnosis",
  "content": "**Primary Diagnosis**: Tension headache...",
  "timestamp": "2026-01-18T10:35:00Z"
}
```

### 4. Frontend Integration

The frontend automatically receives these messages and displays them in:
- **Live Transcription Panel**: Shows recent speech-to-text
- **Medical Notes Panel**: Shows accumulated SOAP notes in markdown

## Frontend Commands

The frontend can send commands to the agent:

```typescript
// Request diagnosis
sendCommandToAgent("request_diagnosis")

// Generate consultation summary
sendCommandToAgent("generate_summary")
```

## SOAP Note Format

The agent generates structured medical notes in SOAP format:

```markdown
## Subjective
- Chief Complaint: [symptoms]
- History of Present Illness: [details]
- Past Medical History: [relevant history]

## Objective
- Vital Signs: [if mentioned]
- Physical Examination: [observations]

## Assessment
- Primary Diagnosis: [diagnosis]
- Differential Diagnosis: [alternatives]

## Plan
- Treatment: [medications, procedures]
- Follow-up: [instructions]
- Patient Education: [guidance]
```

## Testing

### 1. Start Backend
```bash
uvicorn main:app --reload
```

### 2. Start Agent
```bash
./run_agent.sh
```

### 3. Start Frontend
```bash
cd frontend
npm run dev
```

### 4. Join a Room
1. Navigate to `http://localhost:3000/doctor`
2. Click "Join Consultation" on a patient card
3. Start speaking - watch transcription and notes appear in real-time

## Troubleshooting

### Agent won't connect
- Check LIVEKIT_URL, API_KEY, and API_SECRET are correct
- Verify room exists before agent tries to connect

### No transcription appearing
- Check DEEPGRAM_API_KEY is valid
- Ensure microphone permissions are granted
- Check browser console for errors

### Notes not generating
- Check OPENAI_API_KEY is valid
- Verify at least 5 transcription messages have been collected
- Check agent logs for errors

### Frontend not receiving messages
- Check browser console for "Received data from agent" logs
- Verify LiveKit Data Channel is working
- Check room connection status

## Architecture

```
┌─────────────┐
│   Backend   │
│  (FastAPI)  │
└──────┬──────┘
       │
       │ Spawns Agent
       ↓
┌─────────────────────────────┐
│   Medical Note Agent        │
│  ┌──────────────────────┐  │
│  │  Deepgram STT        │  │
│  └──────────────────────┘  │
│  ┌──────────────────────┐  │
│  │  GPT-4 LLM           │  │
│  └──────────────────────┘  │
│  ┌──────────────────────┐  │
│  │  LiveKit Data Channel│  │
│  └──────────────────────┘  │
└─────────────────────────────┘
       │
       │ Real-time Data
       ↓
┌─────────────┐
│   Frontend  │
│  (Next.js)  │
└─────────────┘
```

## Production Deployment

For production, you'll want to:

1. Deploy agent as a separate service
2. Use process manager (PM2, Supervisor, etc.)
3. Add agent monitoring and health checks
4. Scale agents horizontally for multiple rooms
5. Add error recovery and reconnection logic

Example with PM2:

```bash
pm2 start agent.py --name medical-agent --interpreter python3
pm2 save
pm2 startup
```

## Cost Considerations

- **Deepgram**: ~$0.0125 per minute of audio
- **OpenAI GPT-4**: ~$0.03 per 1K tokens
- **LiveKit**: Free tier available, then usage-based

Typical 15-minute consultation:
- Deepgram: $0.19
- OpenAI: ~$0.10-0.20
- Total: ~$0.30-0.40 per consultation
