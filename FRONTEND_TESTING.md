# Frontend Testing Guide

## Prerequisites

- Backend running at `http://localhost:8000`
- Frontend running at `http://localhost:3000`
- MongoDB with sample patient data
- LiveKit server credentials configured

## Full Integration Test

### Step 1: Verify Patient Exists

First, ensure you have a patient in MongoDB with sample data:

```bash
# Check MongoDB directly or via backend
curl http://localhost:8000/health

# Expected response indicates backend is running
```

### Step 2: Complete Triage

```bash
curl -X POST http://localhost:8000/triage/complete \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST00412"}'
```

**Expected Response:**
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

### Step 3: Get Patient Meeting URL

```bash
curl -X POST http://localhost:8000/get-patient-meeting-url \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST00412"}'
```

**Expected Response:**
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

### Step 4: Open Frontend URL

Copy the `meeting_url` from the response and open it in a browser:

```
http://localhost:3000?token=eyJ...&roomId=patient_TEST00412_1768720519&patientId=TEST00412&likeKitUrl=wss://...
```

### Step 5: Test Confirmation Page

**What you should see:**
- Title: "Join Consultation"
- Patient ID: "TEST00412"
- Urgency badge: "HIGH" (in red)
- "Join Session" and "Cancel" buttons
- Terms of service footer

**Actions:**
- Click "Cancel" → page closes (modal disappears)
- Click "Join Session" → proceeds to session view

### Step 6: Test Session View

After clicking "Join Session", you should see:

**What you should see:**
- Title: "Patient Consultation"
- Patient ID displayed
- "End Session" button (top right)
- Agent status indicator (circular badge)
- Current agent state (Listening, Processing, Speaking, Connecting)
- Number of participants
- Status information cards:
  - Current state
  - Session duration
  - Connection status

**What happens next:**
- If agent connects: You'll see agent state changes
- If agent is speaking: The status badge pulses/changes color
- Participants count updates as people join

### Step 7: End Session

Click the "End Session" button in the top right. You should:
- Disconnect from LiveKit room
- Return to confirmation page (or close the session)

## Automated Testing Script

Create `test-frontend.sh`:

```bash
#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Starting Nexhacks Frontend Integration Test..."
echo "=============================================="

# Configuration
BACKEND_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:3000"
PATIENT_ID="TEST00412"

# Test 1: Backend Health
echo -e "\n${YELLOW}Test 1: Checking Backend Health...${NC}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" ${BACKEND_URL}/health 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ] || [ "$HEALTH" = "404" ]; then
    echo -e "${GREEN}✓ Backend is running${NC}"
else
    echo -e "${RED}✗ Backend is not responding (HTTP $HEALTH)${NC}"
    exit 1
fi

# Test 2: Complete Triage
echo -e "\n${YELLOW}Test 2: Completing Triage...${NC}"
TRIAGE_RESPONSE=$(curl -s -X POST ${BACKEND_URL}/triage/complete \
  -H "Content-Type: application/json" \
  -d "{\"patient_id\": \"${PATIENT_ID}\"}")

if echo "$TRIAGE_RESPONSE" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ Triage completed successfully${NC}"
    ROOM_ID=$(echo "$TRIAGE_RESPONSE" | grep -o '"room_id":"[^"]*"' | cut -d'"' -f4)
    echo "  Room ID: $ROOM_ID"
else
    echo -e "${RED}✗ Triage failed${NC}"
    echo "$TRIAGE_RESPONSE"
    exit 1
fi

# Test 3: Get Meeting URL
echo -e "\n${YELLOW}Test 3: Generating Meeting URL...${NC}"
MEETING_RESPONSE=$(curl -s -X POST ${BACKEND_URL}/get-patient-meeting-url \
  -H "Content-Type: application/json" \
  -d "{\"patient_id\": \"${PATIENT_ID}\"}")

if echo "$MEETING_RESPONSE" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ Meeting URL generated successfully${NC}"
    MEETING_URL=$(echo "$MEETING_RESPONSE" | grep -o '"meeting_url":"[^"]*"' | cut -d'"' -f4)
    echo -e "  URL: ${MEETING_URL}"
    echo -e "\n${GREEN}✓ All tests passed!${NC}"
    echo -e "\n${YELLOW}Next steps:${NC}"
    echo "1. Open the meeting URL in a browser"
    echo "2. Click 'Join Session' on the confirmation page"
    echo "3. Verify you connect to the LiveKit room"
else
    echo -e "${RED}✗ Meeting URL generation failed${NC}"
    echo "$MEETING_RESPONSE"
    exit 1
fi
```

Run with:
```bash
chmod +x test-frontend.sh
./test-frontend.sh
```

## Manual Browser Testing

### Test Case 1: Confirmation Page Display

**Setup:**
1. Open meeting URL in browser
2. Check DevTools Console (F12) for any errors

**Expected:**
- ✓ Confirmation dialog appears immediately
- ✓ Patient ID is correct
- ✓ Urgency level matches database
- ✓ Buttons are clickable

**Steps:**
1. Click Cancel → dialog closes, page is blank
2. Reload page
3. Click Join Session → moves to session view

### Test Case 2: Session View Display

**Setup:**
1. Complete Test Case 1 and click "Join Session"

**Expected:**
- ✓ Session view appears (full-screen)
- ✓ Agent status shows as "Connecting"
- ✓ Header shows patient ID
- ✓ "End Session" button is visible
- ✓ Participant count shows >= 1

**Interactions:**
1. Watch for agent state changes (if agent joins)
2. Verify audio icon appears for agent
3. Click "End Session" → disconnects and returns to blank state

### Test Case 3: Error Handling

**Test with invalid patient ID:**

```bash
curl -X POST http://localhost:8000/get-patient-meeting-url \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "INVALID_PATIENT"}'
```

Expected: Error response with message

**Test with missing triage:**

```bash
# Create new patient without triage
curl -X POST http://localhost:8000/get-patient-meeting-url \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "NEW_PATIENT_WITHOUT_TRIAGE"}'
```

Expected: Error about no LiveKit room found

### Test Case 4: URL Parameter Validation

**Test with missing parameters:**

```
http://localhost:3000?token=abc&roomId=def
# Missing patientId and likeKitUrl
```

Expected: Frontend handles gracefully or shows error

**Test with malformed token:**

```
http://localhost:3000?token=invalid&roomId=room&patientId=patient&likeKitUrl=url
```

Expected: Connection fails with clear error message

## Debugging Tips

### Browser DevTools

1. Open F12 (Developer Tools)
2. Check Console tab for errors
3. Check Network tab for API calls
4. Check Application/Storage for localStorage

### Backend Logs

Watch backend terminal output:
```bash
# If running with uvicorn
[INFO] GET /get-patient-meeting-url
[INFO] Response: 200 OK
```

### LiveKit Connection Issues

In browser console:
```javascript
// Check room state
room.state // Should be "connected"
room.participants.size // Should show participants
```

## Performance Testing

### Page Load Time

```bash
# Measure frontend load time
time curl -I http://localhost:3000
```

Expected: < 500ms

### API Response Time

```bash
# Measure triage completion
time curl -X POST http://localhost:8000/triage/complete \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "TEST00412"}'
```

Expected: < 1000ms

## Success Criteria

- ✅ Confirmation page shows correct patient info
- ✅ Urgency level displays with correct color
- ✅ Join Session button connects to room
- ✅ Session view shows agent status
- ✅ End Session button disconnects properly
- ✅ Error messages are clear and helpful
- ✅ No console errors in DevTools
- ✅ Page works on mobile (responsive)

## Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| "Loading..." forever | Check backend is running, verify URL parameters |
| "Connection failed" | Check LiveKit credentials, verify token validity |
| Confirmation not showing | Clear browser cache, check console errors |
| "Participant count not updating" | Refresh page, check LiveKit connection status |
| Microphone not working | Check browser permissions, test in incognito |

## Next Steps

- [ ] Test with real LiveKit agent
- [ ] Test on mobile devices
- [ ] Test with different browsers
- [ ] Load test with multiple concurrent users
- [ ] Test error recovery scenarios
