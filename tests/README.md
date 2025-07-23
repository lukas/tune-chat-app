# MCP Freeze Debugging Tests

This test suite is designed to help debug the MCP call freezing issue where the app hangs when making MCP calls, with error logs showing:

```
[1] ERROR - filesystem/stderr
Error: Allowed directories: [ '/Users' ]

[2] ERROR - filesystem/stderr  
Error: Secure MCP Filesystem Server running on stdio
```

## Test Files

### 1. `mcp-freeze-debug.spec.js`
Main Playwright tests that run the full Electron app and test for freezing during normal usage:
- App startup without freezing during MCP server initialization
- MCP log display functionality
- Error handling without UI blocking
- Timeout handling for hanging MCP calls
- Analysis of specific filesystem server errors

### 2. `mcp-unit-tests.spec.js`
Unit tests for individual MCP components:
- MCP server process management
- JSON-RPC message parsing
- MCP logging performance
- Electron IPC communication handling

### 3. `mcp-freeze-reproduction.spec.js`
Targeted tests to reproduce the exact freezing scenario:
- Direct filesystem server testing to reproduce stderr messages
- Multiple server startup race condition testing
- Communication protocol testing to identify blocking points

## Running the Tests

```bash
# Run all tests headlessly
npm test

# Run tests with browser UI visible (recommended for debugging)
npm run test:headed

# Run tests with Playwright's interactive UI
npm run test:ui

# Run specific test file
npx playwright test tests/mcp-freeze-reproduction.spec.js --headed
```

## What the Tests Check

1. **App Responsiveness**: Ensures the Electron app doesn't freeze during MCP server startup
2. **Error Handling**: Verifies that stderr messages from MCP servers don't cause blocking
3. **Communication Flow**: Tests the JSON-RPC communication that might be causing hangs
4. **Process Management**: Checks that MCP server child processes are managed correctly
5. **Race Conditions**: Tests for issues when multiple servers start simultaneously

## Expected Findings

Based on the error logs, the tests should help identify:

- **Root Cause**: The filesystem server outputs informational messages to stderr ("Allowed directories", "Secure MCP Filesystem Server running on stdio") which may be causing the parent process to block when reading stderr
- **Communication Issues**: JSON-RPC initialization or subsequent calls may hang
- **Resource Management**: Potential issues with stdio pipe handling or process cleanup

## Debugging Tips

1. **Screenshots**: Failed tests will capture screenshots in `tests/screenshots/`
2. **Console Output**: Tests log detailed information about MCP server behavior
3. **Timing Analysis**: Tests measure response times to identify blocking operations
4. **Process Isolation**: Tests run MCP servers independently to isolate issues

## Next Steps

If tests confirm the freezing issue:

1. **Stderr Handling**: Modify the main process to handle MCP server stderr non-blockingly
2. **Timeout Implementation**: Add timeouts to all MCP operations
3. **Error Recovery**: Implement graceful handling of MCP server failures
4. **Alternative Communication**: Consider using sockets instead of stdio for MCP communication