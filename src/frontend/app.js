class TuneChatApp {
    constructor() {
        this.chatMessages = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.sendButton = document.getElementById('send-button');
        this.connectionStatus = document.getElementById('connection-status');
        this.credentialsModal = document.getElementById('credentials-modal');
        this.credentialsForm = document.getElementById('credentials-form');
        this.apiKeyInput = document.getElementById('api-key-input');
        this.serverLogsModal = document.getElementById('server-logs-modal');
        this.serverLogsBtn = document.getElementById('server-logs-btn');
        this.mcpCallsModal = document.getElementById('mcp-calls-modal');
        this.mcpCallsBtn = document.getElementById('mcp-calls-btn');
        
        this.isConnected = false;
        this.isWaitingForResponse = false;
        this.currentStreamingMessage = null;
        this.streamingMessages = new Map();
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupElectronIPC();
        this.autoResizeInput();
        this.updateConnectionStatus('Connecting...');
    }
    
    setupEventListeners() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        this.chatInput.addEventListener('input', () => {
            this.autoResizeInput();
            this.updateSendButton();
        });
        
        // Credentials modal event listeners
        this.credentialsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveCredentials();
        });
        
        document.getElementById('cancel-credentials').addEventListener('click', () => {
            this.hideCredentialsModal();
        });
        
        document.getElementById('get-api-key-link').addEventListener('click', (e) => {
            e.preventDefault();
            if (window.electronAPI) {
                window.electronAPI.openExternalLink('https://console.anthropic.com/');
            }
        });
        
        
        // MCP calls button
        this.mcpCallsBtn.addEventListener('click', () => {
            this.showMCPCallsModal();
        });
        
        // MCP calls modal events
        document.getElementById('close-mcp-calls').addEventListener('click', () => {
            this.hideMCPCallsModal();
        });
        
        document.getElementById('refresh-mcp-calls').addEventListener('click', () => {
            this.refreshMCPCalls();
        });
        
        document.getElementById('clear-mcp-calls').addEventListener('click', () => {
            this.clearMCPCalls();
        });
        
        document.getElementById('export-mcp-calls').addEventListener('click', () => {
            this.exportMCPCallsAsText();
        });

        // Server logs button
        this.serverLogsBtn.addEventListener('click', () => {
            this.showServerLogsModal();
        });
        
        // Server logs modal events
        document.getElementById('close-logs').addEventListener('click', () => {
            this.hideServerLogsModal();
        });
        
        document.getElementById('refresh-logs').addEventListener('click', () => {
            this.refreshServerLogs();
        });
    }
    
    setupElectronIPC() {
        if (window.electronAPI) {
            window.electronAPI.onBackendMessage((event, message) => {
                this.handleBackendMessage(message);
            });
        }
    }
    
    autoResizeInput() {
        this.chatInput.style.height = 'auto';
        this.chatInput.style.height = Math.min(this.chatInput.scrollHeight, 120) + 'px';
    }
    
    updateSendButton() {
        const hasText = this.chatInput.value.trim().length > 0;
        this.sendButton.disabled = !hasText || this.isWaitingForResponse || !this.isConnected;
    }
    
    updateConnectionStatus(status, connected = false) {
        this.connectionStatus.textContent = status;
        this.isConnected = connected;
        this.updateSendButton();
        
        if (connected) {
            this.connectionStatus.style.background = 'rgba(52, 199, 89, 0.2)';
            this.connectionStatus.style.color = '#34C759';
            this.connectionStatus.style.borderColor = 'rgba(52, 199, 89, 0.3)';
        } else {
            this.connectionStatus.style.background = 'rgba(255, 149, 0, 0.2)';
            this.connectionStatus.style.color = '#FF9500';
            this.connectionStatus.style.borderColor = 'rgba(255, 149, 0, 0.3)';
        }
    }
    

    async sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message || this.isWaitingForResponse || !this.isConnected) return;
        
        
        // Clear input and add user message
        this.chatInput.value = '';
        this.autoResizeInput();
        this.addMessage(message, 'user');
        
        // Show typing indicator
        this.isWaitingForResponse = true;
        this.updateSendButton();
        this.addTypingIndicator();
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.sendChatMessage(message);
                if (!result.success) {
                    throw new Error(result.error || 'Failed to send message');
                }
            } else {
                // Fallback for development/testing
                setTimeout(() => {
                    this.handleBackendMessage({
                        type: 'chat_response',
                        content: `Echo: ${message}`
                    });
                }, 1000);
            }
        } catch (error) {
            this.removeTypingIndicator();
            this.addMessage(`Error: ${error.message}`, 'system');
            this.isWaitingForResponse = false;
            this.updateSendButton();
        }
    }
    
    handleBackendMessage(message) {
        if (message.type === 'connection_status') {
            this.updateConnectionStatus(message.connected ? 'Connected' : 'Disconnected', message.connected);
            return;
        }
        
        if (message.type === 'credentials_required') {
            this.showCredentialsModal();
            return;
        }
        
        if (message.type === 'chat_stream_start') {
            this.removeTypingIndicator();
            this.currentStreamingMessage = this.addStreamingMessage(message.messageId);
            return;
        }
        
        if (message.type === 'chat_stream_delta') {
            this.appendToStreamingMessage(message.messageId, message.content);
            return;
        }
        
        if (message.type === 'chat_stream_end') {
            this.finalizeStreamingMessage(message.messageId, message.finalContent);
            this.isWaitingForResponse = false;
            this.updateSendButton();
            return;
        }
        
        // Fallback for non-streaming responses
        this.removeTypingIndicator();
        
        if (message.type === 'chat_response') {
            this.addMessage(message.content, 'assistant');
        }
        
        this.isWaitingForResponse = false;
        this.updateSendButton();
    }
    
    addMessage(content, sender) {
        // Remove welcome message if it exists
        const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        messageDiv.textContent = content;
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    addTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-indicator';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = `
            Claude is typing
            <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        `;
        
        this.chatMessages.appendChild(typingDiv);
        this.scrollToBottom();
    }
    
    removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    addStreamingMessage(messageId) {
        // Remove welcome message if it exists
        const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant streaming';
        messageDiv.id = `message-${messageId}`;
        messageDiv.textContent = '';
        
        this.chatMessages.appendChild(messageDiv);
        this.streamingMessages.set(messageId, { element: messageDiv, content: '' });
        this.scrollToBottom();
        
        return messageDiv;
    }
    
    appendToStreamingMessage(messageId, content) {
        const messageData = this.streamingMessages.get(messageId);
        if (messageData) {
            messageData.content += content;
            messageData.element.textContent = messageData.content;
            this.scrollToBottom();
        }
    }
    
    finalizeStreamingMessage(messageId, finalContent) {
        const messageData = this.streamingMessages.get(messageId);
        if (messageData) {
            messageData.element.textContent = finalContent;
            messageData.element.classList.remove('streaming');
            this.streamingMessages.delete(messageId);
            this.scrollToBottom();
        }
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    showCredentialsModal() {
        this.credentialsModal.classList.add('show');
        this.apiKeyInput.focus();
        this.updateConnectionStatus('Credentials Required');
    }
    
    hideCredentialsModal() {
        this.credentialsModal.classList.remove('show');
        this.apiKeyInput.value = '';
    }
    
    async saveCredentials() {
        const apiKey = this.apiKeyInput.value.trim();
        if (!apiKey) {
            alert('Please enter your API key');
            return;
        }
        
        if (!apiKey.startsWith('sk-ant-')) {
            alert('API key should start with "sk-ant-"');
            return;
        }
        
        this.updateConnectionStatus('Connecting...');
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.saveCredentials(apiKey);
                if (result.success) {
                    this.hideCredentialsModal();
                } else {
                    alert('Failed to save credentials: ' + result.error);
                }
            }
        } catch (error) {
            alert('Error saving credentials: ' + error.message);
        }
    }
    
    
    showServerLogsModal() {
        this.serverLogsModal.classList.add('show');
        this.refreshServerLogs();
    }
    
    hideServerLogsModal() {
        this.serverLogsModal.classList.remove('show');
    }
    
    async refreshServerLogs() {
        const statusList = document.getElementById('server-status-list');
        statusList.innerHTML = '<div class="loading">Loading server status...</div>';
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.getServerLogs();
                if (result.success) {
                    this.displayServerLogs(result.data);
                } else {
                    statusList.innerHTML = `<div class="error">Error loading server logs: ${result.error}</div>`;
                }
            }
        } catch (error) {
            statusList.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        }
    }
    
    displayServerLogs(servers) {
        const statusList = document.getElementById('server-status-list');
        
        if (!servers || Object.keys(servers).length === 0) {
            statusList.innerHTML = '<div class="loading">No MCP servers configured or started.</div>';
            return;
        }
        
        statusList.innerHTML = Object.entries(servers).map(([name, info]) => `
            <div class="server-item ${info.status}">
                <div class="server-header">
                    <span class="server-name">${name}</span>
                    <span class="server-status ${info.status}">${info.status}</span>
                </div>
                <div class="server-description">${info.description || 'No description'}</div>
                ${info.pid ? `<div>PID: ${info.pid} | Uptime: ${Math.floor(info.uptime / 1000)}s</div>` : ''}
                ${info.logs ? `<div class="server-logs">${info.logs}</div>` : '<div class="server-logs">No logs available</div>'}
            </div>
        `).join('');
    }

    showMCPCallsModal() {
        this.mcpCallsModal.classList.add('show');
        this.refreshMCPCalls();
    }
    
    hideMCPCallsModal() {
        this.mcpCallsModal.classList.remove('show');
    }
    
    async refreshMCPCalls() {
        const callsList = document.getElementById('mcp-calls-list');
        callsList.innerHTML = '<div class="loading">Loading MCP call logs...</div>';
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.getMCPCallLogs();
                if (result.success) {
                    this.displayMCPCalls(result.data);
                } else {
                    callsList.innerHTML = `<div class="error">Error loading MCP call logs: ${result.error}</div>`;
                }
            }
        } catch (error) {
            callsList.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        }
    }
    
    async clearMCPCalls() {
        if (confirm('Are you sure you want to clear all MCP call logs?')) {
            try {
                if (window.electronAPI) {
                    const result = await window.electronAPI.clearMCPCallLogs();
                    if (result.success) {
                        this.refreshMCPCalls();
                    } else {
                        alert('Error clearing MCP call logs: ' + result.error);
                    }
                }
            } catch (error) {
                alert('Error clearing MCP call logs: ' + error.message);
            }
        }
    }
    
    async exportMCPCallsAsText() {
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.getMCPCallLogs();
                if (result.success && result.data) {
                    const textOutput = this.formatMCPCallsAsText(result.data);
                    
                    // Create a temporary textarea to copy the text
                    const textarea = document.createElement('textarea');
                    textarea.value = textOutput;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    
                    // Show success message
                    alert('MCP call logs copied to clipboard!');
                } else {
                    alert('Error exporting MCP call logs: ' + result.error);
                }
            }
        } catch (error) {
            alert('Error exporting MCP call logs: ' + error.message);
        }
    }
    
    formatMCPCallsAsText(calls) {
        if (!calls || calls.length === 0) {
            return 'No MCP calls logged yet.';
        }
        
        let output = '=== MCP CALL LOGS ===\n\n';
        
        calls.forEach((call, index) => {
            const timestamp = new Date(call.timestamp).toLocaleString();
            output += `[${index + 1}] ${call.type.toUpperCase()} - ${call.serverName}/${call.toolName}\n`;
            output += `Timestamp: ${timestamp}\n`;
            
            if (call.input) {
                output += `Input:\n${call.input}\n`;
            }
            
            if (call.output) {
                output += `Output:\n${call.output}\n`;
            }
            
            if (call.error) {
                output += `Error:\n${call.error}\n`;
            }
            
            output += '\n' + '='.repeat(80) + '\n\n';
        });
        
        return output;
    }
    
    displayMCPCalls(calls) {
        const callsList = document.getElementById('mcp-calls-list');
        
        if (!calls || calls.length === 0) {
            callsList.innerHTML = '<div class="loading">No MCP calls logged yet.</div>';
            return;
        }
        
        callsList.innerHTML = calls.map(call => {
            const typeClass = call.type === 'error' ? 'error' : (call.type === 'tool_call' ? 'tool-call' : 'server-output');
            const typeIcon = call.type === 'error' ? '❌' : (call.type === 'tool_call' ? '🔧' : '📡');
            
            return `
                <div class="mcp-call-item ${typeClass}">
                    <div class="call-header">
                        <span class="call-type">${typeIcon} ${call.type}</span>
                        <span class="call-server">${call.serverName}/${call.toolName}</span>
                        <span class="call-timestamp">${new Date(call.timestamp).toLocaleTimeString()}</span>
                    </div>
                    ${call.input ? `
                        <div class="call-section">
                            <div class="call-section-title">Input:</div>
                            <pre class="call-data">${call.input}</pre>
                        </div>
                    ` : ''}
                    ${call.output ? `
                        <div class="call-section">
                            <div class="call-section-title">Output:</div>
                            <pre class="call-data">${call.output}</pre>
                        </div>
                    ` : ''}
                    ${call.error ? `
                        <div class="call-section">
                            <div class="call-section-title">Error:</div>
                            <pre class="call-data error-text">${call.error}</pre>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TuneChatApp();
});