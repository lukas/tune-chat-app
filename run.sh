#!/bin/bash

# Tune Chat App Launch Script

# Check if setup has been run (indicated by node_modules directory)
if [ ! -d "node_modules" ]; then
    echo "⚠️  Setup hasn't been run yet. Running setup first..."
    echo ""
    if [ -f "./setup.sh" ]; then
        ./setup.sh
        echo ""
        echo "✅ Setup completed. Continuing with app launch..."
        echo ""
    else
        echo "❌ setup.sh not found. Please run setup manually with: npm install"
        exit 1
    fi
fi

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
