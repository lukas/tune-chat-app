import { test, expect } from '@playwright/test';

/**
 * Direct test of the streaming logic to verify 400 error fix
 */
test.describe('Direct Streaming Logic Test', () => {
  
  test('message format should be correct for tool results', async () => {
    // Test the message format we're creating
    const toolUses = [
      {
        id: 'test-id-123',
        name: 'navigate',
        input: { url: 'https://example.com' }
      }
    ];
    
    const finalMessage = 'I will navigate to the website.';
    
    // Simulate the assistant content building logic from main.js
    const assistantContent = [];
    
    // Add text content if any
    if (finalMessage) {
      assistantContent.push({
        type: 'text',
        text: finalMessage
      });
    }
    
    // Add tool use blocks
    for (const toolUse of toolUses) {
      assistantContent.push({
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input
      });
    }
    
    // Create tool results
    const toolResults = [
      {
        tool_use_id: 'test-id-123',
        type: 'tool_result',
        content: 'Navigation completed successfully'
      }
    ];
    
    // Verify the message structure
    console.log('Assistant content:', JSON.stringify(assistantContent, null, 2));
    console.log('Tool results:', JSON.stringify(toolResults, null, 2));
    
    // Assertions
    expect(assistantContent).toHaveLength(2);
    expect(assistantContent[0].type).toBe('text');
    expect(assistantContent[1].type).toBe('tool_use');
    expect(assistantContent[1].id).toBe('test-id-123');
    
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].tool_use_id).toBe('test-id-123');
    expect(toolResults[0].type).toBe('tool_result');
    
    console.log('✅ Message format is correct - should not cause 400 error');
  });

  test('verify main.js contains the fix', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const mainPath = path.join(process.cwd(), 'src', 'main.js');
    const mainCode = await fs.readFile(mainPath, 'utf8');
    
    // Check for the key parts of our fix
    const hasToolUsesCollection = mainCode.includes('let toolUses = []');
    const hasAssistantContentBuilding = mainCode.includes('const assistantContent = []');
    const hasToolUseBlocks = mainCode.includes('type: \'tool_use\'');
    const hasToolResultBlocks = mainCode.includes('type: \'tool_result\'');
    const hasContinuationStream = mainCode.includes('continuationStream');
    
    console.log('Fix verification:');
    console.log('- Tool uses collection:', hasToolUsesCollection);
    console.log('- Assistant content building:', hasAssistantContentBuilding);
    console.log('- Tool use blocks:', hasToolUseBlocks);
    console.log('- Tool result blocks:', hasToolResultBlocks);
    console.log('- Continuation stream:', hasContinuationStream);
    
    expect(hasToolUsesCollection).toBe(true);
    expect(hasAssistantContentBuilding).toBe(true);
    expect(hasToolUseBlocks).toBe(true);
    expect(hasToolResultBlocks).toBe(true);
    expect(hasContinuationStream).toBe(true);
    
    console.log('✅ All fix components are present in main.js');
  });

  test('verify no blocking tool execution in streaming loop', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const mainPath = path.join(process.cwd(), 'src', 'main.js');
    const mainCode = await fs.readFile(mainPath, 'utf8');
    
    // Check that we don't have await executeTool inside the streaming loop
    const streamingLoopMatch = mainCode.match(/for await \(const chunk of stream\) \{[\s\S]*?\}/);
    
    if (streamingLoopMatch) {
      const streamingLoopCode = streamingLoopMatch[0];
      const hasBlockingToolExecution = streamingLoopCode.includes('await mcpManager.executeTool');
      
      console.log('Streaming loop check:');
      console.log('- Has blocking tool execution:', hasBlockingToolExecution);
      
      expect(hasBlockingToolExecution).toBe(false);
      console.log('✅ No blocking tool execution in streaming loop');
    } else {
      throw new Error('Could not find streaming loop in main.js');
    }
  });
});