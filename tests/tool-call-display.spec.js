const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const { join } = require('path');

let electronApp;

test.describe('Tool Call Display', () => {
    test.beforeAll(async () => {
        // Start the Electron app
        electronApp = spawn('npx', ['electron', '.', '--dev'], {
            cwd: join(__dirname, '..'),
            env: { ...process.env, NODE_ENV: 'test' }
        });
        
        // Wait for app to start
        await new Promise(resolve => setTimeout(resolve, 3000));
    });

    test.afterAll(async () => {
        if (electronApp) {
            electronApp.kill();
        }
    });
    
    test('should display tool calls in chat window', async ({ page }) => {
        // Load the frontend HTML directly
        await page.goto('file://' + join(__dirname, '..', 'src', 'frontend', 'index.html'));
        await page.waitForLoadState('networkidle', { timeout: 1000 });
        
        // Type a message that will trigger a tool call
        const chatInput = await page.locator('#chat-input');
        await chatInput.fill('check mcp status');
        
        // Send the message
        await page.locator('#send-button').click();
        
        // Wait for tool call display to appear
        const toolCallElement = await page.locator('.tool-call').first();
        await expect(toolCallElement).toBeVisible({ timeout: 1000 });
        
        // Verify tool name is displayed
        const toolName = await toolCallElement.locator('.tool-name');
        await expect(toolName).toContainText('check_mcp_status');
        
        // Verify initial status
        const toolStatus = await toolCallElement.locator('.tool-status');
        await expect(toolStatus).toContainText('Preparing...');
        
        // Wait for tool execution
        await page.waitForTimeout(500);
        
        // Verify completion status
        await expect(toolStatus).toContainText('Completed', { timeout: 1000 });
        
        // Verify the tool call has the finished class
        await expect(toolCallElement).toHaveClass(/tool-finished/);
    });
    
    test('should display tool errors correctly', async ({ page }) => {
        // Load the frontend HTML directly
        await page.goto('file://' + join(__dirname, '..', 'src', 'frontend', 'index.html'));
        await page.waitForLoadState('networkidle', { timeout: 1000 });
        
        // Type a message that will trigger a browser tool (which will fail without extension)
        const chatInput = await page.locator('#chat-input');
        await chatInput.fill('google artificial intelligence');
        
        // Send the message
        await page.locator('#send-button').click();
        
        // Wait for tool call display
        const toolCallElement = await page.locator('.tool-call').first();
        await expect(toolCallElement).toBeVisible({ timeout: 1000 });
        
        // Verify tool name
        const toolName = await toolCallElement.locator('.tool-name');
        await expect(toolName).toContainText('browser_navigate');
        
        // Wait for the tool to execute and potentially fail
        await page.waitForTimeout(1000);
        
        // Check if there's an error or success (depending on whether browser extension is connected)
        const toolStatus = await toolCallElement.locator('.tool-status');
        const statusText = await toolStatus.textContent();
        
        // Tool should either complete or fail
        expect(['Completed', 'Failed']).toContain(statusText);
    });
});