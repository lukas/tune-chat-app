import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

/**
 * Test to verify that streaming responses work properly with MCP tool calls
 * and don't hang when tools like 'navigate' are executed
 */
test.describe('Streaming MCP Tool Execution', () => {
  
  test('streaming should continue after MCP tool execution without hanging', async () => {
    let electronApp;
    let timeout;
    
    try {
      // Set a global timeout for the entire test
      timeout = setTimeout(() => {
        throw new Error('Test timed out - likely hanging on MCP tool execution');
      }, 60000); // 60 second timeout
      
      console.log('Starting Electron app...');
      
      // Start the Electron app
      electronApp = await electron.launch({
        args: ['src/main.js', '--dev'],
        cwd: process.cwd()
      });
      
      console.log('Electron app started successfully');
      
      // Get the main window
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      
      console.log('Main window loaded');
      
      // Wait for the app to be ready (look for chat interface)
      await window.waitForSelector('#messageInput', { timeout: 10000 });
      console.log('Chat interface loaded');
      
      // Set up message tracking
      const messages = [];
      let streamingStarted = false;
      let streamingEnded = false;
      let toolExecuted = false;
      
      // Listen for backend messages (streaming events)
      await window.evaluate(() => {
        window.streamingTestData = {
          messages: [],
          streamingStarted: false,
          streamingEnded: false,
          toolExecuted: false
        };
        
        // Override the backend message handler to track streaming
        if (window.electronAPI && window.electronAPI.onBackendMessage) {
          const originalHandler = window.electronAPI.onBackendMessage;
          window.electronAPI.onBackendMessage = (callback) => {
            originalHandler((message) => {
              window.streamingTestData.messages.push(message);
              
              if (message.type === 'chat_stream_start') {
                window.streamingTestData.streamingStarted = true;
              }
              
              if (message.type === 'chat_stream_delta') {
                // Check if this looks like a tool execution result
                if (message.content && (
                  message.content.includes('[navigate result]') ||
                  message.content.includes('[check_mcp_status result]') ||
                  message.content.includes('MCP Server Status')
                )) {
                  window.streamingTestData.toolExecuted = true;
                }
              }
              
              if (message.type === 'chat_stream_end') {
                window.streamingTestData.streamingEnded = true;
              }
              
              // Call the original callback
              callback(message);
            });
          };
        }
      });
      
      console.log('Set up message tracking');
      
      // Send a message that would trigger MCP tool usage
      // Using a simple request that might trigger browser navigation
      const testMessage = "Help me navigate to google.com and take a screenshot";
      
      console.log(`Sending test message: "${testMessage}"`);
      
      // Type the message
      await window.fill('#messageInput', testMessage);
      
      // Send the message
      await window.click('#sendButton');
      
      console.log('Message sent, waiting for response...');
      
      // Wait for streaming to start (with timeout)
      let streamingCheck = 0;
      while (streamingCheck < 30) { // 30 seconds max
        const testData = await window.evaluate(() => window.streamingTestData);
        
        if (testData.streamingStarted) {
          streamingStarted = true;
          console.log('✅ Streaming started successfully');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        streamingCheck++;
        console.log(`Waiting for streaming to start... (${streamingCheck}/30)`);
      }
      
      if (!streamingStarted) {
        throw new Error('Streaming never started - possible API key issue or initialization problem');
      }
      
      // Wait for tool execution or streaming to end
      let toolWaitCheck = 0;
      while (toolWaitCheck < 45) { // 45 seconds max for tool execution + response
        const testData = await window.evaluate(() => window.streamingTestData);
        
        if (testData.streamingEnded) {
          streamingEnded = true;
          toolExecuted = testData.toolExecuted;
          console.log('✅ Streaming ended successfully');
          console.log('Tool executed:', toolExecuted);
          break;
        }
        
        // Check if we have tool execution
        if (testData.toolExecuted && !toolExecuted) {
          toolExecuted = true;
          console.log('✅ Tool execution detected');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        toolWaitCheck++;
        console.log(`Waiting for response completion... (${toolWaitCheck}/45)`);
      }
      
      // Get final test data
      const finalTestData = await window.evaluate(() => window.streamingTestData);
      console.log('Final test data:', finalTestData);
      
      // Verify the streaming workflow completed
      expect(streamingStarted).toBe(true);
      expect(streamingEnded).toBe(true);
      
      // Verify we received streaming messages
      expect(finalTestData.messages.length).toBeGreaterThan(0);
      
      // Check for expected message types
      const hasStreamStart = finalTestData.messages.some(m => m.type === 'chat_stream_start');
      const hasStreamDelta = finalTestData.messages.some(m => m.type === 'chat_stream_delta');
      const hasStreamEnd = finalTestData.messages.some(m => m.type === 'chat_stream_end');
      
      expect(hasStreamStart).toBe(true);
      expect(hasStreamDelta).toBe(true);
      expect(hasStreamEnd).toBe(true);
      
      console.log('✅ All streaming events received correctly');
      
      // Log message details for debugging
      console.log('Streaming messages received:');
      finalTestData.messages.forEach((msg, index) => {
        console.log(`  ${index + 1}. ${msg.type}: ${msg.content ? msg.content.substring(0, 100) + '...' : '(no content)'}`);
      });
      
      clearTimeout(timeout);
      console.log('✅ Test completed successfully - no hanging detected');
      
    } catch (error) {
      clearTimeout(timeout);
      console.error('❌ Test failed:', error.message);
      
      if (electronApp) {
        // Try to get logs for debugging
        try {
          const logs = await electronApp.evaluate(async ({ app }) => {
            return new Promise((resolve) => {
              const logs = [];
              console.log = (...args) => logs.push(args.join(' '));
              setTimeout(() => resolve(logs), 1000);
            });
          });
          console.log('App logs:', logs);
        } catch (logError) {
          console.log('Could not retrieve app logs:', logError.message);
        }
      }
      
      throw error;
    } finally {
      if (electronApp) {
        try {
          await electronApp.close();
          console.log('Electron app closed');
        } catch (closeError) {
          console.log('Error closing app:', closeError.message);
        }
      }
    }
  });

  test('MCP tool execution should handle errors gracefully without hanging', async () => {
    let electronApp;
    
    try {
      console.log('Testing error handling in MCP tool execution...');
      
      electronApp = await electron.launch({
        args: ['src/main.js', '--dev'],
        cwd: process.cwd()
      });
      
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await window.waitForSelector('#messageInput', { timeout: 10000 });
      
      // Set up error tracking
      await window.evaluate(() => {
        window.errorTestData = {
          messages: [],
          hasError: false,
          streamingCompleted: false
        };
        
        if (window.electronAPI && window.electronAPI.onBackendMessage) {
          const originalHandler = window.electronAPI.onBackendMessage;
          window.electronAPI.onBackendMessage = (callback) => {
            originalHandler((message) => {
              window.errorTestData.messages.push(message);
              
              if (message.content && message.content.includes('Error')) {
                window.errorTestData.hasError = true;
              }
              
              if (message.type === 'chat_stream_end') {
                window.errorTestData.streamingCompleted = true;
              }
              
              callback(message);
            });
          };
        }
      });
      
      // Send a message that might trigger a tool error
      const errorMessage = "navigate to invalid://bad-url-that-should-fail";
      
      await window.fill('#messageInput', errorMessage);
      await window.click('#sendButton');
      
      // Wait for completion or timeout
      let waitCount = 0;
      while (waitCount < 30) {
        const testData = await window.evaluate(() => window.errorTestData);
        
        if (testData.streamingCompleted) {
          console.log('✅ Streaming completed even with tool error');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
      }
      
      const finalTestData = await window.evaluate(() => window.errorTestData);
      
      // Verify streaming completed despite potential errors
      expect(finalTestData.streamingCompleted).toBe(true);
      expect(finalTestData.messages.length).toBeGreaterThan(0);
      
      console.log('✅ Error handling test completed successfully');
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });
});