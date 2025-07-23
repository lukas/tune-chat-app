# WandB Inference Service Integration

This document describes the WandB Inference service integration that has been added as an alternative to the Anthropic Claude API.

## Overview

The application now supports two AI inference providers:
1. **Anthropic Claude** (original)
2. **WandB Inference** (new alternative)

Users can choose between these providers and switch between them as needed.

## Features Added

### 1. WandB Inference Client (`src/services/wandb-client.js`)
- OpenAI-compatible client for WandB Inference API
- Supports chat completions with streaming
- Model discovery and management
- Message format conversion between Anthropic and OpenAI formats
- Tool support (for MCP integration)

### 2. Provider Management in Backend (`src/main.js`)
- `setupWandbAPI()` function for initializing WandB client
- Provider switching functionality
- Model selection support for both providers
- Environment variable support (`WANDB_API_KEY`, `WANDB_PROJECT`)
- Updated chat message handler to support both providers
- New IPC handlers:
  - `save-wandb-credentials`
  - `switch-provider`
  - `get-current-provider`
  - `set-model`

### 3. Frontend Integration (`src/frontend/`)
- WandB credentials modal in `index.html`
- **Provider and Model Selector UI** in left sidebar
- Provider switching buttons
- Real-time model switching for both providers
- Updated `app.js` with WandB modal management and selector logic
- Credential validation for WandB format (team/project)
- Updated `preload.js` with new IPC methods

### 4. Model Selection UI
- **Provider Dropdown**: Switch between Claude (Anthropic) and WandB Inference
- **Model Dropdown**: Select specific models for each provider
- **Dynamic Model Loading**: Model options update automatically when switching providers
- **Persistent Selection**: Model choice is maintained throughout the session

### 5. Testing
- Created `tests/wandb-integration-test.spec.js` - WandB integration tests
- Created `tests/model-selector-test.spec.js` - Model selector UI tests
- Tests modal switching and credential validation
- Verifies provider/model selector functionality

## Usage

### Environment Variables (Automatic Detection)
The app automatically detects and uses environment variables on startup. Set these to use WandB automatically:
```bash
export WANDB_API_KEY="your-wandb-api-key"
export WANDB_PROJECT="your-team/your-project"
```

**Provider Priority:**
1. **WandB First**: If both `WANDB_API_KEY` and `WANDB_PROJECT` are set, WandB will be the default provider
2. **Anthropic Second**: If `ANTHROPIC_API_KEY` is set (and WandB isn't available), Anthropic will be the default
3. **Manual Setup**: If no environment variables are found, the app will prompt for credentials

**Multiple Providers**: Both providers can be initialized simultaneously if both sets of environment variables are available. The first successful initialization becomes the default.

### Manual Configuration
1. Launch the application
2. When the credentials modal appears, click "Use WandB Instead"
3. Enter your WandB API key (get from https://wandb.ai/authorize)
4. Enter your project in "team/project" format (e.g., "my-team/my-project")
5. Click "Connect"

**Important**: Make sure your API key has access to the specified project. The project must exist in your WandB workspace.

### Provider and Model Selection
- **Provider Selector**: Located in the left sidebar footer, allows switching between Claude and WandB
- **Model Selector**: Automatically updates available models when provider changes
- **Claude Models Available**:
  - Claude 3.5 Sonnet (default)
  - Claude 3 Sonnet  
  - Claude 3 Haiku
- **WandB Models Available**:
  - Llama 3.1 8B Instruct (default)
  - Llama 3.1 70B Instruct
  - DeepSeek V2.5
- Changes take effect immediately for new conversations
- The connection status shows which provider is currently active
- Both providers maintain the same MCP tool integration

## Supported Models

The WandB integration includes several models:
- `meta-llama/Llama-3.1-8B-Instruct` (default)
- `deepseek-ai/DeepSeek-V2.5`
- `meta-llama/Llama-3.1-70B-Instruct`

## Implementation Details

### Message Format Conversion
The WandB client converts between Anthropic's message format and OpenAI's format:
- Handles complex content blocks (text + images)
- Maintains tool call compatibility
- Preserves conversation history format

### Streaming Support
Both providers support streaming responses:
- Anthropic: Native streaming via `anthropic.messages.stream()`
- WandB: OpenAI-compatible streaming via the WandB client

### MCP Tool Integration
Both providers work with the existing MCP (Model Context Protocol) tools:
- File system operations
- Browser automation
- Server status checking

## Configuration Files

No additional configuration files are needed. The integration uses:
- Environment variables for default credentials
- In-memory storage for active sessions
- Existing MCP server configuration

## Error Handling

The integration includes proper error handling for:
- Invalid credentials
- Network connectivity issues
- Model availability
- Tool execution failures

## Security Considerations

- API keys are stored temporarily in memory only
- No persistent storage of credentials
- Environment variables follow standard practices
- Same security model as existing Anthropic integration

## Troubleshooting

### Common Issues

**"Missing project header" error:**
- Fixed in latest version
- Ensure you're using the correct project format: "team/project"

**"API key is invalid for this project" error:**
- Verify your API key at https://wandb.ai/authorize
- Ensure the project exists in your WandB workspace
- Check that your API key has access to the specified project

**Models not loading:**
- The app will fall back to default models if API calls fail
- Check your internet connection
- Verify WandB service status

**Provider switching not working:**
- Make sure both providers are properly configured with valid credentials
- Check the browser console for error messages

## Future Enhancements

Potential improvements for the WandB integration:
1. Usage statistics and billing integration
2. Custom model fine-tuning support
3. Advanced WandB Weave tracing integration
4. Provider preference persistence
5. Better error reporting and retry mechanisms