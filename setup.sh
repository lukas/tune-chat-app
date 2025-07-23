#!/bin/bash

# Tune Chat App Setup Script
# This script installs all necessary dependencies and sets up the application

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${BLUE}"
    echo "=================================================="
    echo "         Tune Chat App Setup Script"
    echo "=================================================="
    echo -e "${NC}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js version
check_node_version() {
    if ! command_exists node; then
        print_error "Node.js is not installed!"
        print_info "Please install Node.js from: https://nodejs.org/"
        print_info "Recommended version: Node.js 18 or higher"
        exit 1
    fi
    
    local node_version=$(node --version | sed 's/v//')
    local major_version=$(echo $node_version | cut -d. -f1)
    
    if [ "$major_version" -lt 16 ]; then
        print_error "Node.js version $node_version is too old!"
        print_info "Please upgrade to Node.js 16 or higher"
        print_info "Current version: $node_version"
        exit 1
    fi
    
    print_success "Node.js version: $node_version"
}

# Check npm version
check_npm_version() {
    if ! command_exists npm; then
        print_error "npm is not installed!"
        print_info "npm should come with Node.js. Please reinstall Node.js."
        exit 1
    fi
    
    local npm_version=$(npm --version)
    print_success "npm version: $npm_version"
}

# Install application dependencies
install_dependencies() {
    print_info "Installing application dependencies..."
    
    if [ -f "package-lock.json" ]; then
        print_info "Found package-lock.json, running npm ci for faster install..."
        npm ci
    else
        print_info "Running npm install..."
        npm install
    fi
    
    print_success "Application dependencies installed successfully"
}

# Pre-install commonly used MCP servers to avoid startup delays
preinstall_mcp_servers() {
    print_info "Pre-installing MCP servers to improve startup performance..."
    
    # Install filesystem server
    print_info "Installing @modelcontextprotocol/server-filesystem..."
    npm install -g @modelcontextprotocol/server-filesystem@latest || print_warning "Failed to install filesystem server globally, will install on first use"
    
    # Install BrowserMCP server
    print_info "Installing @browsermcp/mcp..."
    npm install -g @browsermcp/mcp@latest || print_warning "Failed to install BrowserMCP server globally, will install on first use"
    
    print_success "MCP servers pre-installation completed"
}

# Create .env.example file with required environment variables
create_env_example() {
    print_info "Creating .env.example file..."
    
    cat > .env.example << 'EOF'
# Tune Chat App Environment Variables
# Copy this file to .env and fill in your actual values

# Required: Claude API Key from Anthropic
# Get your API key from: https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# Optional: Brave Search API Key (for web search functionality)
# Get your API key from: https://api.search.brave.com/
# BRAVE_API_KEY=your-brave-api-key-here

# Optional: Tavily API Key (alternative web search)
# Get your API key from: https://tavily.com/
# TAVILY_API_KEY=your-tavily-api-key-here
EOF
    
    print_success "Created .env.example file"
}

# Create launch script
create_launch_script() {
    print_info "Creating launch script..."
    
    cat > run.sh << 'EOF'
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
EOF

    chmod +x run.sh
    print_success "Created launch script (run.sh)"
}

# Create README with setup instructions
create_readme() {
    print_info "Creating README.md with setup instructions..."
    
    cat > README.md << 'EOF'
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
EOF

    print_success "Created README.md"
}

# Check system requirements
check_system_requirements() {
    print_info "Checking system requirements..."
    
    # Check operating system
    if [[ "$OSTYPE" == "darwin"* ]]; then
        print_success "Running on macOS"
    else
        print_warning "This app is optimized for macOS but may work on other systems"
    fi
    
    # Check available disk space (at least 1GB)
    local available_space=$(df -h . | awk 'NR==2 {print $4}' | sed 's/G//')
    if [ "$available_space" -lt 1 ]; then
        print_warning "Low disk space: ${available_space}GB available"
    else
        print_success "Sufficient disk space available"
    fi
}

# Main setup function
main() {
    print_header
    
    print_info "Starting Tune Chat App setup..."
    
    # Check system requirements
    check_system_requirements
    
    # Check Node.js and npm
    check_node_version
    check_npm_version
    
    # Install dependencies
    install_dependencies
    
    # Pre-install MCP servers
    preinstall_mcp_servers
    
    # Create configuration files
    create_env_example
    create_launch_script
    create_readme
    
    # Final success message
    echo -e "${GREEN}"
    echo "=================================================="
    echo "           Setup Complete! 🎉"
    echo "=================================================="
    echo -e "${NC}"
    
    print_info "Next steps:"
    echo "  1. Set up your Claude API key:"
    echo "     cp .env.example .env"
    echo "     # Edit .env and add your ANTHROPIC_API_KEY"
    echo ""
    echo "  2. Start the application:"
    echo "     ./run.sh"
    echo ""
    echo "  3. For web browsing, install the BrowserMCP extension:"
    echo "     https://browsermcp.io/install"
    echo ""
    
    print_success "Setup completed successfully!"
}

# Run main function
main "$@"