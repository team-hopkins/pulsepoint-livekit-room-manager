# Postman Testing Guide - Triage + LiveKit Integration

## Base URL

```
https://urchin-app-uibbb.ondigitalocean.app
```

---

## 1. ✅ Health Check

Test if the server is running

**Method:** `GET`  
**Endpoint:** `https://urchin-app-uibbb.ondigitalocean.app/health`  
**Headers:** None  
**Body:** None

**Expected Response:**

```json
{
  "status": "healthy"
}
```

---

## 2. 🏥 Complete Triage (Create Room)

**This is the main endpoint to test!** Call this right after your triage agent completes assessment.

**Method:** `POST`  
**Endpoint:** `https://urchin-app-uibbb.ondigitalocean.app/triage/complete`  
**Headers:**

```
Content-Type: application/json
```

**Body (raw JSON):**

```json
{
  "patient_id": "TEST0041"
}
```

**Expected Response:**

```json
{
  "status": "success",
  "message": "Triage complete, LiveKit room created",
  "patient_id": "TEST0041",
  "room_id": "patient_TEST0041_1737146924",
  "patient_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "livekit_url": "wss://abcd-vaim7omd.livekit.cloud",
  "urgency": "HIGH",
  "mongodb_updated": true
}
```

**What this does:**

- ✅ Fetches patient data from MongoDB using patient_id
- ✅ Creates a LiveKit room for the patient
- ✅ Generates a patient token (patient can join immediately)
- ✅ Stores room_id in MongoDB
- ✅ Sets status to "waiting_for_doctor"
- ✅ Extracts urgency and confidence from existing triage data

**Note:** The patient must already exist in MongoDB with triage data before calling this endpoint.

---

## 3. 🔍 Get Room Status

Check if a patient has an active room

**Method:** `GET`  
**Endpoint:** `https://urchin-app-uibbb.ondigitalocean.app/patient/TEST0041/room-status`  
**Headers:** None  
**Body:** None

**Expected Response:**

```json
{
  "patient_id": "TEST0041",
  "has_room": true,
  "room_status": {
    "room_id": "patient_TEST0041_1737146924",
    "room_name": "patient_TEST0041_1737146924",
    "created_at": "2026-01-17T20:35:24.123Z",
    "status": "waiting_for_doctor",
    "livekit_url": "wss://abcd-vaim7omd.livekit.cloud",
    "doctor_id": null,
    "doctor_joined_at": null
  },
  "triage_urgency": "HIGH",
  "triage_confidence": 0.9
}
```

---

## 4. 👨‍⚕️ Doctor Joins Room

Generate a token for doctor to join the patient's room

**Method:** `POST`  
**Endpoint:** `https://urchin-app-uibbb.ondigitalocean.app/doctor/join-room`  
**Headers:**

```
Content-Type: application/json
```

**Body (raw JSON):**

```json
{
  "patient_id": "TEST0041",
  "doctor_id": "DR456"
}
```

**Expected Response:**

```json
{
  "status": "success",
  "message": "Doctor token generated",
  "patient_id": "TEST0041",
  "doctor_id": "DR456",
  "room_id": "patient_TEST0041_1737146924",
  "doctor_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "livekit_url": "wss://abcd-vaim7omd.livekit.cloud"
}
```

**What this does:**

- ✅ Fetches room_id from MongoDB using patient_id
- ✅ Generates doctor token to join existing room
- ✅ Updates MongoDB with doctor info
- ✅ Sets status to "doctor_joined"

---

## 5. 🛑 End Session

End the consultation and delete the room

**Method:** `POST`  
**Endpoint:** `https://urchin-app-uibbb.ondigitalocean.app/session/end/TEST0041`  
**Headers:** None  
**Body:** None

**Expected Response:**

```json
{
  "status": "success",
  "message": "Session ended",
  "patient_id": "TEST0041",
  "room_id": "patient_TEST0041_1737146924"
}
```

**What this does:**

- ✅ Deletes the LiveKit room
- ✅ Updates MongoDB status to "completed"
- ✅ Cleans up active rooms cache

---

## 6. 🔧 Legacy: Hardware Input (Unchanged)

Your existing endpoint for hardware data

**Method:** `POST`  
**Endpoint:** `https://urchin-app-uibbb.ondigitalocean.app/hardware/input`  
**Headers:**

```
Content-Type: application/json
```

**Body (raw JSON):**

```json
{
  "patient_id": "TEST0041",
  "text": "I have a headache and feel dizzy",
  "frame": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
  "metadata": {
    "timestamp": "2026-01-17T10:30:00Z",
    "device_id": "HW001",
    "session_id": "session_TEST0041"
  }
}
```

---

## 7. 🔧 Legacy: Session Control (Unchanged)

Your existing endpoint for session management

**Method:** `POST`  
**Endpoint:** `https://urchin-app-uibbb.ondigitalocean.app/session/control`  
**Headers:**

```
Content-Type: application/json
```

**Body (raw JSON) - Start Session:**

```json
{
  "flag": "on",
  "patient_id": "TEST0041",
  "doctor_id": "DR456"
}
```

**Body (raw JSON) - End Session:**

```json
{
  "flag": "off",
  "patient_id": "TEST0041",
  "doctor_id": "DR456"
}
```

---

## 🧪 Complete Testing Workflow

### Test the full patient-doctor flow:

#### Step 1: Complete Triage

```
POST https://urchin-app-uibbb.ondigitalocean.app/triage/complete
Body:
{
  "patient_id": "TEST0041"
}
```

✅ Save the `room_id` and `patient_token` from response

---

#### Step 2: Check Room Status

```
GET https://urchin-app-uibbb.ondigitalocean.app/patient/TEST0041/room-status
```

✅ Verify status is "waiting_for_doctor"

---

#### Step 3: Doctor Joins

```
POST https://urchin-app-uibbb.ondigitalocean.app/doctor/join-room
Body:
{
  "patient_id": "TEST0041",
  "doctor_id": "DR456"
}
```

✅ Save the `doctor_token` from response

---

#### Step 4: Check Room Status Again

```
GET https://urchin-app-uibbb.ondigitalocean.app/patient/TEST0041/room-status
```

✅ Verify status is now "doctor_joined"
✅ Verify doctor_id is "DR456"

---

#### Step 5: End Session

```
POST https://urchin-app-uibbb.ondigitalocean.app/session/end/TEST0041
```

✅ Room should be deleted

---

#### Step 6: Check Room Status One Last Time

```
GET https://urchin-app-uibbb.ondigitalocean.app/patient/TEST0041/room-status
```

✅ Status should show "completed"

---

## 📝 Sample Request - Simple!

Just send the patient_id:

```json
{
  "patient_id": "TEST0041"
}
```

The system will:

1. Look up the patient in MongoDB
2. Extract triage data (urgency, confidence, assessment) that's already stored
3. Create a LiveKit room
4. Add the room_id to the patient's MongoDB document

---

## ⚠️ Common Errors & Solutions

### Error: "Patient TEST0041 not found in database"

**Solution:** Make sure the patient exists in MongoDB with triage data first. Your triage agent should have already saved the patient data to MongoDB before calling this endpoint.

### Error: "Patient not found"

**Solution:** Same as above - the patient needs to exist in MongoDB first

### Error: "No active room found for this patient"

**Solution:** The patient doesn't have a room yet. Call `/triage/complete` first

### Error: 500 Internal Server Error

**Solution:**

1. Check if MongoDB is running
2. Verify your `.env` file has correct MongoDB connection string
3. Check server logs for details

---

## 🎯 Quick Copy-Paste for Postman

### Collection Variables (Optional)

Set these in Postman Collection Variables:

```
base_url: https://urchin-app-uibbb.ondigitalocean.app
patient_id: TEST0041
doctor_id: DR456
```

Then use in endpoints:

```
{{base_url}}/triage/complete
{{base_url}}/patient/{{patient_id}}/room-status
```

---

## 📊 Expected MongoDB Document After Triage Complete

After calling `/triage/complete`, your patient document in MongoDB will look like:

```json
{
  "_id": ObjectId("..."),
  "patient_id": "TEST0041",
  "triage_complete": true,
  "triage_urgency": "HIGH",
  "triage_confidence": 0.9,
  "livekit_room": {
    "room_id": "patient_TEST0041_1737146924",
    "room_name": "patient_TEST0041_1737146924",
    "created_at": "2026-01-17T20:35:24.123Z",
    "status": "waiting_for_doctor",
    "patient_token": "eyJhbGci...",
    "livekit_url": "wss://abcd-vaim7omd.livekit.cloud",
    "doctor_id": null,
    "doctor_joined_at": null
  },
  "updated_at": "2026-01-17T20:35:24.123Z"
}
```

---

## 🚀 Start Testing!

1. Make sure your server is running: `uvicorn main:app --reload --port 8000`
2. Make sure MongoDB is running and accessible
3. Start with the **Health Check** endpoint
4. Then test the **Complete Triage** endpoint
5. Follow the complete testing workflow above

Happy Testing! 🎉
