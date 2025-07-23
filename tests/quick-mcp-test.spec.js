import { test, expect } from '@playwright/test';

/**
 * Quick MCP tests that won't hang - just check the basics
 */
test.describe('Quick MCP Checks', () => {
  
  test('MCP config should exist and be readable', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const configPath = path.join(__dirname, '..', 'src', 'backend', 'mcp-servers', 'config.json');
    
    try {
      const config = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(config);
      
      console.log('MCP Config:', parsed);
      
      expect(parsed.mcpServers).toBeDefined();
      expect(parsed.mcpServers.filesystem).toBeDefined();
      expect(parsed.mcpServers.filesystem.command).toContain('server-filesystem');
      
    } catch (error) {
      console.log('Config read error:', error.message);
      throw error;
    }
  });

  test('main.js should contain MCP freeze-prone code patterns', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const mainPath = path.join(__dirname, '..', 'src', 'main.js');
    const mainCode = await fs.readFile(mainPath, 'utf8');
    
    // Check for the problematic patterns that could cause freezing
    const hasSpawnCall = mainCode.includes('spawn(');
    const hasStderrHandling = mainCode.includes('stderr.on');
    const hasPipeStdio = mainCode.includes('pipe');
    
    console.log('Freeze-prone patterns found:');
    console.log('- spawn() calls:', hasSpawnCall);
    console.log('- stderr handling:', hasStderrHandling);  
    console.log('- pipe stdio:', hasPipeStdio);
    
    // These patterns are likely causing the freeze
    expect(hasSpawnCall).toBe(true);
    expect(hasStderrHandling).toBe(true);
  });

  test('identify exact freeze location in main.js', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const mainPath = path.join(__dirname, '..', 'src', 'main.js');
    const mainCode = await fs.readFile(mainPath, 'utf8');
    const lines = mainCode.split('\n');
    
    const freezePoints = [];
    
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      
      // Look for synchronous operations that could block
      if (line.includes('spawn(') && line.includes('stdio')) {
        freezePoints.push(`Line ${lineNum}: ${line.trim()}`);
      }
      
      if (line.includes('stderr.on(') || line.includes('stdout.on(')) {
        freezePoints.push(`Line ${lineNum}: ${line.trim()}`);
      }
      
      if (line.includes('.write(') && line.includes('stdin')) {
        freezePoints.push(`Line ${lineNum}: ${line.trim()}`);
      }
    });
    
    console.log('\n🎯 POTENTIAL FREEZE LOCATIONS:');
    freezePoints.forEach(point => console.log(point));
    
    expect(freezePoints.length).toBeGreaterThan(0);
  });
});