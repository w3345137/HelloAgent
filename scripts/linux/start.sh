#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$DIR/Data"
export NODE_PATH="$DATA_DIR/node_modules"
export HELLO_AGENT_PORT=3000
export GITHUB_REPO="w3345137/HelloAgent"
export APP_VERSION="1.0.0"
export APP_DIR="$DIR"

mkdir -p "$DATA_DIR/logs"

node "$DATA_DIR/core/main.js" > "$DATA_DIR/logs/hello-agent.log" 2>&1 &
NODE_PID=$!

echo "Hello Agent starting... (PID: $NODE_PID)"

MAX_ATTEMPTS=30
for i in $(seq 1 $MAX_ATTEMPTS); do
    sleep 0.5
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo "Server ready at http://localhost:3000"
        break
    fi
done

if command -v xdg-open > /dev/null 2>&1; then
    xdg-open http://localhost:3000 2>/dev/null
elif command -v open > /dev/null 2>&1; then
    open http://localhost:3000 2>/dev/null
fi

echo "Press Ctrl+C to stop..."
wait $NODE_PID
