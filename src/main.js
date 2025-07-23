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
                const logEntry = `[${new Date().toISOString()}] STDOUT: ${data.toString()}`;
                console.log(`MCP ${serverName} stdout:`, data.toString());
                this.servers[serverName].logs.push(logEntry);
                // Keep only last 50 log entries
                if (this.servers[serverName].logs.length > 50) {
                    this.servers[serverName].logs = this.servers[serverName].logs.slice(-50);
                }
            });

            childProcess.stderr.on('data', (data) => {
                const errorEntry = `[${new Date().toISOString()}] STDERR: ${data.toString()}`;
                console.error(`MCP ${serverName} stderr:`, data.toString());
                this.servers[serverName].errors.push(errorEntry);
                // Keep only last 50 error entries
                if (this.servers[serverName].errors.length > 50) {
                    this.servers[serverName].errors = this.servers[serverName].errors.slice(-50);
                }
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

    getAvailableTools() {
        const tools = [];
        
        // Add system status tool
        tools.push({
            name: 'check_mcp_status',
            description: 'Check the status of all MCP servers',
            server: 'system'
        });
        
        for (const [serverName, serverInfo] of Object.entries(this.servers)) {
            if (serverInfo.status === 'running') {
                // Add filesystem tools
                if (serverName === 'filesystem') {
                    tools.push(
                        {
                            name: 'read_file',
                            description: 'Read the contents of a file',
                            server: serverName
                        },
                        {
                            name: 'write_file',
                            description: 'Write content to a file',
                            server: serverName
                        },
                        {
                            name: 'list_directory',
                            description: 'List the contents of a directory',
                            server: serverName
                        },
                        {
                            name: 'search_files',
                            description: 'Search for files or content within files',
                            server: serverName
                        }
                    );
                }
                
                
                // Add browser tools if this is the BrowserMCP server
                if (serverName === 'browsermcp') {
                    tools.push(
                        {
                            name: 'navigate',
                            description: 'Navigate to a URL in the browser',
                            server: serverName
                        },
                        {
                            name: 'click',
                            description: 'Click on an element in the browser',
                            server: serverName
                        },
                        {
                            name: 'type',
                            description: 'Type text into an input field',
                            server: serverName
                        },
                        {
                            name: 'scroll',
                            description: 'Scroll the page',
                            server: serverName
                        },
                        {
                            name: 'screenshot',
                            description: 'Take a screenshot of the current page',
                            server: serverName
                        },
                        {
                            name: 'get_page_content',
                            description: 'Get the text content of the current page',
                            server: serverName
                        },
                        {
                            name: 'wait_for_element',
                            description: 'Wait for an element to appear on the page',
                            server: serverName
                        }
                    );
                }
            }
        }
        
        return tools;
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
        const tools = mcpManager ? mcpManager.getAvailableTools() : [];
        
        // Create tools array for Claude API
        const claudeTools = tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: {
                type: "object",
                properties: {}
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

        const stream = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4000,
            messages,
            tools: claudeTools.length > 0 ? claudeTools : undefined,
            stream: true
        });
        
        // Handle streaming response
        let finalMessage = '';
        let hasToolUse = false;
        let currentMessageId = Date.now().toString();

        // Send initial message with streaming indicator
        mainWindow.webContents.send('backend-message', {
            type: 'chat_stream_start',
            messageId: currentMessageId
        });

        for await (const chunk of stream) {
            if (chunk.type === 'content_block_start') {
                if (chunk.content_block.type === 'text') {
                    // Text content block started
                } else if (chunk.content_block.type === 'tool_use') {
                    hasToolUse = true;
                    console.log('Tool use detected:', chunk.content_block);
                }
            } else if (chunk.type === 'content_block_delta') {
                if (chunk.delta.type === 'text_delta') {
                    finalMessage += chunk.delta.text;
                    // Send incremental text updates
                    mainWindow.webContents.send('backend-message', {
                        type: 'chat_stream_delta',
                        messageId: currentMessageId,
                        content: chunk.delta.text
                    });
                }
            } else if (chunk.type === 'content_block_stop') {
                // Content block finished
            } else if (chunk.type === 'message_stop') {
                // Handle any tool use after streaming is complete
                if (hasToolUse) {
                    // For now, we'll need to make a second request to handle tool use
                    // This is because tool use requires the full response to process
                    console.log('Tool use detected, processing...');
                    
                    // Send a message indicating tool processing
                    mainWindow.webContents.send('backend-message', {
                        type: 'chat_stream_delta',
                        messageId: currentMessageId,
                        content: '\n\n[Processing tool use...]'
                    });
                    
                    // Make a non-streaming request to handle tool use
                    const toolResponse = await anthropic.messages.create({
                        model: 'claude-3-5-sonnet-20241022',
                        max_tokens: 4000,
                        messages,
                        tools: claudeTools.length > 0 ? claudeTools : undefined
                    });
                    
                    for (const content of toolResponse.content) {
                        if (content.type === 'tool_use' && content.name === 'check_mcp_status') {
                            try {
                                const serverStatus = mcpManager.getServerStatus();
                                console.log('Server status:', serverStatus);
                                
                                const statusEntries = Object.entries(serverStatus);
                                let statusMessage = '\n\nMCP Server Status:\n\n';
                                
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

                                finalMessage += statusMessage;
                                
                                // Send the tool result as a delta
                                mainWindow.webContents.send('backend-message', {
                                    type: 'chat_stream_delta',
                                    messageId: currentMessageId,
                                    content: statusMessage
                                });
                                
                            } catch (error) {
                                console.error('Error getting server status:', error);
                                const errorMessage = `\n\nError checking MCP server status: ${error.message}`;
                                finalMessage += errorMessage;
                                
                                mainWindow.webContents.send('backend-message', {
                                    type: 'chat_stream_delta',
                                    messageId: currentMessageId,
                                    content: errorMessage
                                });
                            }
                        }
                    }
                }
                
                // Send final message completion
                mainWindow.webContents.send('backend-message', {
                    type: 'chat_stream_end',
                    messageId: currentMessageId,
                    finalContent: finalMessage || 'No response content available.'
                });
                break;
            }
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