# Claude Development Guide

Always write short tests to check new functionality and make sure you can run them successfully.

## Setup Instructions

Use node to create a local web app
Use nvm to create your own node version

## Development Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run python:setup` - Install Python backend dependencies (optional)
- `npm run python:dev` - Run Python backend server (optional)

## Testing

Use Playwright for testing and screenshotting the UIs created:

- `npm test` - Run tests headlessly (always use with short timeout parameter)
- `npm run test:headed` - Run tests with browser UI visible
- `npm run test:ui` - Run tests with Playwright's interactive UI

### Test Performance Guidelines

- **ALL tests MUST be run with a 5 second timeout maximum** (`--timeout=5000`)
- **ALL awaits in test code MUST be under 1 second** (use `{ timeout: 1000 }` for selectors)
- **Always use `timeout 10s` command when running tests** to prevent hanging: `timeout 10s npm test -- testfile.spec.js --timeout=5000`
- **Tests should complete in under 5 seconds total** - if they take longer, they're likely hanging
- Keep tests focused and avoid unnecessary waits or delays
- Use short polling loops (3 iterations max) instead of long waits

## Code Style Guidelines

- Use ES6+ JavaScript features (const/let, arrow functions, destructuring)
- Follow existing code patterns in the codebase
- Use meaningful variable and function names
- Keep functions focused and single-purpose
- Add comments for complex logic, especially in MCP server interactions
- Use async/await for asynchronous operations

## Workflow Instructions

- Always run tests after making changes to ensure nothing breaks
- Check MCP server status using the built-in debug modal if Claude responses seem broken
- Prefer running specific test files rather than the entire test suite during development
- Use the development server (`npm run dev`) for iterative development
- Test both with and without MCP servers running to ensure graceful degradation
- **DO NOT run `npm run dev` in automated scripts or CI** - it can hang and block processes
- **DO NOT write tests to verify if issues are fixed** - focus on code fixes, not test creation for verification

## Developer Environment Setup

- Node.js version managed via nvm (see package.json for version requirements)
- Python 3.8+ required for optional Python backend components
- Electron requires specific versions - use exact versions from package.json
- MCP servers require npx and internet connectivity for initial setup

## Repository Etiquette

- Create descriptive branch names (avoid conductor/* prefix)
- Commit messages should be descriptive and follow conventional commit format
- Test thoroughly before creating pull requests
- Include screenshots in PRs for UI changes
- Update this CLAUDE.md file when development practices change

## Project-Specific Warnings

- **MCP Server Dependencies**: The app relies on external MCP servers (@modelcontextprotocol/server-filesystem, @browsermcp/mcp). If these services are down, tool functionality will be limited
- **Main Process Size**: src/main.js is large (613 lines) and handles multiple concerns - be careful when editing to avoid breaking IPC or MCP management
- **Async Operations**: Many MCP operations use setImmediate() to avoid blocking the main thread - maintain this pattern
- **Memory Management**: MCP call logs are limited to 100 entries and server logs to 50 entries to prevent memory leaks
- **Security**: Never commit API keys - they should only be stored temporarily in memory
- **Testing**: Some tests may be flaky due to external MCP server dependencies

## Understanding the Codebase

**🔍 For comprehensive codebase understanding, see `llms.txt`** - This file contains detailed architecture overview, component breakdown, data flow documentation, and improvement suggestions.

## Maintenance Notes

**⚠️ Keep this CLAUDE.md file updated!** 
- Update commands when package.json scripts change
- Update workflow instructions when development practices evolve  
- Update warnings when new gotchas are discovered
- Update setup instructions when dependencies change
- This file should be a living document that reflects current development reality

## Key Files for Context

- `src/main.js` - Electron main process, MCP management, Claude API integration
- `src/frontend/app.js` - Frontend application logic and UI interactions
- `src/backend/mcp-servers/config.json` - MCP server configuration
- `tests/` - Playwright test suite with MCP debugging tests
- `llms.txt` - Comprehensive codebase documentation for automated tools

## Common Issues & Solutions

- **Claude not responding**: Check API key and MCP server status via debug modal
- **MCP tools not working**: Verify MCP servers are running and configured correctly
- **App won't start**: Ensure all dependencies are installed (`npm install`)
- **Tests failing**: Check if MCP servers are accessible and not rate-limited
- **Memory issues**: Clear MCP call logs via the debug interface
