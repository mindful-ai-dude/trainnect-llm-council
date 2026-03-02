#!/bin/bash

# LLM Council - Stop script
# Completely shuts down frontend, backend, and clears ports

echo "Stopping LLM Council..."
echo ""

# Function to kill processes by port
kill_port() {
    local port=$1
    local name=$2
    
    if command -v lsof &> /dev/null; then
        # macOS/Linux with lsof
        pid=$(lsof -ti:$port 2>/dev/null)
        if [ ! -z "$pid" ]; then
            echo "  Stopping $name on port $port (PID: $pid)..."
            kill -TERM $pid 2>/dev/null
            sleep 1
            # Force kill if still running
            kill -KILL $pid 2>/dev/null
        fi
    elif command -v fuser &> /dev/null; then
        # Linux with fuser
        pid=$(fuser $port/tcp 2>/dev/null | awk '{print $1}')
        if [ ! -z "$pid" ]; then
            echo "  Stopping $name on port $port (PID: $pid)..."
            kill -TERM $pid 2>/dev/null
            sleep 1
            kill -KILL $pid 2>/dev/null
        fi
    elif command -v netstat &> /dev/null; then
        # Windows/legacy approach
        pid=$(netstat -ano | grep ":$port" | grep LISTENING | awk '{print $5}' | head -1)
        if [ ! -z "$pid" ]; then
            echo "  Stopping $name on port $port (PID: $pid)..."
            kill -TERM $pid 2>/dev/null
            sleep 1
            kill -KILL $pid 2>/dev/null
        fi
    fi
}

# Function to kill processes by name pattern
kill_pattern() {
    local pattern=$1
    local name=$2
    
    if command -v pgrep &> /dev/null; then
        pids=$(pgrep -f "$pattern" 2>/dev/null)
        if [ ! -z "$pids" ]; then
            echo "  Stopping $name processes..."
            echo "$pids" | while read pid; do
                kill -TERM $pid 2>/dev/null
                sleep 1
                kill -KILL $pid 2>/dev/null
            done
        fi
    elif command -v ps &> /dev/null; then
        # Fallback to ps
        pids=$(ps aux | grep -E "$pattern" | grep -v grep | awk '{print $2}')
        if [ ! -z "$pids" ]; then
            echo "  Stopping $name processes..."
            echo "$pids" | while read pid; do
                kill -TERM $pid 2>/dev/null
                sleep 1
                kill -KILL $pid 2>/dev/null
            done
        fi
    fi
}

# Stop backend on port 8001
kill_port 8001 "Backend"

# Stop frontend on port 5173  
kill_port 5173 "Frontend"

# Kill any Python/uv processes running the backend
echo ""
echo "Checking for backend processes..."
kill_pattern "backend.main" "Backend Python"
kill_pattern "uv run python.*backend" "Backend (uv)"

# Kill any Node/npm processes for frontend
echo ""
echo "Checking for frontend processes..."
kill_pattern "vite.*llm-council" "Frontend (Vite)"
kill_pattern "npm run dev" "Frontend (npm)"

# Additional cleanup for common patterns
echo ""
echo "Additional cleanup..."
pkill -f "python.*8001" 2>/dev/null || true
pkill -f "node.*5173" 2>/dev/null || true

# Verify ports are free
echo ""
echo "Verifying ports are cleared..."
sleep 2

port_8001_free=true
port_5173_free=true

if command -v lsof &> /dev/null; then
    if lsof -ti:8001 &>/dev/null; then
        port_8001_free=false
    fi
    if lsof -ti:5173 &>/dev/null; then
        port_5173_free=false
    fi
fi

# Summary
echo ""
echo "✓ LLM Council stopped successfully!"
echo ""

if [ "$port_8001_free" = true ]; then
    echo "  ✓ Backend port 8001 is free"
else
    echo "  ⚠ Backend port 8001 may still be in use"
fi

if [ "$port_5173_free" = true ]; then
    echo "  ✓ Frontend port 5173 is free"
else
    echo "  ⚠ Frontend port 5173 may still be in use"
fi

echo ""
echo "To restart: ./start.sh"
