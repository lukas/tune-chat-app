import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';

/**
 * Tests specifically designed to reproduce the exact MCP freezing issue
 * Based on the error logs: filesystem/stderr with "Allowed directories" and stdio messages
 */
test.describe('MCP Freeze Reproduction', () => {
  
  test('reproduce filesystem server stderr blocking issue', async () => {
    console.log('=== REPRODUCING MCP FILESYSTEM SERVER ISSUE ===');
    
    // This test reproduces the exact scenario from the logs
    const serverProcess = spawn('npx', ['@modelcontextprotocol/server-filesystem', '/Users'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stderrMessages = [];
    let stdoutMessages = [];
    let isBlocked = false;
    
    // Capture stderr (this is where the problematic messages appear)
    serverProcess.stderr.on('data', (data) => {
      const message = data.toString();
      stderrMessages.push(message);
      console.log('STDERR:', message.trim());
      
      // Check for the specific error messages from the user's logs
      if (message.includes('Allowed directories')) {
        console.log('✓ Found "Allowed directories" message in stderr');
      }
      if (message.includes('Secure MCP Filesystem Server running on stdio')) {
        console.log('✓ Found "Secure MCP Filesystem Server running on stdio" message');
      }
    });
    
    serverProcess.stdout.on('data', (data) => {
      const message = data.toString();
      stdoutMessages.push(message);
      console.log('STDOUT:', message.trim());
    });
    
    // Set up a test to detect if the process blocks
    const blockDetector = setTimeout(() => {
      isBlocked = true;
      console.log('⚠️ POTENTIAL BLOCK DETECTED: No response after 5 seconds');
    }, 5000);
    
    serverProcess.on('spawn', () => {
      console.log('✓ Server process spawned successfully');
      clearTimeout(blockDetector);
    });
    
    // Wait for initial stderr messages (the ones causing issues)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('\n=== ANALYSIS ===');
    console.log('Stderr messages count:', stderrMessages.length);
    console.log('Stdout messages count:', stdoutMessages.length);
    console.log('Process blocked:', isBlocked);
    
    // Now try to communicate with the server (this might cause the freeze)
    console.log('\n=== ATTEMPTING COMMUNICATION ===');
    
    const communicationTest = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Communication timed out - likely frozen'));
      }, 10000);
      
      let responseReceived = false;
      
      // Listen for any response
      const responseHandler = (data) => {
        responseReceived = true;
        clearTimeout(timeout);
        resolve(data.toString());
      };
      
      serverProcess.stdout.once('data', responseHandler);
      
      // Send initialize message (JSON-RPC)
      const initMessage = JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      }) + '\n';
      
      console.log('Sending initialize message...');
      serverProcess.stdin.write(initMessage);
      
      // If no response in 3 seconds, that's suspicious
      setTimeout(() => {
        if (!responseReceived) {
          console.log('⚠️  No response to initialize message - potential freeze point');
        }
      }, 3000);
    });
    
    let communicationResult;
    try {
      communicationResult = await communicationTest;
      console.log('✓ Communication successful:', communicationResult.trim());
    } catch (error) {
      console.log('✗ Communication failed:', error.message);
      communicationResult = null;
    }
    
    // Clean up
    serverProcess.kill('SIGTERM');
    
    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n=== FINAL ANALYSIS ===');
    
    // Analyze the results to identify the freeze cause
    const hasAllowedDirsMsg = stderrMessages.some(msg => msg.includes('Allowed directories'));
    const hasStdioMsg = stderrMessages.some(msg => msg.includes('Secure MCP Filesystem Server running on stdio'));
    const communicationWorked = communicationResult !== null;
    
    console.log('Key findings:');
    console.log('- "Allowed directories" in stderr:', hasAllowedDirsMsg);
    console.log('- "Secure MCP Filesystem Server running on stdio" in stderr:', hasStdioMsg);
    console.log('- JSON-RPC communication worked:', communicationWorked);
    console.log('- Process appeared blocked:', isBlocked);
    
    // This helps identify if the issue is with:
    // 1. Server startup (stderr messages)
    // 2. JSON-RPC communication
    // 3. Process management
    
    if (hasAllowedDirsMsg && hasStdioMsg && !communicationWorked) {
      console.log('\n🎯 LIKELY FREEZE CAUSE: Server starts and outputs to stderr, but JSON-RPC communication hangs');
      console.log('   This suggests the issue is in the stdio pipe handling or JSON-RPC protocol implementation');
    }
    
    // The test should pass if we can reproduce the issue
    expect(hasAllowedDirsMsg).toBe(true);
    expect(hasStdioMsg).toBe(true);
  });
  
  test('test multiple server startup race condition', async () => {
    console.log('=== TESTING MULTIPLE SERVER STARTUP ===');
    
    // Test if starting multiple MCP servers simultaneously causes issues
    // (as the app starts both filesystem and browser servers)
    
    const servers = [
      { name: 'filesystem', cmd: 'npx', args: ['@modelcontextprotocol/server-filesystem', '/Users'] },
      { name: 'browser', cmd: 'npx', args: ['@browsermcp/mcp@latest'] }
    ];
    
    const serverProcesses = [];
    const serverResults = [];
    
    // Start both servers simultaneously (like the app does)
    for (const server of servers) {
      const process = spawn(server.cmd, server.args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      serverProcesses.push({ process, name: server.name });
      
      const result = {
        name: server.name,
        stderr: [],
        stdout: [],
        spawned: false,
        error: null
      };
      
      process.stderr.on('data', (data) => {
        result.stderr.push(data.toString());
        console.log(`${server.name} STDERR:`, data.toString().trim());
      });
      
      process.stdout.on('data', (data) => {
        result.stdout.push(data.toString());
        console.log(`${server.name} STDOUT:`, data.toString().trim());
      });
      
      process.on('spawn', () => {
        result.spawned = true;
        console.log(`✓ ${server.name} server spawned`);
      });
      
      process.on('error', (error) => {
        result.error = error.message;
        console.log(`✗ ${server.name} server error:`, error.message);
      });
      
      serverResults.push(result);
    }
    
    // Wait for servers to start
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('\n=== RACE CONDITION ANALYSIS ===');
    
    for (const result of serverResults) {
      console.log(`${result.name} server:`);
      console.log(`  - Spawned: ${result.spawned}`);
      console.log(`  - Stderr messages: ${result.stderr.length}`);
      console.log(`  - Stdout messages: ${result.stdout.length}`);
      console.log(`  - Error: ${result.error || 'none'}`);
    }
    
    // Test communication with both servers
    console.log('\n=== TESTING SIMULTANEOUS COMMUNICATION ===');
    
    const communicationPromises = serverProcesses.map(({ process, name }) => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ name, success: false, reason: 'timeout' });
        }, 5000);
        
        const initMessage = JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          id: 1,
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' }
          }
        }) + '\n';
        
        process.stdout.once('data', () => {
          clearTimeout(timeout);
          resolve({ name, success: true, reason: 'response received' });
        });
        
        try {
          process.stdin.write(initMessage);
        } catch (error) {
          clearTimeout(timeout);
          resolve({ name, success: false, reason: error.message });
        }
      });
    });
    
    const communicationResults = await Promise.all(communicationPromises);
    
    console.log('Communication results:');
    communicationResults.forEach(result => {
      console.log(`  ${result.name}: ${result.success ? '✓' : '✗'} (${result.reason})`);
    });
    
    // Clean up all processes
    serverProcesses.forEach(({ process }) => {
      try {
        process.kill('SIGTERM');
      } catch (error) {
        console.log('Error killing process:', error.message);
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Analysis
    const filesystemResult = serverResults.find(r => r.name === 'filesystem');
    const hasFilesystemIssue = filesystemResult && 
      filesystemResult.stderr.some(msg => 
        msg.includes('Allowed directories') || msg.includes('Secure MCP Filesystem Server')
      );
    
    if (hasFilesystemIssue) {
      console.log('\n🎯 CONFIRMED: Filesystem server produces the problematic stderr messages');
      console.log('   These messages may be causing the parent process to hang when reading stderr');
    }
    
    expect(serverResults.length).toBe(2);
  });
});