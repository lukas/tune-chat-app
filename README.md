# Tune Chat App

A desktop chat application that integrates Claude AI with file system access and web browsing capabilities through MCP (Model Context Protocol) servers.

## Features

- 💬 **Chat with Claude**: Direct integration with Claude AI
- 📁 **File System Access**: Read, write, and manage files through Claude
- 🌐 **Web Browsing**: Automated browser interactions with BrowserMCP extension
- 🔧 **Server Monitoring**: Real-time MCP server status and logs
- 🖥️ **Native Desktop App**: Built with Electron for macOS

## Quick Start

1. **Run the setup script** (installs all dependencies):
   ```bash
   ./setup.sh
   ```

2. **Set up your Claude API key**:
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

3. **Start the application**:
   ```bash
   ./run.sh
   ```

## Manual Setup

If you prefer to set up manually:

```bash
# Install dependencies
npm install

# Start the app
npm run dev
```

## Environment Variables

Create a `.env` file with:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# Optional (for web search)
BRAVE_API_KEY=your-brave-api-key-here
TAVILY_API_KEY=your-tavily-api-key-here
```

## Browser Extension Setup

For web browsing features:

1. Install the [BrowserMCP extension](https://browsermcp.io/install)
2. Pin the extension in your browser
3. Click the extension icon and "Connect" when using browser features

## Available Commands

- `npm run dev` - Start in development mode with DevTools
- `npm start` - Start in production mode
- `npm run build` - Build the application
- `npm test` - Run tests (if available)

## MCP Servers

The app includes these MCP servers:

- **Filesystem**: Read/write files and directories
- **BrowserMCP**: Web browser automation (requires browser extension)

## Troubleshooting

- **Server Logs**: Click "🔧 Server Logs" in the app to see MCP server status
- **API Key Issues**: The app will prompt for your Claude API key if not set
- **Permission Issues**: Ensure the app has necessary file system permissions

## Requirements

- Node.js 16+ 
- macOS (built for macOS, may work on other platforms)
- Claude API key from [Anthropic Console](https://console.anthropic.com/)

## Development

Built with:
- Electron (desktop app framework)
- Claude AI API
- Model Context Protocol (MCP)
- BrowserMCP for web automation
