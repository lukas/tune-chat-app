const { test, expect } = require('@playwright/test');
const { join } = require('path');

test.describe('Tool Call UI Components', () => {
    test('should display tool call UI elements correctly', async ({ page }) => {
        // Load the frontend HTML with mock electronAPI
        await page.goto('file://' + join(__dirname, '..', 'src', 'frontend', 'index.html'));
        
        // Mock the electronAPI
        await page.evaluate(() => {
            window.electronAPI = {
                sendChatMessage: async () => ({ success: true })
            };
        });
        
        // Wait for app to be initialized
        await page.waitForFunction(() => window.chatApp !== undefined, { timeout: 1000 });
        
        // Initialize the app
        await page.evaluate(() => {
            // Send mock tool call messages
            window.chatApp.handleBackendMessage({
                type: 'tool_call_start',
                toolName: 'read_file',
                toolId: 'test-tool-1'
            });
            
            setTimeout(() => {
                window.chatApp.handleBackendMessage({
                    type: 'tool_call_executing',
                    toolName: 'read_file',
                    toolId: 'test-tool-1',
                    toolInput: { path: '/test/file.txt' }
                });
            }, 100);
            
            setTimeout(() => {
                window.chatApp.handleBackendMessage({
                    type: 'tool_call_complete',
                    toolName: 'read_file',
                    toolId: 'test-tool-1',
                    success: true
                });
            }, 200);
        });
        
        // Verify tool call element appears
        const toolCallElement = await page.locator('.tool-call').first();
        await expect(toolCallElement).toBeVisible({ timeout: 1000 });
        
        // Verify tool name
        const toolName = await toolCallElement.locator('.tool-name');
        await expect(toolName).toContainText('read_file');
        
        // Wait for status updates
        await page.waitForTimeout(300);
        
        // Verify final status
        const toolStatus = await toolCallElement.locator('.tool-status');
        await expect(toolStatus).toContainText('Completed');
        
        // Verify finished class is applied
        await expect(toolCallElement).toHaveClass(/tool-finished/);
    });
    
    test('should display tool error correctly', async ({ page }) => {
        await page.goto('file://' + join(__dirname, '..', 'src', 'frontend', 'index.html'));
        
        // Mock the electronAPI
        await page.evaluate(() => {
            window.electronAPI = {
                sendChatMessage: async () => ({ success: true })
            };
        });
        
        // Wait for app to be initialized
        await page.waitForFunction(() => window.chatApp !== undefined, { timeout: 1000 });
        
        // Send error tool call messages
        await page.evaluate(() => {
            window.chatApp.handleBackendMessage({
                type: 'tool_call_start',
                toolName: 'browser_navigate',
                toolId: 'test-tool-2'
            });
            
            setTimeout(() => {
                window.chatApp.handleBackendMessage({
                    type: 'tool_call_complete',
                    toolName: 'browser_navigate',
                    toolId: 'test-tool-2',
                    success: false,
                    error: 'No connection to browser extension'
                });
            }, 100);
        });
        
        // Verify error display
        const toolCallElement = await page.locator('#tool-test-tool-2');
        await expect(toolCallElement).toBeVisible({ timeout: 1000 });
        
        // Wait for error status
        await page.waitForTimeout(200);
        
        // Verify error status
        const toolStatus = await toolCallElement.locator('.tool-status');
        await expect(toolStatus).toContainText('Failed');
        
        // Verify error details
        const errorDetails = await toolCallElement.locator('.tool-error');
        await expect(errorDetails).toContainText('No connection to browser extension');
    });
});