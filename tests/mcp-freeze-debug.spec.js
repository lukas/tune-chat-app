import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

/**
 * Test suite to debug MCP call freezing issues
 * Based on error logs showing filesystem/stderr errors and potential stdio blocking
 */
test.describe('MCP Call Freeze Debugging', () => {
  let electronApp;
  
  test.beforeEach(async ({ _electron }) => {
    // Start Electron app
    electronApp = await _electron.launch({
      args: [projectRoot, '--dev'],
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should start app without freezing during MCP server initialization', async () => {
    const window = await electronApp.firstWindow();
    
    // Wait for app to load and check it doesn't freeze
    await expect(window).toHaveTitle(/Tune Chat/);
    
    // Look for MCP status indicators in the UI
    const mcpStatusIndicator = window.locator('[data-testid="mcp-status"], .mcp-status, [class*="mcp-status"]');
    
    // Give MCP servers time to start (but not too long to avoid hanging tests)
    await window.waitForTimeout(5000);
    
    // Check if the window is still responsive
    const inputField = window.locator('input, textarea').first();
    if (await inputField.isVisible()) {
      await inputField.fill('test responsiveness');
      await expect(inputField).toHaveValue('test responsiveness');
    }
  });

  test('should display MCP call logs without freezing', async () => {
    const window = await electronApp.firstWindow();
    
    // Wait for app to load
    await window.waitForLoadState('domcontentloaded');
    
    // Look for MCP logs section
    const mcpLogsSection = window.locator('#mcp-logs, [data-testid="mcp-logs"], .mcp-logs');
    
    // Wait a bit for MCP servers to initialize and generate logs
    await window.waitForTimeout(3000);
    
    // Check if MCP logs are visible and contain error information
    const errorLogs = window.locator('text=/ERROR.*filesystem.*stderr/i');
    const allowedDirsError = window.locator('text=/Allowed directories/i');
    const stdioError = window.locator('text=/Secure MCP Filesystem Server running on stdio/i');
    
    // Take screenshot for debugging
    await window.screenshot({ path: 'tests/screenshots/mcp-logs-state.png' });
    
    // Verify the window is still responsive after MCP errors
    await expect(window.locator('body')).toBeVisible();
  });

  test('should handle MCP server stderr without blocking', async () => {
    const window = await electronApp.firstWindow();
    
    // Monitor console errors
    const consoleErrors = [];
    window.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    await window.waitForLoadState('domcontentloaded');
    
    // Wait for MCP servers to start and potentially generate stderr
    await window.waitForTimeout(5000);
    
    // Check if the app is still interactive despite stderr errors
    const chatInput = window.locator('textarea, input[type="text"]').first();
    if (await chatInput.isVisible()) {
      await chatInput.fill('Testing after MCP stderr');
      
      // Verify the input worked (app didn't freeze)
      await expect(chatInput).toHaveValue('Testing after MCP stderr');
    }
    
    console.log('Console errors captured:', consoleErrors);
  });

  test('should timeout and fail gracefully if MCP calls hang', async () => {
    const window = await electronApp.firstWindow();
    
    await window.waitForLoadState('domcontentloaded');
    
    // Try to trigger an MCP call if there's a way to do so in the UI
    const sendButton = window.locator('button:has-text("Send"), [data-testid="send-button"], .send-button');
    const messageInput = window.locator('textarea, input[type="text"]').first();
    
    if (await messageInput.isVisible() && await sendButton.isVisible()) {
      await messageInput.fill('Test message that might trigger MCP call');
      
      // Set a reasonable timeout for the send operation
      await Promise.race([
        sendButton.click(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('MCP call timed out after 10 seconds')), 10000)
        )
      ]).catch(error => {
        console.log('Expected timeout or error:', error.message);
        // This is expected if MCP calls are hanging
      });
      
      // Verify app is still responsive after timeout
      await expect(window.locator('body')).toBeVisible();
    }
  });

  test('should show MCP filesystem server errors in logs', async () => {
    const window = await electronApp.firstWindow();
    
    await window.waitForLoadState('domcontentloaded');
    
    // Wait for MCP logs to populate
    await window.waitForTimeout(5000);
    
    // Look for specific error patterns from the logs
    const logs = await window.textContent('body');
    
    // Check for the specific errors mentioned in the issue
    const hasAllowedDirsError = logs.includes('Allowed directories');
    const hasStdioError = logs.includes('Secure MCP Filesystem Server running on stdio');
    const hasFilesystemError = logs.includes('filesystem/stderr');
    
    console.log('MCP Error Analysis:');
    console.log('- Allowed directories error found:', hasAllowedDirsError);
    console.log('- Stdio error found:', hasStdioError);
    console.log('- Filesystem stderr error found:', hasFilesystemError);
    
    // Take detailed screenshot for analysis
    await window.screenshot({ 
      path: 'tests/screenshots/mcp-error-analysis.png',
      fullPage: true 
    });
    
    // The presence of these errors indicates the filesystem server is starting
    // but encountering configuration issues
    if (hasAllowedDirsError || hasStdioError || hasFilesystemError) {
      console.log('MCP filesystem server errors detected - this may be causing the freeze');
    }
  });
});

test.describe('MCP Server Direct Testing', () => {
  test('should test MCP filesystem server directly', async () => {
    // Test the MCP filesystem server in isolation
    const serverProcess = spawn('npx', ['@modelcontextprotocol/server-filesystem', '/Users'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdoutData = '';
    let stderrData = '';
    let processExited = false;
    
    serverProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });
    
    serverProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    serverProcess.on('exit', (code) => {
      processExited = true;
      console.log('MCP filesystem server exited with code:', code);
    });
    
    // Wait a bit for the server to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('MCP Server Direct Test Results:');
    console.log('- Stdout:', stdoutData);
    console.log('- Stderr:', stderrData);
    console.log('- Process exited:', processExited);
    
    // Send a simple JSON-RPC message to test communication
    const testMessage = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {}
    }) + '\n';
    
    serverProcess.stdin.write(testMessage);
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('After sending initialize message:');
    console.log('- Additional stdout:', stdoutData);
    console.log('- Additional stderr:', stderrData);
    
    // Clean up
    serverProcess.kill();
    
    // Analyze results
    expect(stderrData).toBeTruthy(); // We expect stderr based on the error logs
    
    if (stderrData.includes('Allowed directories')) {
      console.log('✓ Confirmed: Filesystem server outputs "Allowed directories" to stderr');
    }
    
    if (stderrData.includes('Secure MCP Filesystem Server running on stdio')) {
      console.log('✓ Confirmed: Filesystem server outputs startup message to stderr');
    }
  });
});