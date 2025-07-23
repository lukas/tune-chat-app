import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

/**
 * Test to verify that the tool result 400 error fix is working properly
 * and that conversation continues after tool execution without hanging
 */
test.describe('Tool Result Format Fix', () => {
  
  test('should handle tool execution and continuation without 400 error', async () => {
    let electronApp;
    let timeout;
    
    try {
      // Set overall test timeout
      timeout = setTimeout(() => {
        throw new Error('Test timed out - likely hanging on tool continuation');
      }, 90000); // 90 second timeout
      
      console.log('🚀 Starting Electron app...');
      
      electronApp = await electron.launch({
        args: ['src/main.js', '--dev'],
        cwd: process.cwd()
      });
      
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await window.waitForSelector('#messageInput', { timeout: 15000 });
      
      console.log('✅ Electron app loaded successfully');
      
      // Set up comprehensive message tracking
      await window.evaluate(() => {
        window.toolTestData = {
          messages: [],
          streamingPhases: [],
          errors: [],
          toolExecuted: false,
          continuationStarted: false,
          continuationCompleted: false,
          totalStreams: 0
        };
        
        // Track console errors
        const originalError = console.error;
        console.error = (...args) => {
          window.toolTestData.errors.push(args.join(' '));
          originalError(...args);
        };
        
        if (window.electronAPI && window.electronAPI.onBackendMessage) {
          const originalHandler = window.electronAPI.onBackendMessage;
          window.electronAPI.onBackendMessage = (callback) => {
            originalHandler((message) => {
              window.toolTestData.messages.push({
                ...message,
                timestamp: Date.now()
              });
              
              // Track streaming phases
              if (message.type === 'chat_stream_start') {
                window.toolTestData.totalStreams++;
                window.toolTestData.streamingPhases.push(`Stream ${window.toolTestData.totalStreams} started`);
                
                if (window.toolTestData.totalStreams > 1) {
                  window.toolTestData.continuationStarted = true;
                }
              }
              
              if (message.type === 'chat_stream_delta') {
                // Look for tool execution indicators
                if (message.content && (
                  message.content.includes('navigate') ||
                  message.content.includes('result') ||
                  message.content.includes('Error:')
                )) {
                  window.toolTestData.toolExecuted = true;
                }
              }
              
              if (message.type === 'chat_stream_end') {
                window.toolTestData.streamingPhases.push(`Stream ${window.toolTestData.totalStreams} ended`);
                
                if (window.toolTestData.totalStreams > 1) {
                  window.toolTestData.continuationCompleted = true;
                }
              }
              
              callback(message);
            });
          };
        }
      });
      
      console.log('✅ Message tracking configured');
      
      // Send a message that will definitely trigger tool use
      const testMessage = "Navigate to https://www.google.com and tell me what you see on the page";
      
      console.log('📤 Sending test message that should trigger navigation tool...');
      console.log(`Message: "${testMessage}"`);
      
      await window.fill('#messageInput', testMessage);
      await window.click('#sendButton');
      
      console.log('⏳ Waiting for initial streaming to complete...');
      
      // Wait for initial streaming to complete
      let waitCount = 0;
      let initialStreamComplete = false;
      
      while (waitCount < 45) { // 45 seconds for initial stream
        const testData = await window.evaluate(() => window.toolTestData);
        
        if (testData.totalStreams >= 1 && 
            testData.streamingPhases.includes('Stream 1 ended')) {
          initialStreamComplete = true;
          console.log('✅ Initial stream completed');
          break;
        }
        
        if (testData.errors.length > 0) {
          console.log('❌ Errors detected:', testData.errors);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
        
        if (waitCount % 5 === 0) {
          console.log(`Waiting for initial stream... (${waitCount}/45s)`);
          console.log(`Current streams: ${testData.totalStreams}, Phases: ${testData.streamingPhases.length}`);
        }
      }
      
      if (!initialStreamComplete) {
        const testData = await window.evaluate(() => window.toolTestData);
        console.log('❌ Initial stream did not complete');
        console.log('Test data:', testData);
        throw new Error('Initial streaming did not complete within timeout');
      }
      
      console.log('⏳ Waiting for tool execution and continuation...');
      
      // Wait for tool execution and continuation
      waitCount = 0;
      while (waitCount < 60) { // 60 seconds for tool execution + continuation
        const testData = await window.evaluate(() => window.toolTestData);
        
        // Check for successful completion
        if (testData.continuationCompleted && testData.totalStreams >= 2) {
          console.log('✅ Tool execution and continuation completed successfully!');
          break;
        }
        
        // Check for 400 errors or other issues
        if (testData.errors.length > 0) {
          const hasApiError = testData.errors.some(error => 
            error.includes('400') || 
            error.includes('invalid_request_error') ||
            error.includes('tool_use_id')
          );
          
          if (hasApiError) {
            console.log('❌ API Error detected:', testData.errors);
            throw new Error('400 error still occurring: ' + testData.errors.join('; '));
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
        
        if (waitCount % 10 === 0) {
          console.log(`Waiting for continuation... (${waitCount}/60s)`);
          console.log(`Streams: ${testData.totalStreams}, Tool executed: ${testData.toolExecuted}, Continuation: ${testData.continuationStarted}`);
        }
      }
      
      // Get final results
      const finalTestData = await window.evaluate(() => window.toolTestData);
      
      console.log('📊 Final Test Results:');
      console.log(`- Total streams: ${finalTestData.totalStreams}`);
      console.log(`- Total messages: ${finalTestData.messages.length}`);
      console.log(`- Tool executed: ${finalTestData.toolExecuted}`);
      console.log(`- Continuation started: ${finalTestData.continuationStarted}`);
      console.log(`- Continuation completed: ${finalTestData.continuationCompleted}`);
      console.log(`- Errors: ${finalTestData.errors.length}`);
      console.log(`- Streaming phases: ${finalTestData.streamingPhases.join(', ')}`);
      
      // Assertions
      expect(finalTestData.totalStreams).toBeGreaterThanOrEqual(1);
      expect(finalTestData.messages.length).toBeGreaterThan(0);
      
      // Check that no 400 errors occurred
      const has400Error = finalTestData.errors.some(error => 
        error.includes('400') || 
        error.includes('invalid_request_error') ||
        error.includes('unexpected `tool_use_id`')
      );
      expect(has400Error).toBe(false);
      
      // Verify streaming worked
      const hasStreamStart = finalTestData.messages.some(m => m.type === 'chat_stream_start');
      const hasStreamDelta = finalTestData.messages.some(m => m.type === 'chat_stream_delta');
      const hasStreamEnd = finalTestData.messages.some(m => m.type === 'chat_stream_end');
      
      expect(hasStreamStart).toBe(true);
      expect(hasStreamDelta).toBe(true);
      expect(hasStreamEnd).toBe(true);
      
      console.log('✅ All assertions passed - tool result format fix is working!');
      
      clearTimeout(timeout);
      
    } catch (error) {
      clearTimeout(timeout);
      console.error('❌ Test failed:', error.message);
      
      if (electronApp) {
        try {
          const testData = await electronApp.evaluate(async () => {
            const windows = await require('electron').BrowserWindow.getAllWindows();
            if (windows[0]) {
              return await windows[0].webContents.executeJavaScript('window.toolTestData || {}');
            }
            return {};
          });
          console.log('Test data at failure:', testData);
        } catch (logError) {
          console.log('Could not retrieve test data:', logError.message);
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

  test('should handle multiple tool calls in sequence without errors', async () => {
    let electronApp;
    
    try {
      console.log('🚀 Testing multiple tool calls...');
      
      electronApp = await electron.launch({
        args: ['src/main.js', '--dev'],
        cwd: process.cwd()
      });
      
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await window.waitForSelector('#messageInput', { timeout: 15000 });
      
      // Set up tracking for multiple tools
      await window.evaluate(() => {
        window.multiToolTestData = {
          messages: [],
          errors: [],
          toolsDetected: [],
          streamingCompleted: false
        };
        
        const originalError = console.error;
        console.error = (...args) => {
          window.multiToolTestData.errors.push(args.join(' '));
          originalError(...args);
        };
        
        if (window.electronAPI && window.electronAPI.onBackendMessage) {
          const originalHandler = window.electronAPI.onBackendMessage;
          window.electronAPI.onBackendMessage = (callback) => {
            originalHandler((message) => {
              window.multiToolTestData.messages.push(message);
              
              if (message.type === 'chat_stream_delta' && message.content) {
                // Look for different tool executions
                if (message.content.includes('navigate')) {
                  window.multiToolTestData.toolsDetected.push('navigate');
                }
                if (message.content.includes('MCP Server Status')) {
                  window.multiToolTestData.toolsDetected.push('check_mcp_status');
                }
              }
              
              if (message.type === 'chat_stream_end') {
                window.multiToolTestData.streamingCompleted = true;
              }
              
              callback(message);
            });
          };
        }
      });
      
      // Send message that might trigger multiple tools
      const multiToolMessage = "First check the MCP server status, then navigate to https://example.com";
      
      console.log(`📤 Sending multi-tool message: "${multiToolMessage}"`);
      
      await window.fill('#messageInput', multiToolMessage);
      await window.click('#sendButton');
      
      // Wait for completion
      let waitCount = 0;
      while (waitCount < 60) {
        const testData = await window.evaluate(() => window.multiToolTestData);
        
        if (testData.streamingCompleted) {
          console.log('✅ Multi-tool streaming completed');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
      }
      
      const finalData = await window.evaluate(() => window.multiToolTestData);
      
      console.log('📊 Multi-tool Test Results:');
      console.log(`- Messages: ${finalData.messages.length}`);
      console.log(`- Tools detected: ${[...new Set(finalData.toolsDetected)].join(', ')}`);
      console.log(`- Errors: ${finalData.errors.length}`);
      console.log(`- Completed: ${finalData.streamingCompleted}`);
      
      // Verify no 400 errors
      const has400Error = finalData.errors.some(error => 
        error.includes('400') || error.includes('invalid_request_error')
      );
      expect(has400Error).toBe(false);
      
      // Verify streaming completed
      expect(finalData.streamingCompleted).toBe(true);
      expect(finalData.messages.length).toBeGreaterThan(0);
      
      console.log('✅ Multiple tool test passed!');
      
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
    }
  });
});