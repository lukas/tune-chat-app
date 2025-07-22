#!/usr/bin/env python3

import asyncio
import os
from typing import Dict, Any
import websockets
import json
from anthropic import Anthropic
from dotenv import load_dotenv
from mcp_manager import MCPManager

load_dotenv()

class ClaudeBackend:
    def __init__(self):
        self.client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.mcp_manager = MCPManager()
        
    async def process_message(self, message: str, context: Dict[str, Any] = None) -> str:
        """Process a chat message through Claude with MCP context"""
        try:
            # Get MCP context if available
            mcp_context = await self.mcp_manager.get_context()
            
            # Construct system prompt with MCP capabilities
            system_prompt = self._build_system_prompt(mcp_context)
            
            response = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=4000,
                system=system_prompt,
                messages=[{"role": "user", "content": message}]
            )
            
            return response.content[0].text
            
        except Exception as e:
            return f"Error processing message: {str(e)}"
    
    def _build_system_prompt(self, mcp_context: Dict[str, Any]) -> str:
        """Build system prompt including MCP capabilities"""
        base_prompt = "You are Claude, an AI assistant with access to various tools and services."
        
        if mcp_context and mcp_context.get("tools"):
            tools_info = "\n\nAvailable tools:\n"
            for tool in mcp_context["tools"]:
                tools_info += f"- {tool['name']}: {tool['description']}\n"
            base_prompt += tools_info
            
        return base_prompt

async def handle_websocket(websocket, path):
    """Handle WebSocket connections from the Electron frontend"""
    backend = ClaudeBackend()
    
    try:
        async for message in websocket:
            data = json.loads(message)
            
            if data["type"] == "chat_message":
                response = await backend.process_message(data["content"])
                await websocket.send(json.dumps({
                    "type": "chat_response",
                    "content": response
                }))
                
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected")
    except Exception as e:
        print(f"Error handling websocket: {e}")

def main():
    """Start the WebSocket server for communication with Electron"""
    print("Starting Python backend server...")
    
    start_server = websockets.serve(handle_websocket, "localhost", 8765)
    
    asyncio.get_event_loop().run_until_complete(start_server)
    print("Backend server running on ws://localhost:8765")
    asyncio.get_event_loop().run_forever()

if __name__ == "__main__":
    main()