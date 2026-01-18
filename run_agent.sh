#!/bin/bash

echo "🚀 Starting Medical Note-Taking Agent..."

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
    echo "✅ Virtual environment activated"
fi

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | grep -v '^$' | xargs)
    echo "✅ Environment variables loaded from .env"
else
    echo "❌ .env file not found!"
    exit 1
fi

# Verify required variables
if [ -z "$LIVEKIT_URL" ]; then
    echo "❌ LIVEKIT_URL not set in .env"
    exit 1
fi

echo "🔗 Connecting to: $LIVEKIT_URL"

python agent_medical.py dev
