import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

/**
 * Simple test to verify streaming works without 400 errors
 */
test.describe('Simple Streaming Test', () => {
  
  test('should stream responses without 400 errors', async () => {
    let electronApp;
    
    const testTimeout = setTimeout(() => {
      console.log('⏰ Test timeout reached');
      process.exit(1);
    }, 5000);
    
    try {
      console.log('🚀 Starting app...');
      
      electronApp = await electron.launch({
        args: ['src/main.js', '--dev'],
        cwd: process.cwd()
      });
      
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      
      console.log('📱 App loaded, looking for chat input...');
      
      // Use correct selector
      await window.waitForSelector('#chat-input', { timeout: 1000 });
      console.log('✅ Found chat input');
      
      // Track messages simply
      let messageCount = 0;
      let hasError = false;
      let streamingCompleted = false;
      
      await window.evaluate(() => {
        window.testResults = { messages: [], errors: [] };
        
        console.error = (...args) => {
          const errorStr = args.join(' ');
          window.testResults.errors.push(errorStr);
          if (errorStr.includes('400') || errorStr.includes('invalid_request_error')) {
            window.testResults.has400Error = true;
          }
        };
        
        if (window.electronAPI && window.electronAPI.onBackendMessage) {
          const originalHandler = window.electronAPI.onBackendMessage;
          window.electronAPI.onBackendMessage = (callback) => {
            originalHandler((message) => {
              window.testResults.messages.push(message.type);
              
              if (message.type === 'chat_stream_end') {
                window.testResults.streamingCompleted = true;
              }
              
              callback(message);
            });
          };
        }
      });
      
      console.log('📝 Sending simple test message...');
      
      // Send simple message
      await window.fill('#chat-input', 'Hello, can you check the MCP server status?');
      await window.click('#send-button');
      
      // Wait for response with simple polling (only 3 attempts with 1s timeout)
      for (let i = 0; i < 3; i++) {
        const results = await window.evaluate(() => window.testResults);
        
        if (results.streamingCompleted) {
          console.log('✅ Streaming completed');
          messageCount = results.messages.length;
          hasError = results.has400Error || false;
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`⏳ Waiting... (${i + 1}/3)`);
      }
      
      const finalResults = await window.evaluate(() => window.testResults);
      
      console.log('📊 Results:');
      console.log(`- Messages: ${finalResults.messages.length}`);
      console.log(`- Message types: ${[...new Set(finalResults.messages)].join(', ')}`);
      console.log(`- Errors: ${finalResults.errors.length}`);
      console.log(`- Has 400 error: ${finalResults.has400Error || false}`);
      console.log(`- Streaming completed: ${finalResults.streamingCompleted || false}`);
      
      // Basic assertions
      expect(finalResults.messages.length).toBeGreaterThan(0);
      expect(finalResults.has400Error || false).toBe(false);
      expect(finalResults.streamingCompleted || false).toBe(true);
      
      console.log('✅ Test passed!');
      clearTimeout(testTimeout);
      
    } catch (error) {
      console.error('❌ Test error:', error.message);
      clearTimeout(testTimeout);
      throw error;
      
    } finally {
      if (electronApp) {
        console.log('🔄 Closing app...');
        await electronApp.close();
        console.log('✅ App closed');
      }
    }
  });
});