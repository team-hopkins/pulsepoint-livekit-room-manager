#!/bin/bash

echo "🏥 Medical Note-Taking Agent - Quick Setup"
echo "=========================================="
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.9 or higher."
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"
echo ""

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip3 install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found"
    echo "📝 Creating .env from example..."
    cp .env.agent.example .env
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env and add your API keys:"
    echo "   - LIVEKIT_URL"
    echo "   - LIVEKIT_API_KEY"
    echo "   - LIVEKIT_API_SECRET"
    echo "   - OPENAI_API_KEY"
    echo "   - DEEPGRAM_API_KEY"
    echo ""
else
    echo "✅ .env file found"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your API keys"
echo "2. Start the backend: uvicorn main:app --reload"
echo "3. Start the agent: ./run_agent.sh"
echo "4. Start the frontend: cd frontend && npm run dev"
echo ""
echo "📖 For detailed instructions, see AGENT_SETUP.md"
