#!/bin/bash

# Tune Chat App Launch Script

# Check if .env file exists and source it
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo "✅ Loaded environment variables from .env"
else
    echo "⚠️  No .env file found. You can create one from .env.example"
    echo "   The app will prompt for your Claude API key when started."
fi

# Start the application
echo "🚀 Starting Tune Chat App..."
npm run dev
