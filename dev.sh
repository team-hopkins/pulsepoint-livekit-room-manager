#!/bin/bash

# Nexhacks Full Stack Developer Helper
# Run from the nexhacks root directory

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}╔════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} $1"
    echo -e "${BLUE}╚════════════════════════════════════╝${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

# Commands
case "${1:-help}" in
    "install-all")
        print_header "Installing Backend Dependencies"
        if [ -f "requirements.txt" ]; then
            pip install -r requirements.txt
            print_success "Backend dependencies installed"
        else
            print_error "requirements.txt not found"
            exit 1
        fi
        
        print_header "Installing Frontend Dependencies"
        cd frontend
        npm install
        cd ..
        print_success "Frontend dependencies installed"
        ;;
    
    "dev")
        print_header "Starting Nexhacks Full Stack"
        print_info "Make sure you have MongoDB and LiveKit configured in .env"
        
        # Check if tmux is available
        if command -v tmux &> /dev/null; then
            print_info "Starting with tmux (terminal multiplexer)..."
            
            # Create new session
            tmux new-session -d -s nexhacks -x 200 -y 50
            
            # Backend window
            tmux new-window -t nexhacks -n backend -c "$(pwd)"
            tmux send-keys -t nexhacks:backend "python main.py" Enter
            print_success "Backend starting in tmux window 'backend'"
            
            # Frontend window
            tmux new-window -t nexhacks -n frontend -c "$(pwd)/frontend"
            tmux send-keys -t nexhacks:frontend "npm run dev" Enter
            print_success "Frontend starting in tmux window 'frontend'"
            
            echo -e "\n${GREEN}Both services are running!${NC}"
            echo "Backend:  https://urchin-app-uibbb.ondigitalocean.app"
            echo "Frontend: http://localhost:3000"
            echo -e "\n${YELLOW}tmux commands:${NC}"
            echo "  tmux attach -t nexhacks    # Attach to session"
            echo "  tmux select-window -t nexhacks:backend"
            echo "  tmux select-window -t nexhacks:frontend"
        else
            print_info "Starting services normally (no tmux)..."
            print_info "You need two terminal windows:"
            echo -e "\n${YELLOW}Terminal 1:${NC} python main.py"
            echo -e "${YELLOW}Terminal 2:${NC} cd frontend && npm run dev"
            echo -e "\n${YELLOW}Then press Enter to continue...${NC}"
            read
        fi
        ;;
    
    "backend")
        print_header "Starting Backend Only"
        python main.py
        ;;
    
    "frontend")
        print_header "Starting Frontend Only"
        cd frontend
        npm run dev
        ;;
    
    "build-frontend")
        print_header "Building Frontend for Production"
        cd frontend
        npm run build
        print_success "Frontend built successfully"
        print_info "Output in: frontend/.next"
        ;;
    
    "test-frontend")
        print_header "Testing Frontend Integration"
        
        if ! command -v curl &> /dev/null; then
            print_error "curl not found"
            exit 1
        fi
        
        BACKEND="https://urchin-app-uibbb.ondigitalocean.app"
        PATIENT="TEST00412"
        
        print_info "Testing backend health..."
        if curl -s "$BACKEND/health" > /dev/null 2>&1 || curl -s "$BACKEND/" > /dev/null 2>&1; then
            print_success "Backend is running"
        else
            print_error "Backend not responding at $BACKEND"
            exit 1
        fi
        
        print_info "Completing triage for patient: $PATIENT"
        TRIAGE=$(curl -s -X POST "$BACKEND/triage/complete" \
            -H "Content-Type: application/json" \
            -d "{\"patient_id\": \"$PATIENT\"}")
        
        if echo "$TRIAGE" | grep -q '"status":"success"'; then
            print_success "Triage completed"
        else
            print_error "Triage failed"
            echo "$TRIAGE"
            exit 1
        fi
        
        print_info "Generating meeting URL..."
        MEETING=$(curl -s -X POST "$BACKEND/get-patient-meeting-url" \
            -H "Content-Type: application/json" \
            -d "{\"patient_id\": \"$PATIENT\"}")
        
        if echo "$MEETING" | grep -q '"status":"success"'; then
            print_success "Meeting URL generated"
            URL=$(echo "$MEETING" | grep -o '"meeting_url":"[^"]*"' | cut -d'"' -f4 | head -1)
            if [ -n "$URL" ]; then
                echo -e "\n${GREEN}Open in browser:${NC}"
                echo "$URL"
            fi
        else
            print_error "Failed to generate meeting URL"
            echo "$MEETING"
            exit 1
        fi
        ;;
    
    "logs-backend")
        print_header "Backend Logs"
        tail -f /tmp/nexhacks-backend.log
        ;;
    
    "logs-frontend")
        print_header "Frontend Logs"
        tail -f /tmp/nexhacks-frontend.log
        ;;
    
    "clean")
        print_header "Cleaning Up"
        print_info "Removing Python cache..."
        find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
        find . -type f -name "*.pyc" -delete 2>/dev/null || true
        
        print_info "Removing Node cache..."
        rm -rf frontend/node_modules 2>/dev/null || true
        rm -rf frontend/.next 2>/dev/null || true
        
        print_success "Cleanup complete"
        ;;
    
    "env")
        print_header "Environment Check"
        
        echo -e "${YELLOW}Python:${NC}"
        python --version || print_error "Python not found"
        
        echo -e "\n${YELLOW}Node.js:${NC}"
        node --version || print_error "Node.js not found"
        npm --version || print_error "npm not found"
        
        echo -e "\n${YELLOW}Required Files:${NC}"
        [ -f ".env" ] && print_success ".env exists" || print_error ".env missing"
        [ -f "main.py" ] && print_success "main.py exists" || print_error "main.py missing"
        [ -f "requirements.txt" ] && print_success "requirements.txt exists" || print_error "requirements.txt missing"
        [ -f "frontend/package.json" ] && print_success "frontend/package.json exists" || print_error "frontend/package.json missing"
        
        echo -e "\n${YELLOW}Backend Health:${NC}"
        if curl -s https://urchin-app-uibbb.ondigitalocean.app/health > /dev/null 2>&1 || curl -s https://urchin-app-uibbb.ondigitalocean.app/ > /dev/null 2>&1; then
            print_success "Backend is running"
        else
            print_error "Backend is not running"
        fi
        
        echo -e "\n${YELLOW}Frontend Status:${NC}"
        if curl -s http://localhost:3000 > /dev/null 2>&1; then
            print_success "Frontend is running"
        else
            print_error "Frontend is not running"
        fi
        ;;
    
    "help"|"--help"|"-h")
        echo -e "${BLUE}Nexhacks Full Stack Developer Helper${NC}\n"
        echo "Usage: ./dev.sh [command]\n"
        echo -e "${GREEN}Installation:${NC}"
        echo "  install-all     Install all dependencies (backend + frontend)"
        echo ""
        echo -e "${GREEN}Development:${NC}"
        echo "  dev             Start both backend and frontend (uses tmux if available)"
        echo "  backend         Start backend only (python main.py)"
        echo "  frontend        Start frontend only (npm run dev)"
        echo ""
        echo -e "${GREEN}Building:${NC}"
        echo "  build-frontend  Build frontend for production"
        echo ""
        echo -e "${GREEN}Testing:${NC}"
        echo "  test-frontend   Test the full frontend integration flow"
        echo ""
        echo -e "${GREEN}Maintenance:${NC}"
        echo "  env             Check environment and service status"
        echo "  clean           Clean cache and build files"
        echo "  logs-backend    Tail backend logs"
        echo "  logs-frontend   Tail frontend logs"
        echo ""
        echo -e "${GREEN}Other:${NC}"
        echo "  help            Show this help message"
        echo ""
        echo -e "${YELLOW}Examples:${NC}"
        echo "  ./dev.sh install-all   # Install everything"
        echo "  ./dev.sh dev           # Start full stack"
        echo "  ./dev.sh test-frontend # Test the integration"
        ;;
    
    *)
        print_error "Unknown command: $1"
        echo "Run './dev.sh help' for available commands"
        exit 1
        ;;
esac
