const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const WandbInferenceClient = require('./services/wandb-client');
const OpenAIClient = require('./services/openai-client');
const fs = require('fs');
const { spawn } = require('child_process');
const { iconBase64 } = require('./icon-data');

// Set app name
app.setName('Tune Chat');

// Set dock icon immediately for macOS development mode
if (process.platform === 'darwin' && app.dock) {
    try {
        // Use the PNG file we created
        const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
        const icon = nativeImage.createFromPath(iconPath);
        app.dock.setIcon(icon);
        console.log('Dock icon set from:', iconPath);
    } catch (err) {
        console.error('Error setting dock icon:', err);
    }
}

let mainWindow;
let anthropic;
let wandbClient;
let openaiClient;
let currentProvider = 'anthropic'; // 'anthropic', 'wandb', or 'openai'
let currentModel = 'claude-3-5-sonnet-20240620'; // Current selected model
let mcpManager;
let conversationHistory = [];
let rawApiLogs = []; // Store raw API request/response logs

// Helper function to log raw API calls
function logRawApiCall(provider, model, request, response) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        provider,
        model,
        request,
        response
    };
    
    rawApiLogs.push(logEntry);
    
    // Keep only the last 50 entries to prevent memory issues
    if (rawApiLogs.length > 50) {
        rawApiLogs = rawApiLogs.slice(-50);
    }
}

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
    // Create icon from base64 data
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${iconBase64}`);
    
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: icon,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        titleBarStyle: 'hidden',
        frame: false,
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
    console.log('API Key Debug:', {
        parameterProvided: !!apiKey,
        envVarExists: !!process.env.ANTHROPIC_API_KEY,
        envVarLength: process.env.ANTHROPIC_API_KEY?.length,
        allEnvKeys: Object.keys(process.env).filter(k => k.includes('ANTHROPIC') || k.includes('API')).length
    });
    
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    
    if (!key) {
        console.log('No API key found - showing credentials modal');
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
        
        // Test the API key by making a simple request with retry logic
        let retries = 3;
        while (retries > 0) {
            try {
                await anthropic.messages.create({
                    model: currentModel,
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'test' }],
                });
                break; // Success, exit retry loop
            } catch (testError) {
                if (testError.error?.type === 'overloaded_error' && retries > 1) {
                    console.log(`API overloaded, retrying in 2 seconds... (${retries-1} retries left)`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    retries--;
                } else {
                    throw testError; // Not an overload error or no retries left
                }
            }
        }
        
        console.log('Claude API initialized');
        
        // Start MCP servers if not already started
        if (!mcpManager) {
            mcpManager = new MCPManager();
            await mcpManager.startServers();
        }
        
        mainWindow.webContents.send('backend-message', { 
            type: 'connection_status', 
            connected: true,
            provider: 'anthropic'
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

async function setupWandbAPI(apiKey = null, project = null) {
    console.log('WandB API Key Debug:', {
        parameterProvided: !!apiKey,
        envVarExists: !!process.env.WANDB_API_KEY,
        projectProvided: !!project,
        envProjectExists: !!process.env.WANDB_PROJECT
    });
    
    const key = apiKey || process.env.WANDB_API_KEY;
    const wandbProject = project || process.env.WANDB_PROJECT;
    
    if (!key) {
        console.log('No WandB API key found - showing credentials modal');
        mainWindow.webContents.send('backend-message', { 
            type: 'wandb_credentials_required'
        });
        return;
    }
    
    if (!wandbProject) {
        console.log('No WandB project found - showing credentials modal');
        mainWindow.webContents.send('backend-message', { 
            type: 'wandb_credentials_required'
        });
        return;
    }
    
    try {
        wandbClient = new WandbInferenceClient({
            apiKey: key,
            project: wandbProject
        });
        
        await wandbClient.initialize();
        
        console.log('WandB Inference API initialized');
        console.log(`[DEBUG] WandB client available models:`, wandbClient.getAvailableModels());
        
        // Start MCP servers if not already started
        if (!mcpManager) {
            mcpManager = new MCPManager();
            await mcpManager.startServers();
        }
        
        mainWindow.webContents.send('backend-message', { 
            type: 'connection_status', 
            connected: true,
            provider: 'wandb',
            models: wandbClient.getAvailableModels()
        });
    } catch (error) {
        console.error('WandB API initialization failed:', error);
        wandbClient = null;
        mainWindow.webContents.send('backend-message', { 
            type: 'wandb_credentials_required'
        });
        throw error;
    }
}

async function setupOpenAIAPI(apiKey = null) {
    console.log('OpenAI API Key Debug:', {
        parameterProvided: !!apiKey,
        envVarExists: !!process.env.OPENAI_API_KEY
    });
    
    const key = apiKey || process.env.OPENAI_API_KEY;
    
    if (!key) {
        console.log('No OpenAI API key found - showing credentials modal');
        mainWindow.webContents.send('backend-message', { 
            type: 'openai_credentials_required'
        });
        return;
    }
    
    try {
        openaiClient = new OpenAIClient({
            apiKey: key
        });
        
        await openaiClient.initialize();
        
        console.log('OpenAI API initialized');
        console.log(`[DEBUG] OpenAI client available models:`, openaiClient.getAvailableModels());
        
        // Start MCP servers if not already started
        if (!mcpManager) {
            mcpManager = new MCPManager();
            await mcpManager.startServers();
        }
        
        mainWindow.webContents.send('backend-message', { 
            type: 'connection_status', 
            connected: true,
            provider: 'openai',
            models: openaiClient.getAvailableModels()
        });
    } catch (error) {
        console.error('OpenAI API initialization failed:', error);
        openaiClient = null;
        mainWindow.webContents.send('backend-message', { 
            type: 'openai_credentials_required'
        });
        throw error;
    }
}

// IPC handlers
ipcMain.handle('send-chat-message', async (event, message) => {
    if (!anthropic && !wandbClient && !openaiClient) {
        return { success: false, error: 'No AI provider initialized' };
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

        // Add user message to conversation history
        conversationHistory.push({ role: 'user', content: message });
        
        // Helper function to detect Google search requests and construct proper URLs
        const enhanceToolDescriptions = (tools, userMessage) => {
            return tools.map(tool => {
                if (tool.name === 'browser_navigate') {
                    // If user is asking to google something, add that context to the description
                    if (userMessage.toLowerCase().includes('google ') && !userMessage.includes('https://')) {
                        const searchTermMatch = userMessage.match(/google\s+(.+?)(?:\s*$|\s*[?.!])/i);
                        if (searchTermMatch) {
                            const searchTerm = searchTermMatch[1].trim();
                            return {
                                ...tool,
                                description: `Navigate to a URL in the browser. For Google searches, use https://www.google.com/search?q=${encodeURIComponent(searchTerm)} as the URL parameter.`
                            };
                        }
                    }
                }
                return tool;
            });
        };
        
        const enhancedTools = enhanceToolDescriptions(claudeTools, message);
        
        const messages = [...conversationHistory];
        
        // Only add system context for the first message in a conversation
        // For follow-up messages, the tools are already defined and context is maintained
        const isFirstMessage = messages.length <= 1; // Only user message, no assistant responses yet
        
        if (isFirstMessage && (tools.length > 0)) {
            // Add system message about available tools - modify the last user message instead of adding a new one
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
            
            const systemContent = [`You have access to the following tools:`];
            
            // Add MCP status info
            systemContent.push(`System tools:
- Check MCP server status to see which servers are running`);
            
            if (availableTools.length > 0) {
                systemContent.push(...availableTools);
            }
            
            systemContent.push(`Current message: ${message}`);
            
            // Replace the last user message with the enhanced version instead of adding a new message
            if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
                messages[messages.length - 1] = {
                    role: 'user',
                    content: systemContent.join('\n\n')
                };
            } else {
                // Fallback if no user message exists (shouldn't happen)
                messages.push({
                    role: 'user',
                    content: systemContent.join('\n\n')
                });
            }
        }

        let stream;
        console.log(`[DEBUG] Sending message with provider: ${currentProvider}, model: ${currentModel}`);
        console.log(`[DEBUG] Provider clients available - Anthropic: ${!!anthropic}, WandB: ${!!wandbClient}, OpenAI: ${!!openaiClient}`);
        
        // Prepare request data for logging
        const requestData = {
            model: currentModel,
            messages,
            max_tokens: 4000,
            tools: enhancedTools.length > 0 ? enhancedTools : undefined
        };
        
        if (currentProvider === 'anthropic') {
            if (!anthropic) {
                throw new Error('Anthropic client not initialized');
            }
            console.log(`[DEBUG] Using Anthropic with model: ${currentModel}`);
            stream = await anthropic.messages.stream({
                model: currentModel,
                max_tokens: 4000,
                messages,
                tools: enhancedTools.length > 0 ? enhancedTools : undefined
            });
        } else if (currentProvider === 'wandb') {
            if (!wandbClient) {
                throw new Error('WandB client not initialized');
            }
            console.log(`[DEBUG] Using WandB with model: ${currentModel}`);
            stream = wandbClient.stream({
                model: currentModel,
                messages,
                max_tokens: 4000,
                tools: enhancedTools.length > 0 ? enhancedTools : undefined
            });
        } else if (currentProvider === 'openai') {
            if (!openaiClient) {
                throw new Error('OpenAI client not initialized');
            }
            console.log(`[DEBUG] Using OpenAI with model: ${currentModel}`);
            stream = openaiClient.stream({
                model: currentModel,
                messages,
                max_tokens: 4000,
                tools: enhancedTools.length > 0 ? enhancedTools : undefined
            });
        } else {
            throw new Error(`Unknown provider: ${currentProvider}`);
        }
        
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
        console.log(`[Stream Processing] Starting to process stream for provider: ${currentProvider}`);
        for await (const chunk of stream) {
            console.log(`[${currentProvider} Stream] Processing chunk:`, JSON.stringify(chunk, null, 2));
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                const textChunk = chunk.delta.text;
                finalMessage += textChunk;
                console.log('Added text chunk to finalMessage, total length now:', finalMessage.length);
                
                // Send streaming delta
                mainWindow.webContents.send('backend-message', {
                    type: 'chat_stream_delta',
                    messageId: streamingMessageId,
                    content: textChunk
                });
            } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                console.log('Tool use detected:', chunk.content_block);
                console.log('Tool input received from Claude:', chunk.content_block.input);
                
                // Send tool call notification to frontend
                mainWindow.webContents.send('backend-message', {
                    type: 'tool_call_start',
                    toolName: chunk.content_block.name,
                    toolId: chunk.content_block.id
                });
                
                // Validate required parameters for browser_navigate
                if (chunk.content_block.name === 'browser_navigate') {
                    if (!chunk.content_block.input || !chunk.content_block.input.url) {
                        console.warn('browser_navigate called without required url parameter');
                        chunk.content_block.input = chunk.content_block.input || {};
                        
                        // If the original message was a Google search, construct the search URL
                        if (message.toLowerCase().includes('google ')) {
                            const searchTermMatch = message.match(/google\s+(.+?)(?:\s*$|\s*[?.!])/i);
                            if (searchTermMatch) {
                                const searchTerm = searchTermMatch[1].trim();
                                chunk.content_block.input.url = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
                                console.log(`Constructed Google search URL: ${chunk.content_block.input.url}`);
                            } else {
                                chunk.content_block.input.url = 'https://www.google.com';
                            }
                        } else {
                            chunk.content_block.input.url = 'https://www.google.com';
                        }
                    }
                }
                
                // Collect tool use for later execution (don't execute during streaming!)
                const toolUse = {
                    id: chunk.content_block.id,
                    name: chunk.content_block.name,
                    input: chunk.content_block.input || {}
                };
                toolUses.push(toolUse);
                console.log(`[${currentProvider} Stream] Added tool use to queue:`, toolUse);
                console.log(`[${currentProvider} Stream] Total tool uses queued: ${toolUses.length}`);
            }
        }

        // Log the raw API call
        const responseData = {
            content: finalMessage,
            tool_uses: toolUses,
            finish_reason: toolUses.length > 0 ? 'tool_calls' : 'end'
        };
        logRawApiCall(currentProvider, currentModel, requestData, responseData);
        
        // Send initial stream end
        console.log(`[${currentProvider} Stream] Stream completed. Final message: "${finalMessage}" (length: ${finalMessage.length})`);
        console.log(`[${currentProvider} Stream] Tool uses collected: ${toolUses.length}`, toolUses);
        const hasToolUses = toolUses.length > 0;
        const contentToSend = finalMessage || (hasToolUses ? 'Using tools to help with your request...' : 'No response content available.');
        
        mainWindow.webContents.send('backend-message', {
            type: 'chat_stream_end',
            messageId: streamingMessageId,
            content: contentToSend
        });
        
        // Add assistant response to conversation history
        if (finalMessage) {
            conversationHistory.push({ role: 'assistant', content: finalMessage });
        }

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
                        // Additional validation for browser_navigate before execution
                        if (toolUse.name === 'browser_navigate' && (!toolUse.input || !toolUse.input.url)) {
                            console.warn('Fixing missing URL parameter for browser_navigate at execution time');
                            toolUse.input = toolUse.input || {};
                            
                            // If the original message was a Google search, construct the search URL
                            if (message.toLowerCase().includes('google ')) {
                                const searchTermMatch = message.match(/google\s+(.+?)(?:\s*$|\s*[?.!])/i);
                                if (searchTermMatch) {
                                    const searchTerm = searchTermMatch[1].trim();
                                    toolUse.input.url = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
                                    console.log(`Constructed Google search URL at execution time: ${toolUse.input.url}`);
                                } else {
                                    toolUse.input.url = 'https://www.google.com';
                                }
                            } else {
                                toolUse.input.url = 'https://www.google.com';
                            }
                        }
                        
                        // Handle other MCP tools via JSON-RPC
                        console.log(`Executing tool ${toolUse.name} with input:`, toolUse.input);
                        
                        // Send tool execution notification
                        mainWindow.webContents.send('backend-message', {
                            type: 'tool_call_executing',
                            toolName: toolUse.name,
                            toolId: toolUse.id,
                            toolInput: toolUse.input
                        });
                        
                        toolResult = await mcpManager.executeTool(toolUse.name, toolUse.input);
                        
                        // Check for browser extension connection issues
                        if (toolUse.name.startsWith('browser_') && toolResult?.isError && 
                            toolResult?.content?.[0]?.text?.includes('No connection to browser extension')) {
                            toolResult = {
                                content: `🌐 **Browser Extension Setup Required**

To use browser automation features like Google search, you need to:

1. **Install the Browser MCP Extension:**
   - Chrome: Visit Chrome Web Store and search for "Browser MCP"
   - Firefox: Visit Firefox Add-ons and search for "Browser MCP"

2. **Connect a Browser Tab:**
   - Open a new browser tab
   - Click the Browser MCP extension icon in your browser toolbar
   - Click the "Connect" button

3. **Try Your Request Again:**
   - Once connected, you can use commands like "google [search term]"
   - The browser will automatically navigate and perform actions

**Alternative:** You can also search manually by visiting: ${toolUse.input?.url || 'https://www.google.com'}

The browser automation tools will work once the extension is properly connected!`
                            };
                        }
                    }
                    
                    // Check if this is a screenshot tool and extract image data
                    let imageData = null;
                    if (toolUse.name === 'browser_screenshot' && toolResult?.content) {
                        // Try to extract base64 image data from the tool result
                        const content = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
                        
                        // Look for base64 image data patterns
                        const base64ImageMatch = content.match(/data:image\/[^;]+;base64,[^"'\s]+/);
                        if (base64ImageMatch) {
                            imageData = base64ImageMatch[0];
                            console.log('Screenshot image detected, extracted base64 data');
                        } else {
                            // Also check if the content itself is base64 encoded
                            const base64Match = content.match(/^[A-Za-z0-9+/]+=*$/);
                            if (base64Match && content.length > 100) {
                                imageData = `data:image/png;base64,${content}`;
                                console.log('Screenshot base64 detected, added data URI prefix');
                            }
                        }
                    }
                    
                    const toolResultData = {
                        tool_use_id: toolUse.id,
                        type: 'tool_result',
                        content: toolResult?.content || JSON.stringify(toolResult)
                    };
                    
                    // If we found image data, add it as metadata for the frontend
                    if (imageData) {
                        toolResultData.imageData = imageData;
                        toolResultData.isScreenshot = true;
                        toolResultData.timestamp = new Date().toISOString();
                    }
                    
                    toolResults.push(toolResultData);
                    
                    // Send screenshot data to frontend immediately for thumbnail display
                    if (imageData) {
                        mainWindow.webContents.send('screenshot-captured', {
                            imageData: imageData,
                            timestamp: new Date().toISOString(),
                            toolUseId: toolUse.id
                        });
                    }
                    
                    // Send tool completion notification
                    mainWindow.webContents.send('backend-message', {
                        type: 'tool_call_complete',
                        toolName: toolUse.name,
                        toolId: toolUse.id,
                        success: true
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
                    
                    // Send tool error notification
                    mainWindow.webContents.send('backend-message', {
                        type: 'tool_call_complete',
                        toolName: toolUse.name,
                        toolId: toolUse.id,
                        success: false,
                        error: error.message
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
            let continuationStream;
            console.log(`[DEBUG] Continuation stream with provider: ${currentProvider}, model: ${currentModel}`);
            console.log('[DEBUG] Messages being sent for continuation:', JSON.stringify(messages, null, 2));
            
            // Prepare continuation request data for logging
            const continuationRequestData = {
                model: currentModel,
                messages,
                max_tokens: 4000
            };
            
            if (currentProvider === 'anthropic') {
                if (!anthropic) {
                    throw new Error('Anthropic client not initialized for continuation');
                }
                continuationStream = await anthropic.messages.stream({
                    model: currentModel,
                    max_tokens: 4000,
                    messages
                });
            } else if (currentProvider === 'wandb') {
                if (!wandbClient) {
                    throw new Error('WandB client not initialized for continuation');
                }
                try {
                    continuationStream = wandbClient.stream({
                        model: currentModel,
                        messages,
                        max_tokens: 4000
                    });
                } catch (error) {
                    console.error('Error creating WandB continuation stream:', error);
                    throw error;
                }
            } else if (currentProvider === 'openai') {
                if (!openaiClient) {
                    throw new Error('OpenAI client not initialized for continuation');
                }
                try {
                    continuationStream = openaiClient.stream({
                        model: currentModel,
                        messages,
                        max_tokens: 4000
                    });
                } catch (error) {
                    console.error('Error creating OpenAI continuation stream:', error);
                    throw error;
                }
            } else {
                throw new Error(`Unknown provider for continuation: ${currentProvider}`);
            }
            
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
            
            // Log the continuation API call
            const continuationResponseData = {
                content: continuationMessage,
                finish_reason: 'end'
            };
            logRawApiCall(currentProvider, currentModel, continuationRequestData, continuationResponseData);
            
            // Send final stream end
            mainWindow.webContents.send('backend-message', {
                type: 'chat_stream_end',
                messageId: continuationId,
                content: continuationMessage
            });
            
            // Add continuation response to conversation history
            if (continuationMessage) {
                conversationHistory.push({ role: 'assistant', content: continuationMessage });
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

ipcMain.handle('save-wandb-credentials', async (event, { apiKey, project }) => {
    try {
        await setupWandbAPI(apiKey, project);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-openai-credentials', async (event, { apiKey }) => {
    try {
        await setupOpenAIAPI(apiKey);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('switch-provider', async (event, provider) => {
    console.log(`[BACKEND DEBUG] switch-provider called with provider: ${provider}`);
    console.log(`[BACKEND DEBUG] Current state - currentProvider: ${currentProvider}, currentModel: ${currentModel}`);
    console.log(`[BACKEND DEBUG] Available clients - anthropic: ${!!anthropic}, wandbClient: ${!!wandbClient}, openaiClient: ${!!openaiClient}`);
    
    try {
        if (provider === 'anthropic' && anthropic) {
            console.log(`[BACKEND DEBUG] Switching to Anthropic (client available)`);
            const oldProvider = currentProvider;
            const oldModel = currentModel;
            currentProvider = 'anthropic';
            currentModel = 'claude-3-5-sonnet-20240620'; // Default Claude model
            console.log(`[BACKEND DEBUG] Updated backend state: ${oldProvider}->${currentProvider}, ${oldModel}->${currentModel}`);
            
            mainWindow.webContents.send('backend-message', { 
                type: 'connection_status', 
                connected: true,
                provider: 'anthropic'
            });
            console.log(`[BACKEND DEBUG] Sent connection_status message to frontend`);
            return { success: true, provider: 'anthropic', model: currentModel };
        } else if (provider === 'wandb' && wandbClient) {
            console.log(`[BACKEND DEBUG] Switching to WandB (client available)`);
            const oldProvider = currentProvider;
            const oldModel = currentModel;
            currentProvider = 'wandb';
            currentModel = 'meta-llama/Llama-3.1-8B-Instruct'; // Default WandB model
            console.log(`[BACKEND DEBUG] Updated backend state: ${oldProvider}->${currentProvider}, ${oldModel}->${currentModel}`);
            
            mainWindow.webContents.send('backend-message', { 
                type: 'connection_status', 
                connected: true,
                provider: 'wandb',
                models: wandbClient.getAvailableModels()
            });
            console.log(`[BACKEND DEBUG] Sent connection_status message to frontend`);
            return { success: true, provider: 'wandb', model: currentModel };
        } else if (provider === 'openai' && openaiClient) {
            console.log(`[BACKEND DEBUG] Switching to OpenAI (client available)`);
            const oldProvider = currentProvider;
            const oldModel = currentModel;
            currentProvider = 'openai';
            currentModel = 'gpt-4o'; // Default OpenAI model
            console.log(`[BACKEND DEBUG] Updated backend state: ${oldProvider}->${currentProvider}, ${oldModel}->${currentModel}`);
            
            mainWindow.webContents.send('backend-message', { 
                type: 'connection_status', 
                connected: true,
                provider: 'openai',
                models: openaiClient.getAvailableModels()
            });
            console.log(`[BACKEND DEBUG] Sent connection_status message to frontend`);
            return { success: true, provider: 'openai', model: currentModel };
        } else {
            console.log(`[BACKEND DEBUG] Provider switch failed - ${provider} not available or not initialized`);
            console.log(`[BACKEND DEBUG] anthropic client: ${!!anthropic}, wandbClient: ${!!wandbClient}`);
            return { success: false, error: `Provider ${provider} not available or not initialized` };
        }
    } catch (error) {
        console.error(`[BACKEND DEBUG] Exception during provider switch:`, error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-current-provider', async (event) => {
    return { 
        success: true, 
        provider: currentProvider,
        model: currentModel,
        anthropicAvailable: !!anthropic,
        wandbAvailable: !!wandbClient,
        openaiAvailable: !!openaiClient
    };
});

ipcMain.handle('get-env-credentials', async (event) => {
    return {
        success: true,
        wandb: {
            apiKey: process.env.WANDB_API_KEY || '',
            project: process.env.WANDB_PROJECT || ''
        },
        anthropic: {
            apiKey: process.env.ANTHROPIC_API_KEY || ''
        },
        openai: {
            apiKey: process.env.OPENAI_API_KEY || ''
        }
    };
});

ipcMain.handle('set-model', async (event, model) => {
    try {
        currentModel = model;
        return { success: true, model: currentModel };
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

ipcMain.handle('get-raw-api-logs', async (event) => {
    try {
        return { success: true, data: rawApiLogs };
    } catch (error) {
        console.error('Error getting raw API logs:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-raw-api-logs', async (event) => {
    try {
        rawApiLogs = [];
        return { success: true };
    } catch (error) {
        console.error('Error clearing raw API logs:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-conversation', async (event) => {
    try {
        conversationHistory = [];
        return { success: true };
    } catch (error) {
        console.error('Error clearing conversation history:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-external-link', async (event, url) => {
    shell.openExternal(url);
    return { success: true };
});

app.whenReady().then(async () => {
    // Set dock icon for macOS
    if (process.platform === 'darwin') {
        try {
            const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
            const dockIcon = nativeImage.createFromPath(iconPath);
            app.dock.setIcon(dockIcon);
            console.log('Dock icon updated in whenReady from:', iconPath);
        } catch (err) {
            console.error('Error setting dock icon in whenReady:', err);
        }
    }
    
    createWindow();
    await initializeProviders();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

async function initializeProviders() {
    console.log('Initializing AI providers...');
    
    // Check for environment variables
    const wandbApiKey = process.env.WANDB_API_KEY;
    const wandbProject = process.env.WANDB_PROJECT;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    let primaryProviderSet = false;
    
    // Initialize providers that have environment variables
    const initPromises = [];
    
    // Try to initialize WandB if environment variables are available
    if (wandbApiKey && wandbProject) {
        console.log('Found WandB environment variables, initializing WandB...');
        initPromises.push(
            setupWandbAPI(wandbApiKey, wandbProject)
                .then(() => {
                    console.log('WandB initialized successfully');
                    if (!primaryProviderSet && wandbClient) {
                        currentProvider = 'wandb';
                        currentModel = 'meta-llama/Llama-3.1-8B-Instruct'; // Ensure model is set
                        primaryProviderSet = true;
                        console.log('WandB set as primary provider with model:', currentModel);
                    }
                })
                .catch(error => {
                    console.error('Failed to initialize WandB:', error.message);
                })
        );
    } else if (wandbApiKey || wandbProject) {
        // Partial WandB credentials found
        const missing = [];
        if (!wandbApiKey) missing.push('WANDB_API_KEY');
        if (!wandbProject) missing.push('WANDB_PROJECT');
        console.log(`WandB partial credentials found. Missing: ${missing.join(', ')}`);
        console.log(`Available: ${wandbApiKey ? 'API_KEY' : ''}${wandbProject ? ' PROJECT' : ''}`);
    }
    
    // Try to initialize Anthropic if environment variable is available
    if (anthropicApiKey) {
        console.log('Found Anthropic environment variables, initializing Anthropic...');
        initPromises.push(
            setupClaudeAPI(anthropicApiKey)
                .then(() => {
                    console.log('Anthropic initialized successfully');
                    if (!primaryProviderSet) {
                        currentProvider = 'anthropic';
                        primaryProviderSet = true;
                        console.log('Anthropic set as primary provider');
                    }
                })
                .catch(error => {
                    console.error('Failed to initialize Anthropic:', error.message);
                })
        );
    }
    
    // Try to initialize OpenAI if environment variable is available
    if (openaiApiKey) {
        console.log('Found OpenAI environment variables, initializing OpenAI...');
        initPromises.push(
            setupOpenAIAPI(openaiApiKey)
                .then(() => {
                    console.log('OpenAI initialized successfully');
                    if (!primaryProviderSet) {
                        currentProvider = 'openai';
                        currentModel = 'gpt-4o'; // Default OpenAI model
                        primaryProviderSet = true;
                        console.log('OpenAI set as primary provider');
                    }
                })
                .catch(error => {
                    console.error('Failed to initialize OpenAI:', error.message);
                })
        );
    }
    
    // Wait for all initialization attempts to complete
    if (initPromises.length > 0) {
        await Promise.allSettled(initPromises);
    }
    
    // If no environment variables found, try Anthropic without key (will show credentials modal)
    if (!primaryProviderSet) {
        console.log('No valid environment variables found, will prompt for credentials');
        try {
            await setupClaudeAPI();
        } catch (error) {
            console.log('No credentials available, user will need to provide them');
        }
    }
}

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