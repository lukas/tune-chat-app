const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let anthropic;
let mcpManager;

class MCPManager {
    constructor() {
        this.servers = {};
        this.configPath = path.join(__dirname, 'backend', 'mcp-servers', 'config.json');
        this.mcpCallLogs = [];
    }

    async loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                return config;
            }
            return { servers: [] };
        } catch (error) {
            console.error('Error loading MCP config:', error);
            return { servers: [] };
        }
    }

    async startServers() {
        const config = await this.loadConfig();
        
        for (const serverConfig of config.servers) {
            await this.startServer(serverConfig);
        }
    }

    async startServer(config) {
        try {
            const serverName = config.name;
            console.log(`Starting MCP server: ${serverName}`);

            // Expand environment variables
            const env = { ...process.env };
            if (config.env) {
                for (const [key, value] of Object.entries(config.env)) {
                    if (typeof value === 'string' && value.includes('${')) {
                        // Simple environment variable expansion
                        env[key] = value.replace(/\${(\w+)}/g, (match, varName) => {
                            return process.env[varName] || '';
                        });
                    } else {
                        env[key] = value;
                    }
                }
            }

            const childProcess = spawn(config.command, config.args || [], {
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.servers[serverName] = {
                process: childProcess,
                config,
                status: 'running',
                startTime: Date.now(),
                logs: [],
                errors: []
            };

            childProcess.stdout.on('data', (data) => {
                // Defer heavy processing to avoid blocking main thread
                setImmediate(() => {
                    try {
                        const logEntry = `[${new Date().toISOString()}] STDOUT: ${data.toString()}`;
                        const dataStr = data.toString().trim();
                        
                        // Non-blocking log storage
                        this.servers[serverName].logs.push(logEntry);
                        
                        // Keep only last 50 log entries (limit memory usage)
                        if (this.servers[serverName].logs.length > 50) {
                            this.servers[serverName].logs = this.servers[serverName].logs.slice(-50);
                        }
                        
                        // Try to parse as JSON-RPC MCP protocol message
                        if (dataStr.includes('{') && dataStr.includes('}')) {
                            const lines = dataStr.split('\n').filter(line => line.trim());
                            for (const line of lines) {
                                if (line.startsWith('{') && line.endsWith('}')) {
                                    try {
                                        const mcpMessage = JSON.parse(line);
                                        this.logMCPCallAsync('server_output', serverName, mcpMessage.method || 'unknown', 
                                            null, mcpMessage, null);
                                    } catch (jsonError) {
                                        // Skip invalid JSON, don't block
                                    }
                                }
                            }
                        } else {
                            // Log as raw output without blocking
                            this.logMCPCallAsync('server_output', serverName, 'raw_output', null, dataStr, null);
                        }
                    } catch (error) {
                        // Don't let errors in processing block the main thread
                        console.error('Error processing stdout (non-blocking):', error.message);
                    }
                });
            });

            childProcess.stderr.on('data', (data) => {
                // Defer stderr processing to avoid blocking main thread
                setImmediate(() => {
                    try {
                        const errorEntry = `[${new Date().toISOString()}] STDERR: ${data.toString()}`;
                        const errorStr = data.toString().trim();
                        
                        // Non-blocking error storage
                        this.servers[serverName].errors.push(errorEntry);
                        
                        // Keep only last 50 error entries (limit memory usage)
                        if (this.servers[serverName].errors.length > 50) {
                            this.servers[serverName].errors = this.servers[serverName].errors.slice(-50);
                        }
                        
                        // Log error output as MCP call (async)
                        this.logMCPCallAsync('error', serverName, 'stderr', null, null, errorStr);
                    } catch (error) {
                        // Don't let stderr processing errors block the main thread
                    }
                });
            });

            childProcess.on('close', (code) => {
                console.log(`MCP server ${serverName} exited with code ${code}`);
                this.servers[serverName].status = 'stopped';
            });

        } catch (error) {
            console.error(`Error starting MCP server ${config.name}:`, error);
            this.servers[config.name] = {
                process: null,
                config,
                status: 'error',
                startTime: Date.now(),
                logs: [],
                errors: [`[${new Date().toISOString()}] Failed to start: ${error.message}`]
            };
        }
    }

    async stopServers() {
        for (const [serverName, serverInfo] of Object.entries(this.servers)) {
            try {
                if (serverInfo.process && serverInfo.status === 'running') {
                    serverInfo.process.kill();
                    console.log(`Stopped MCP server: ${serverName}`);
                }
            } catch (error) {
                console.error(`Error stopping MCP server ${serverName}:`, error);
            }
        }
    }

    getServerStatus() {
        const status = {};
        
        for (const [serverName, serverInfo] of Object.entries(this.servers)) {
            const allLogs = [...(serverInfo.logs || []), ...(serverInfo.errors || [])];
            status[serverName] = {
                status: serverInfo.status,
                description: serverInfo.config.description,
                pid: serverInfo.process ? serverInfo.process.pid : null,
                uptime: serverInfo.startTime ? Date.now() - serverInfo.startTime : 0,
                logs: allLogs.sort().join('\n') || 'No logs yet'
            };
        }
        
        return status;
    }

    logMCPCall(type, serverName, toolName, input, output, error = null) {
        // Use async version to avoid blocking
        this.logMCPCallAsync(type, serverName, toolName, input, output, error);
    }
    
    logMCPCallAsync(type, serverName, toolName, input, output, error = null) {
        // Defer heavy operations to avoid blocking main thread
        setImmediate(() => {
            try {
                const logEntry = {
                    id: Date.now() + Math.random(),
                    timestamp: new Date().toISOString(),
                    type, // 'tool_call', 'server_output', 'error'
                    serverName,
                    toolName,
                    // Optimize JSON operations - only stringify when needed and limit size
                    input: this.safeStringify(input),
                    output: this.safeStringify(output),
                    error,
                    duration: null
                };
                
                this.mcpCallLogs.unshift(logEntry);
                
                // Keep only last 100 MCP call logs (prevent memory leaks)
                if (this.mcpCallLogs.length > 100) {
                    this.mcpCallLogs = this.mcpCallLogs.slice(0, 100);
                }
                
                // Remove blocking console.log - only log errors in dev mode
                if (process.env.NODE_ENV === 'development' && type === 'error') {
                    console.error(`[MCP Error] ${serverName}/${toolName}:`, error || 'Unknown error');
                }
            } catch (logError) {
                // Don't let logging errors block the main thread
                console.error('Logging error (non-blocking):', logError.message);
            }
        });
    }
    
    safeStringify(obj) {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }
        
        try {
            const str = JSON.stringify(obj, null, 2);
            // Limit size to prevent memory issues
            return str.length > 10000 ? str.substring(0, 10000) + '... [truncated]' : str;
        } catch (error) {
            return '[Unable to stringify object]';
        }
    }

    getMCPCallLogs() {
        return this.mcpCallLogs;
    }

    clearMCPCallLogs() {
        this.mcpCallLogs = [];
    }

    async discoverToolsForServer(serverName) {
        const serverInfo = this.servers[serverName];
        if (!serverInfo || serverInfo.status !== 'running') {
            return [];
        }

        return new Promise((resolve) => {
            const requestId = Date.now();
            const request = {
                jsonrpc: '2.0',
                method: 'tools/list',
                id: requestId
            };

            const timeout = setTimeout(() => {
                console.log(`Tool discovery timeout for ${serverName}`);
                resolve([]);
            }, 3000);

            const responseHandler = (data) => {
                try {
                    const lines = data.toString().split('\n').filter(line => line.trim());
                    
                    for (const line of lines) {
                        try {
                            const response = JSON.parse(line);
                            
                            if (response.id === requestId) {
                                clearTimeout(timeout);
                                serverInfo.process.stdout.off('data', responseHandler);
                                
                                if (response.error) {
                                    console.log(`Tool discovery failed for ${serverName}:`, response.error);
                                    resolve([]);
                                } else if (response.result && response.result.tools) {
                                    const tools = response.result.tools.map(tool => ({
                                        name: tool.name,
                                        description: tool.description || `Tool: ${tool.name}`,
                                        server: serverName,
                                        inputSchema: tool.inputSchema || {
                                            type: "object",
                                            properties: {},
                                            additionalProperties: false
                                        }
                                    }));
                                    console.log(`Discovered ${tools.length} tools for ${serverName}:`, tools.map(t => t.name));
                                    resolve(tools);
                                } else {
                                    console.log(`No tools found for ${serverName}`);
                                    resolve([]);
                                }
                                return;
                            }
                        } catch (parseError) {
                            // Ignore non-JSON lines
                        }
                    }
                } catch (error) {
                    // Ignore parsing errors
                }
            };

            serverInfo.process.stdout.on('data', responseHandler);

            try {
                const requestLine = JSON.stringify(request) + '\n';
                serverInfo.process.stdin.write(requestLine);
            } catch (error) {
                clearTimeout(timeout);
                serverInfo.process.stdout.off('data', responseHandler);
                console.log(`Failed to send tool discovery request to ${serverName}:`, error.message);
                resolve([]);
            }
        });
    }

    async getAvailableTools() {
        const tools = [];
        
        // Add system status tool
        tools.push({
            name: 'check_mcp_status',
            description: 'Check the status of all MCP servers',
            server: 'system',
            inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false
            }
        });
        
        // Discover tools from each running server
        const discoveryPromises = [];
        for (const [serverName, serverInfo] of Object.entries(this.servers)) {
            if (serverInfo.status === 'running') {
                discoveryPromises.push(this.discoverToolsForServer(serverName));
            }
        }

        try {
            const serverToolLists = await Promise.all(discoveryPromises);
            for (const serverTools of serverToolLists) {
                tools.push(...serverTools);
            }
        } catch (error) {
            console.error('Error discovering tools:', error);
            
            // Fallback to hardcoded tools if discovery fails
            for (const [serverName, serverInfo] of Object.entries(this.servers)) {
                if (serverInfo.status === 'running') {
                    if (serverName === 'filesystem') {
                        tools.push(
                            { 
                                name: 'read_file', 
                                description: 'Read the contents of a file', 
                                server: serverName,
                                inputSchema: {
                                    type: "object",
                                    properties: { path: { type: "string" } },
                                    required: ["path"],
                                    additionalProperties: false
                                }
                            },
                            { 
                                name: 'write_file', 
                                description: 'Write content to a file', 
                                server: serverName,
                                inputSchema: {
                                    type: "object",
                                    properties: { 
                                        path: { type: "string" },
                                        content: { type: "string" }
                                    },
                                    required: ["path", "content"],
                                    additionalProperties: false
                                }
                            },
                            { 
                                name: 'list_directory', 
                                description: 'List the contents of a directory', 
                                server: serverName,
                                inputSchema: {
                                    type: "object",
                                    properties: { path: { type: "string" } },
                                    required: ["path"],
                                    additionalProperties: false
                                }
                            },
                            { 
                                name: 'search_files', 
                                description: 'Search for files or content within files', 
                                server: serverName,
                                inputSchema: {
                                    type: "object",
                                    properties: { 
                                        path: { type: "string" },
                                        pattern: { type: "string" }
                                    },
                                    required: ["path", "pattern"],
                                    additionalProperties: false
                                }
                            }
                        );
                    } else if (serverName === 'browsermcp') {
                        tools.push(
                            { 
                                name: 'browser_navigate', 
                                description: 'Navigate to a URL in the browser', 
                                server: serverName,
                                inputSchema: {
                                    type: "object",
                                    properties: { url: { type: "string" } },
                                    required: ["url"],
                                    additionalProperties: false
                                }
                            },
                            { 
                                name: 'browser_click', 
                                description: 'Click on an element in the browser', 
                                server: serverName,
                                inputSchema: {
                                    type: "object",
                                    properties: { 
                                        element: { type: "string" },
                                        ref: { type: "string" }
                                    },
                                    required: ["element", "ref"],
                                    additionalProperties: false
                                }
                            },
                            { 
                                name: 'browser_screenshot', 
                                description: 'Take a screenshot of the current page', 
                                server: serverName,
                                inputSchema: {
                                    type: "object",
                                    properties: {},
                                    additionalProperties: false
                                }
                            }
                        );
                    }
                }
            }
        }
        
        return tools;
    }

    async executeTool(toolName, input) {
        // Find which server provides this tool
        const tools = await this.getAvailableTools();
        const tool = tools.find(t => t.name === toolName);
        
        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }

        const serverName = tool.server;
        const serverInfo = this.servers[serverName];
        
        if (!serverInfo || serverInfo.status !== 'running') {
            throw new Error(`Server ${serverName} is not running`);
        }

        // Create JSON-RPC request
        const requestId = Date.now();
        const request = {
            jsonrpc: '2.0',
            method: 'tools/call',
            id: requestId,
            params: {
                name: toolName,
                arguments: input || {}
            }
        };

        // Log the tool call
        this.logMCPCall('tool_call', serverName, toolName, input, null, null);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Tool ${toolName} timed out after 30 seconds`));
            }, 30000);

            // Set up response handler
            const responseHandler = (data) => {
                try {
                    const lines = data.toString().split('\n').filter(line => line.trim());
                    
                    for (const line of lines) {
                        try {
                            const response = JSON.parse(line);
                            
                            if (response.id === requestId) {
                                clearTimeout(timeout);
                                serverInfo.process.stdout.off('data', responseHandler);
                                
                                if (response.error) {
                                    const error = response.error.message || JSON.stringify(response.error);
                                    this.logMCPCall('error', serverName, toolName, input, null, error);
                                    reject(new Error(`Tool ${toolName} failed: ${error}`));
                                } else {
                                    this.logMCPCall('tool_call', serverName, toolName, input, response.result, null);
                                    resolve(response.result);
                                }
                                return;
                            }
                        } catch (parseError) {
                            // Ignore non-JSON lines
                        }
                    }
                } catch (error) {
                    // Ignore parsing errors
                }
            };

            // Listen for response
            serverInfo.process.stdout.on('data', responseHandler);

            // Send the request
            try {
                const requestLine = JSON.stringify(request) + '\n';
                serverInfo.process.stdin.write(requestLine);
            } catch (error) {
                clearTimeout(timeout);
                serverInfo.process.stdout.off('data', responseHandler);
                this.logMCPCall('error', serverName, toolName, input, null, error.message);
                reject(new Error(`Failed to send tool request: ${error.message}`));
            }
        });
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'active'
    });

    // Load the frontend
    if (process.argv.includes('--dev')) {
        mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));
    }
}

async function setupClaudeAPI(apiKey = null) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    
    if (!key) {
        // Send message to frontend to show credentials modal
        mainWindow.webContents.send('backend-message', { 
            type: 'credentials_required'
        });
        return;
    }
    
    try {
        anthropic = new Anthropic({
            apiKey: key,
        });
        
        // Test the API key by making a simple request
        await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'test' }],
        });
        
        console.log('Claude API initialized');
        
        // Start MCP servers
        mcpManager = new MCPManager();
        await mcpManager.startServers();
        
        mainWindow.webContents.send('backend-message', { 
            type: 'connection_status', 
            connected: true 
        });
    } catch (error) {
        console.error('Claude API initialization failed:', error);
        anthropic = null;
        mainWindow.webContents.send('backend-message', { 
            type: 'credentials_required'
        });
        throw error;
    }
}

// IPC handlers
ipcMain.handle('send-chat-message', async (event, message) => {
    if (!anthropic) {
        return { success: false, error: 'Claude API not initialized' };
    }
    
    try {
        // Get available MCP tools
        const tools = mcpManager ? await mcpManager.getAvailableTools() : [];
        
        // Create tools array for Claude API
        const claudeTools = tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema || {
                type: "object",
                properties: {},
                additionalProperties: false
            }
        }));

        const messages = [{ role: 'user', content: message }];
        
        // Add system message about available tools
        const availableTools = [];
        
        if (tools.some(t => t.server === 'filesystem')) {
            availableTools.push(`File system tools:
- Read files and directories
- Write and create files
- Search through files
- List directory contents
- Navigate the file system`);
        }
        
        
        
        if (tools.some(t => t.server === 'browsermcp')) {
            availableTools.push(`Browser automation tools:
- Navigate to websites
- Click on elements
- Type in forms
- Take screenshots
- Get page content
- Scroll pages
- Wait for elements to load`);
        }
        
        if (availableTools.length > 0 || tools.length > 0) {
            const systemContent = [`You have access to the following tools:`];
            
            // Add MCP status info
            systemContent.push(`System tools:
- Check MCP server status to see which servers are running`);
            
            if (availableTools.length > 0) {
                systemContent.push(...availableTools);
            }
            
            systemContent.push(`Current message: ${message}`);
            
            messages.unshift({
                role: 'user',
                content: systemContent.join('\n\n')
            });
        }

        const stream = await anthropic.messages.stream({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4000,
            messages,
            tools: claudeTools.length > 0 ? claudeTools : undefined
        });
        
        // Initialize streaming
        let finalMessage = '';
        let toolUses = [];
        let streamingMessageId = Date.now().toString();
        
        // Send stream start
        mainWindow.webContents.send('backend-message', {
            type: 'chat_stream_start',
            messageId: streamingMessageId
        });

        // Handle streaming response
        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                const textChunk = chunk.delta.text;
                finalMessage += textChunk;
                
                // Send streaming delta
                mainWindow.webContents.send('backend-message', {
                    type: 'chat_stream_delta',
                    messageId: streamingMessageId,
                    content: textChunk
                });
            } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                console.log('Tool use detected:', chunk.content_block);
                
                // Collect tool use for later execution (don't execute during streaming!)
                toolUses.push({
                    id: chunk.content_block.id,
                    name: chunk.content_block.name,
                    input: chunk.content_block.input || {}
                });
            }
        }

        // Send initial stream end
        mainWindow.webContents.send('backend-message', {
            type: 'chat_stream_end',
            messageId: streamingMessageId,
            content: finalMessage || 'No response content available.'
        });

        // Handle tool execution AFTER streaming completes
        if (toolUses.length > 0) {
            console.log(`Executing ${toolUses.length} tools after streaming...`);
            
            const toolResults = [];
            
            for (const toolUse of toolUses) {
                try {
                    let toolResult;
                    
                    if (toolUse.name === 'check_mcp_status') {
                        // Handle check_mcp_status locally
                        mcpManager.logMCPCall('tool_call', 'system', 'check_mcp_status', toolUse.input, null, null);
                        
                        const serverStatus = mcpManager.getServerStatus();
                        const statusEntries = Object.entries(serverStatus);
                        let statusMessage = 'MCP Server Status:\n\n';
                        
                        if (statusEntries.length === 0) {
                            statusMessage += 'No MCP servers configured.';
                        } else {
                            statusMessage += statusEntries.map(([name, info]) => {
                                const uptimeStr = info.status === 'running' && info.uptime ? 
                                    `Uptime: ${Math.floor(info.uptime / 1000)}s` : '';
                                const pidStr = info.pid ? `PID: ${info.pid}` : '';
                                const details = [pidStr, uptimeStr].filter(Boolean).join(', ');
                                
                                return `• ${name}: ${info.status} (${info.description})${details ? '\n  ' + details : ''}`;
                            }).join('\n\n');
                        }
                        
                        toolResult = { content: statusMessage };
                        mcpManager.logMCPCall('tool_call', 'system', 'check_mcp_status', toolUse.input, toolResult, null);
                    } else {
                        // Handle other MCP tools via JSON-RPC
                        toolResult = await mcpManager.executeTool(toolUse.name, toolUse.input);
                    }
                    
                    toolResults.push({
                        tool_use_id: toolUse.id,
                        type: 'tool_result',
                        content: toolResult?.content || JSON.stringify(toolResult)
                    });
                    
                } catch (error) {
                    console.error(`Error executing tool ${toolUse.name}:`, error);
                    mcpManager.logMCPCall('error', 'system', toolUse.name, toolUse.input, null, error.message);
                    
                    toolResults.push({
                        tool_use_id: toolUse.id,
                        type: 'tool_result',
                        content: `Error: ${error.message}`,
                        is_error: true
                    });
                }
            }
            
            // Build proper assistant message with tool uses
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
            
            // Add assistant message with both text and tool uses
            messages.push({ role: 'assistant', content: assistantContent });
            
            // Add user message with tool results
            messages.push({ role: 'user', content: toolResults });
            
            // Start new stream with tool results
            const continuationStream = await anthropic.messages.stream({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 4000,
                messages
            });
            
            let continuationMessage = '';
            const continuationId = (Date.now() + 1).toString();
            
            // Send new stream start for continuation
            mainWindow.webContents.send('backend-message', {
                type: 'chat_stream_start',
                messageId: continuationId
            });
            
            // Handle continuation stream
            for await (const chunk of continuationStream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    const textChunk = chunk.delta.text;
                    continuationMessage += textChunk;
                    
                    mainWindow.webContents.send('backend-message', {
                        type: 'chat_stream_delta',
                        messageId: continuationId,
                        content: textChunk
                    });
                }
            }
            
            // Send final stream end
            mainWindow.webContents.send('backend-message', {
                type: 'chat_stream_end',
                messageId: continuationId,
                content: continuationMessage
            });
        }
        
        return { success: true };
    } catch (error) {
        console.error('Claude API error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-credentials', async (event, apiKey) => {
    try {
        await setupClaudeAPI(apiKey);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});


ipcMain.handle('get-server-logs', async (event) => {
    try {
        const serverStatus = mcpManager ? mcpManager.getServerStatus() : {};
        return { success: true, data: serverStatus };
    } catch (error) {
        console.error('Error getting server logs:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-mcp-call-logs', async (event) => {
    try {
        const mcpCallLogs = mcpManager ? mcpManager.getMCPCallLogs() : [];
        return { success: true, data: mcpCallLogs };
    } catch (error) {
        console.error('Error getting MCP call logs:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-mcp-call-logs', async (event) => {
    try {
        if (mcpManager) {
            mcpManager.clearMCPCallLogs();
        }
        return { success: true };
    } catch (error) {
        console.error('Error clearing MCP call logs:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-external-link', async (event, url) => {
    shell.openExternal(url);
    return { success: true };
});

app.whenReady().then(async () => {
    createWindow();
    await setupClaudeAPI();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (mcpManager) {
        mcpManager.stopServers();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (mcpManager) {
        mcpManager.stopServers();
    }
});