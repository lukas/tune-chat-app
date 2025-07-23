import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Unit tests to isolate and test MCP components that might cause freezing
 */
test.describe('MCP Unit Tests', () => {
  
  test('MCP server process management should not block', async () => {
    // Test that spawning MCP servers doesn't cause blocking
    const servers = [
      {
        name: 'filesystem',
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/Users']
      },
      {
        name: 'browser',
        command: 'npx', 
        args: ['@browsermcp/mcp@latest']
      }
    ];
    
    const results = await Promise.allSettled(
      servers.map(server => testServerStartup(server))
    );
    
    results.forEach((result, index) => {
      console.log(`Server ${servers[index].name}:`, 
        result.status === 'fulfilled' ? 'OK' : `Failed: ${result.reason}`);
    });
    
    // At least one server should start without hanging
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    expect(successCount).toBeGreaterThan(0);
  });

  test('JSON-RPC message parsing should handle malformed input', async () => {
    // Test the JSON-RPC parsing logic that might cause freezing
    const testMessages = [
      '{"jsonrpc": "2.0", "method": "test", "id": 1}',
      '{"invalid": "json"',
      '',
      'not json at all',
      '{"jsonrpc": "2.0", "method": "test"}\n{"jsonrpc": "2.0", "method": "test2"}',
      '{"jsonrpc": "2.0", "error": {"code": -1, "message": "Test error"}}'
    ];
    
    for (const message of testMessages) {
      try {
        const parsed = parseJSONRPCMessage(message);
        console.log(`Parsed "${message.substring(0, 30)}...":`, parsed);
      } catch (error) {
        console.log(`Failed to parse "${message.substring(0, 30)}...":`, error.message);
        // Parsing failures should not cause freezing
        expect(error).toBeInstanceOf(Error);
      }
    }
  });

  test('MCP logging should not cause memory leaks or blocking', async () => {
    // Simulate the MCP logging functionality
    const mcpLogger = new MCPLoggerSimulator();
    
    // Generate lots of log entries quickly
    const logCount = 1000;
    const startTime = Date.now();
    
    for (let i = 0; i < logCount; i++) {
      mcpLogger.logCall({
        type: i % 2 === 0 ? 'stdout' : 'stderr',
        server: 'filesystem',
        timestamp: new Date(),
        input: `Test input ${i}`,
        output: `Test output ${i}`,
        error: i % 10 === 0 ? `Test error ${i}` : null
      });
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`Logged ${logCount} entries in ${duration}ms`);
    console.log(`Average: ${(duration / logCount).toFixed(2)}ms per log entry`);
    
    // Logging should be fast and not block
    expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    expect(mcpLogger.getLogs().length).toBe(logCount);
  });

  test('Electron IPC communication should handle MCP data without blocking', async () => {
    // Test IPC message handling that might cause freezing
    const ipcSimulator = new IPCSimulator();
    
    const testMessages = [
      { channel: 'mcp-call', data: { method: 'filesystem/read', params: {} } },
      { channel: 'mcp-logs-request', data: {} },
      { channel: 'mcp-server-status', data: { server: 'filesystem' } },
      { channel: 'mcp-call', data: { method: 'filesystem/write', params: { path: '/test', content: 'test' } } }
    ];
    
    const startTime = Date.now();
    
    for (const message of testMessages) {
      await ipcSimulator.send(message.channel, message.data);
      
      // Ensure each message is processed quickly
      const messageTime = Date.now() - startTime;
      expect(messageTime).toBeLessThan(1000); // Each message should process in under 1 second
    }
    
    console.log('All IPC messages processed successfully');
  });
});

// Helper functions to simulate MCP components

function testServerStartup(serverConfig) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error('Server startup timed out'));
    }, 10000); // 10 second timeout
    
    const process = spawn(serverConfig.command, serverConfig.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let hasOutput = false;
    
    process.stdout.on('data', (data) => {
      hasOutput = true;
      console.log(`${serverConfig.name} stdout:`, data.toString());
    });
    
    process.stderr.on('data', (data) => {
      hasOutput = true;
      console.log(`${serverConfig.name} stderr:`, data.toString());
    });
    
    process.on('spawn', () => {
      console.log(`${serverConfig.name} server spawned successfully`);
      
      // Give it a moment to output something, then resolve
      setTimeout(() => {
        clearTimeout(timeout);
        process.kill();
        resolve({
          spawned: true,
          hasOutput,
          name: serverConfig.name
        });
      }, 2000);
    });
    
    process.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${serverConfig.name} server failed to start: ${error.message}`));
    });
  });
}

function parseJSONRPCMessage(message) {
  if (!message || message.trim() === '') {
    throw new Error('Empty message');
  }
  
  // Handle multiple JSON objects in one message (common issue)
  const lines = message.split('\n').filter(line => line.trim());
  const results = [];
  
  for (const line of lines) {
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line);
        results.push(parsed);
      } catch (error) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
    }
  }
  
  return results.length === 1 ? results[0] : results;
}

class MCPLoggerSimulator {
  constructor() {
    this.logs = [];
    this.maxLogs = 10000; // Prevent memory leaks
  }
  
  logCall(logEntry) {
    // Simulate the logging functionality from the main app
    this.logs.push({
      id: this.logs.length + 1,
      timestamp: logEntry.timestamp || new Date(),
      type: logEntry.type,
      server: logEntry.server,
      input: logEntry.input,
      output: logEntry.output,
      error: logEntry.error
    });
    
    // Prevent memory leak by limiting log history
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }
  
  getLogs() {
    return [...this.logs]; // Return copy to prevent mutation
  }
  
  clearLogs() {
    this.logs = [];
  }
}

class IPCSimulator extends EventEmitter {
  constructor() {
    super();
    this.handlers = new Map();
  }
  
  async send(channel, data) {
    // Simulate IPC message handling with potential for blocking
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`IPC message on channel '${channel}' timed out`));
      }, 5000);
      
      // Simulate async processing
      setImmediate(() => {
        try {
          const response = this.handleMessage(channel, data);
          clearTimeout(timeout);
          resolve(response);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }
  
  handleMessage(channel, data) {
    // Simulate the IPC handlers from main.js
    switch (channel) {
      case 'mcp-call':
        return { success: true, result: 'MCP call simulated' };
      case 'mcp-logs-request':
        return { logs: [] };
      case 'mcp-server-status':
        return { status: 'running', server: data.server };
      default:
        throw new Error(`Unknown IPC channel: ${channel}`);
    }
  }
}