class TuneChatApp {
    constructor() {
        this.chatMessages = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.sendButton = document.getElementById('send-button');
        this.connectionStatus = document.getElementById('connection-status');
        this.credentialsModal = document.getElementById('credentials-modal');
        this.credentialsForm = document.getElementById('credentials-form');
        this.apiKeyInput = document.getElementById('api-key-input');
        this.wandbCredentialsModal = document.getElementById('wandb-credentials-modal');
        this.wandbCredentialsForm = document.getElementById('wandb-credentials-form');
        this.wandbApiKeyInput = document.getElementById('wandb-api-key-input');
        this.wandbProjectInput = document.getElementById('wandb-project-input');
        this.openaiCredentialsModal = document.getElementById('openai-credentials-modal');
        this.openaiCredentialsForm = document.getElementById('openai-credentials-form');
        this.openaiApiKeyInput = document.getElementById('openai-api-key');
        this.providerSelect = document.getElementById('provider-select');
        this.modelSelect = document.getElementById('model-select');
        this.serverLogsModal = document.getElementById('server-logs-modal');
        this.serverLogsBtn = document.getElementById('server-logs-btn');
        this.mcpCallsModal = document.getElementById('mcp-calls-modal');
        this.mcpCallsBtn = document.getElementById('mcp-calls-btn');
        this.rawApiModal = document.getElementById('raw-api-modal');
        this.rawApiBtn = document.getElementById('raw-api-btn');
        this.newChatBtn = document.getElementById('new-chat-btn');
        
        this.isConnected = false;
        this.isWaitingForResponse = false;
        this.mcpCallsTextView = false;
        this.currentStreamingMessage = null;
        this.streamingMessages = new Map();
        this.currentProvider = 'anthropic';
        this.currentModel = 'claude-3-5-sonnet-20240620';
        this.wandbModels = [];
        this.openaiModels = [];
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupElectronIPC();
        this.autoResizeInput();
        this.updateConnectionStatus('Connecting...');
        this.setupPanelToggling();
        this.initializeProviderStatus();
    }

    async initializeProviderStatus() {
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.getCurrentProvider();
                if (result.success) {
                    this.currentProvider = result.provider || 'anthropic';
                    this.providerSelect.value = this.currentProvider;
                    this.updateModelOptions(this.currentProvider);
                    this.updatePlaceholderText(this.currentProvider);
                    
                    if (result.model) {
                        this.currentModel = result.model;
                        this.modelSelect.value = result.model;
                    }
                }
            }
        } catch (error) {
            console.error('Error getting current provider status:', error);
            // Fall back to defaults
            this.currentProvider = 'anthropic';
            this.providerSelect.value = 'anthropic';
            this.updateModelOptions('anthropic');
            this.updatePlaceholderText('anthropic');
        }
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

        // WandB credentials modal event listeners
        this.wandbCredentialsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveWandbCredentials();
        });
        
        document.getElementById('cancel-wandb-credentials').addEventListener('click', () => {
            this.hideWandbCredentialsModal();
        });
        
        document.getElementById('get-wandb-api-key-link').addEventListener('click', (e) => {
            e.preventDefault();
            if (window.electronAPI) {
                window.electronAPI.openExternalLink('https://wandb.ai/authorize');
            }
        });

        // Provider switching buttons
        document.getElementById('use-wandb-instead').addEventListener('click', () => {
            this.hideCredentialsModal();
            this.showWandbCredentialsModal();
        });

        document.getElementById('use-anthropic-instead').addEventListener('click', () => {
            this.hideWandbCredentialsModal();
            this.showCredentialsModal();
        });

        // OpenAI credentials modal event listeners
        this.openaiCredentialsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveOpenaiCredentials();
        });
        
        document.getElementById('cancel-openai-credentials').addEventListener('click', () => {
            this.hideOpenaiCredentialsModal();
        });
        
        document.getElementById('get-openai-api-key-link').addEventListener('click', (e) => {
            e.preventDefault();
            if (window.electronAPI) {
                window.electronAPI.openExternalLink('https://platform.openai.com/api-keys');
            }
        });

        // Provider and model selector event listeners
        this.providerSelect.addEventListener('change', (e) => {
            this.handleProviderChange(e.target.value);
        });

        this.modelSelect.addEventListener('change', (e) => {
            this.handleModelChange(e.target.value);
        });
        
        
        // New chat button
        if (this.newChatBtn) {
            this.newChatBtn.addEventListener('click', () => {
                this.startNewChat();
            });
        }
        
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
        
        document.getElementById('toggle-text-view').addEventListener('click', () => {
            this.toggleMCPCallsTextView();
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
        
        // Raw API button
        this.rawApiBtn.addEventListener('click', () => {
            this.showRawApiModal();
        });
        
        // Raw API modal events
        document.getElementById('close-raw-api').addEventListener('click', () => {
            this.hideRawApiModal();
        });
        
        document.getElementById('refresh-raw-api').addEventListener('click', () => {
            this.refreshRawApi();
        });
        
        document.getElementById('clear-raw-api').addEventListener('click', () => {
            this.clearRawApi();
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
            this.currentProvider = message.provider || 'anthropic';
            let providerName = 'Claude';
            if (message.provider === 'wandb') {
                providerName = 'WandB';
            } else if (message.provider === 'openai') {
                providerName = 'OpenAI';
            }
            this.updateConnectionStatus(message.connected ? `Connected (${providerName})` : 'Disconnected', message.connected);
            
            // Update UI selectors
            this.providerSelect.value = this.currentProvider;
            
            // Store provider models if provided
            if (message.models && message.provider === 'wandb') {
                this.wandbModels = message.models;
            } else if (message.models && message.provider === 'openai') {
                this.openaiModels = message.models;
            }
            
            // Update model options for current provider
            this.updateModelOptions(this.currentProvider);
            
            return;
        }
        
        if (message.type === 'credentials_required') {
            this.showCredentialsModal();
            return;
        }
        
        if (message.type === 'wandb_credentials_required') {
            this.showWandbCredentialsModal();
            return;
        }
        
        if (message.type === 'openai_credentials_required') {
            this.showOpenaiCredentialsModal();
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
            this.finalizeStreamingMessage(message.messageId, message.content);
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
        
        let typingText = 'AI is typing';
        if (this.currentProvider === 'anthropic') {
            typingText = 'Claude is typing';
        } else if (this.currentProvider === 'openai') {
            typingText = 'ChatGPT is typing';
        }
        
        typingDiv.innerHTML = `
            ${typingText}
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
            messageData.element.textContent = finalContent || messageData.content || '';
            messageData.element.classList.remove('streaming');
            this.streamingMessages.delete(messageId);
            this.scrollToBottom();
        }
    }

    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    async showCredentialsModal() {
        this.credentialsModal.classList.add('show');
        
        // Try to prefill with environment variable if available
        try {
            if (window.electronAPI) {
                const envCreds = await window.electronAPI.getEnvCredentials();
                if (envCreds.success && envCreds.anthropic.apiKey) {
                    this.apiKeyInput.value = envCreds.anthropic.apiKey;
                }
            }
        } catch (error) {
            console.log('Could not prefill credentials:', error);
        }
        
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
                    // Update the provider selector to reflect the current provider
                    this.providerSelect.value = 'anthropic';
                    this.currentProvider = 'anthropic';
                    this.updateModelOptions('anthropic');
                } else {
                    alert('Failed to save credentials: ' + result.error);
                }
            }
        } catch (error) {
            alert('Error saving credentials: ' + error.message);
        }
    }

    async showWandbCredentialsModal() {
        this.wandbCredentialsModal.classList.add('show');
        
        // Try to prefill with environment variables if available
        try {
            if (window.electronAPI) {
                const envCreds = await window.electronAPI.getEnvCredentials();
                if (envCreds.success) {
                    if (envCreds.wandb.apiKey) {
                        this.wandbApiKeyInput.value = envCreds.wandb.apiKey;
                    }
                    if (envCreds.wandb.project) {
                        this.wandbProjectInput.value = envCreds.wandb.project;
                    }
                }
            }
        } catch (error) {
            console.log('Could not prefill WandB credentials:', error);
        }
        
        this.wandbApiKeyInput.focus();
        this.updateConnectionStatus('WandB Credentials Required');
    }
    
    hideWandbCredentialsModal() {
        this.wandbCredentialsModal.classList.remove('show');
        this.wandbApiKeyInput.value = '';
        this.wandbProjectInput.value = '';
    }
    
    async saveWandbCredentials() {
        const apiKey = this.wandbApiKeyInput.value.trim();
        const project = this.wandbProjectInput.value.trim();
        
        if (!apiKey) {
            alert('Please enter your WandB API key');
            return;
        }
        
        if (!project) {
            alert('Please enter your WandB project (team/project format)');
            return;
        }
        
        if (!project.includes('/')) {
            alert('Project should be in format "team/project"');
            return;
        }
        
        this.updateConnectionStatus('Connecting...');
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.saveWandbCredentials({ apiKey, project });
                if (result.success) {
                    this.hideWandbCredentialsModal();
                    // Update the provider selector to reflect the current provider
                    this.providerSelect.value = 'wandb';
                    this.currentProvider = 'wandb';
                    this.updateModelOptions('wandb');
                } else {
                    alert('Failed to save WandB credentials: ' + result.error);
                }
            }
        } catch (error) {
            alert('Error saving WandB credentials: ' + error.message);
        }
    }

    async showOpenaiCredentialsModal() {
        this.openaiCredentialsModal.classList.add('show');
        
        // Try to prefill with environment variables if available
        try {
            if (window.electronAPI) {
                const envCreds = await window.electronAPI.getEnvCredentials();
                if (envCreds.success && envCreds.openai && envCreds.openai.apiKey) {
                    this.openaiApiKeyInput.value = envCreds.openai.apiKey;
                }
            }
        } catch (error) {
            console.log('Could not prefill OpenAI credentials:', error);
        }
        
        this.openaiApiKeyInput.focus();
        this.updateConnectionStatus('OpenAI Credentials Required');
    }
    
    hideOpenaiCredentialsModal() {
        this.openaiCredentialsModal.classList.remove('show');
        this.openaiApiKeyInput.value = '';
    }
    
    async saveOpenaiCredentials() {
        const apiKey = this.openaiApiKeyInput.value.trim();
        
        if (!apiKey) {
            alert('Please enter your OpenAI API key');
            return;
        }
        
        if (!apiKey.startsWith('sk-')) {
            alert('OpenAI API key should start with "sk-"');
            return;
        }
        
        this.updateConnectionStatus('Connecting...');
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.saveOpenaiCredentials({ apiKey });
                if (result.success) {
                    this.updateConnectionStatus('Connected', true);
                    this.hideOpenaiCredentialsModal();
                    // Update the provider selector to reflect the current provider
                    this.providerSelect.value = 'openai';
                    this.currentProvider = 'openai';
                    this.updateModelOptions('openai');
                    this.updatePlaceholderText('openai');
                } else {
                    alert('Failed to save OpenAI credentials: ' + result.error);
                }
            }
        } catch (error) {
            alert('Error saving OpenAI credentials: ' + error.message);
        }
    }

    async handleProviderChange(provider) {
        console.log(`[FRONTEND DEBUG] Attempting to switch from ${this.currentProvider} to ${provider}`);
        
        if (provider !== this.currentProvider) {
            console.log(`[FRONTEND DEBUG] Provider change required: ${this.currentProvider} -> ${provider}`);
            try {
                if (window.electronAPI) {
                    console.log(`[FRONTEND DEBUG] Calling switchProvider IPC with provider: ${provider}`);
                    const result = await window.electronAPI.switchProvider(provider);
                    console.log(`[FRONTEND DEBUG] switchProvider result:`, result);
                    
                    if (result.success) {
                        console.log(`[FRONTEND DEBUG] Provider switch successful, updating frontend state`);
                        const oldProvider = this.currentProvider;
                        this.currentProvider = provider;
                        console.log(`[FRONTEND DEBUG] Updated this.currentProvider from ${oldProvider} to ${this.currentProvider}`);
                        
                        this.updateModelOptions(provider);
                        this.updatePlaceholderText(provider);
                        console.log(`[FRONTEND DEBUG] Updated model options for provider: ${provider}`);
                        
                        // Reset to default model for the provider
                        this.currentModel = this.modelSelect.value;
                        console.log(`[FRONTEND DEBUG] Set currentModel to: ${this.currentModel}`);
                        
                        // Verify the provider was actually switched by checking backend state
                        try {
                            const providerStatus = await window.electronAPI.getCurrentProvider();
                            console.log(`[FRONTEND DEBUG] Backend provider status after switch:`, providerStatus);
                            
                            if (providerStatus.success && providerStatus.provider !== provider) {
                                console.error(`[FRONTEND DEBUG] MISMATCH: Frontend thinks provider is ${provider}, backend reports ${providerStatus.provider}`);
                            }
                        } catch (verifyError) {
                            console.error(`[FRONTEND DEBUG] Error verifying provider switch:`, verifyError);
                        }
                        
                    } else {
                        console.log(`[FRONTEND DEBUG] Provider switch failed:`, result.error);
                        // If the provider isn't available, show credentials modal
                        if (provider === 'wandb' && result.error?.includes('not available or not initialized')) {
                            console.log(`[FRONTEND DEBUG] WandB not initialized, showing credentials modal`);
                            // Revert the selector first
                            this.providerSelect.value = this.currentProvider;
                            // Show WandB credentials modal
                            this.showWandbCredentialsModal();
                        } else if (provider === 'anthropic' && result.error?.includes('not available or not initialized')) {
                            console.log(`[FRONTEND DEBUG] Anthropic not initialized, showing credentials modal`);
                            // Revert the selector first
                            this.providerSelect.value = this.currentProvider;
                            // Show Anthropic credentials modal
                            this.showCredentialsModal();
                        } else if (provider === 'openai' && result.error?.includes('not available or not initialized')) {
                            console.log(`[FRONTEND DEBUG] OpenAI not initialized, showing credentials modal`);
                            // Revert the selector first
                            this.providerSelect.value = this.currentProvider;
                            // Show OpenAI credentials modal
                            this.showOpenaiCredentialsModal();
                        } else {
                            console.log(`[FRONTEND DEBUG] Provider switch failed for other reasons, reverting selector`);
                            // Revert the selector if switch failed for other reasons
                            this.providerSelect.value = this.currentProvider;
                            alert('Failed to switch provider: ' + result.error);
                        }
                    }
                } else {
                    console.error(`[FRONTEND DEBUG] electronAPI not available`);
                }
            } catch (error) {
                console.error(`[FRONTEND DEBUG] Exception during provider switch:`, error);
                this.providerSelect.value = this.currentProvider;
                alert('Error switching provider: ' + error.message);
            }
        } else {
            console.log(`[FRONTEND DEBUG] Provider already set to ${provider}, no change needed`);
        }
    }

    async handleModelChange(model) {
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.setModel(model);
                if (result.success) {
                    this.currentModel = model;
                } else {
                    // Revert the selector if model change failed
                    this.modelSelect.value = this.currentModel;
                    alert('Failed to change model: ' + result.error);
                }
            }
        } catch (error) {
            this.modelSelect.value = this.currentModel;
            alert('Error changing model: ' + error.message);
        }
    }

    updateModelOptions(provider) {
        const modelSelect = this.modelSelect;
        
        // Clear existing options
        modelSelect.innerHTML = '';
        
        if (provider === 'anthropic') {
            const claudeModels = [
                { value: 'claude-3-5-sonnet-20240620', text: 'Claude 3.5 Sonnet' },
                { value: 'claude-3-sonnet-20240229', text: 'Claude 3 Sonnet' },
                { value: 'claude-3-haiku-20240307', text: 'Claude 3 Haiku' }
            ];
            
            claudeModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.value;
                option.textContent = model.text;
                modelSelect.appendChild(option);
            });
            
            modelSelect.value = 'claude-3-5-sonnet-20240620';
        } else if (provider === 'wandb') {
            const wandbModels = this.wandbModels.length > 0 ? this.wandbModels : [
                { value: 'meta-llama/Llama-3.1-8B-Instruct', text: 'Llama 3.1 8B' },
                { value: 'meta-llama/Llama-3.1-70B-Instruct', text: 'Llama 3.1 70B' },
                { value: 'deepseek-ai/DeepSeek-V2.5', text: 'DeepSeek V2.5' }
            ];
            
            wandbModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id || model.value;
                option.textContent = model.name || model.text;
                modelSelect.appendChild(option);
            });
            
            modelSelect.value = 'meta-llama/Llama-3.1-8B-Instruct';
        } else if (provider === 'openai') {
            const openaiModels = this.openaiModels.length > 0 ? this.openaiModels : [
                { value: 'gpt-4o', text: 'GPT-4o' },
                { value: 'gpt-4o-mini', text: 'GPT-4o Mini' },
                { value: 'gpt-4-turbo', text: 'GPT-4 Turbo' },
                { value: 'gpt-3.5-turbo', text: 'GPT-3.5 Turbo' }
            ];
            
            openaiModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id || model.value;
                option.textContent = model.name || model.text;
                modelSelect.appendChild(option);
            });
            
            modelSelect.value = 'gpt-4o';
        }
        
        this.currentModel = modelSelect.value;
    }
    
    updatePlaceholderText(provider) {
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            if (provider === 'anthropic') {
                chatInput.placeholder = 'Ask Claude anything...';
            } else if (provider === 'wandb') {
                chatInput.placeholder = 'Ask the AI anything...';
            } else if (provider === 'openai') {
                chatInput.placeholder = 'Ask ChatGPT anything...';
            }
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
    
    toggleMCPCallsTextView() {
        this.mcpCallsTextView = !this.mcpCallsTextView;
        const button = document.getElementById('toggle-text-view');
        
        if (this.mcpCallsTextView) {
            button.textContent = '📋 Show Formatted';
        } else {
            button.textContent = '📄 Show as Text';
        }
        
        this.refreshMCPCalls();
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
        
        if (this.mcpCallsTextView) {
            // Show as text view
            const textOutput = this.formatMCPCallsAsText(calls);
            callsList.innerHTML = `<pre class="text-view-output">${textOutput}</pre>`;
        } else {
            // Show as formatted view
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
    
    async startNewChat() {
        if (confirm('Start a new chat? This will clear the current conversation.')) {
            // Clear the chat UI
            this.chatMessages.innerHTML = `
                <div class="welcome-message">
                    <p>Welcome to Tune Chat! I can help with file operations and web browsing.</p>
                    <p class="setup-reminder">
                        📁 I have access to your file system for reading and writing files<br>
                        🌐 For web browsing, install the <a href="https://browsermcp.io/install" target="_blank">BrowserMCP extension</a>
                    </p>
                </div>
            `;
            
            // Clear the conversation history on the backend
            try {
                await window.electronAPI.clearConversation();
            } catch (error) {
                console.error('Error clearing conversation:', error);
            }
        }
    }
    
    setupPanelToggling() {
        // Add click handlers for panel headers
        document.querySelectorAll('.panel-header').forEach(header => {
            header.addEventListener('click', () => {
                const panelName = header.dataset.panel;
                const content = document.getElementById(`${panelName}-panel`);
                const toggle = header.querySelector('.panel-toggle');
                
                if (content) {
                    content.classList.toggle('collapsed');
                    
                    // Update toggle icon
                    if (content.classList.contains('collapsed')) {
                        toggle.textContent = '⌄';
                    } else {
                        toggle.textContent = '×';
                    }
                }
            });
        });
    }
    
    showRawApiModal() {
        this.rawApiModal.classList.add('show');
        this.refreshRawApi();
    }
    
    hideRawApiModal() {
        this.rawApiModal.classList.remove('show');
    }
    
    async refreshRawApi() {
        const rawApiContent = document.getElementById('raw-api-content');
        rawApiContent.innerHTML = '<div class="loading">Loading raw API logs...</div>';
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.getRawApiLogs();
                if (result.success) {
                    this.displayRawApiLogs(result.data);
                } else {
                    rawApiContent.innerHTML = `<div class="error">Error loading raw API logs: ${result.error}</div>`;
                }
            }
        } catch (error) {
            rawApiContent.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        }
    }
    
    displayRawApiLogs(logs) {
        const rawApiContent = document.getElementById('raw-api-content');
        
        if (!logs || logs.length === 0) {
            rawApiContent.innerHTML = '<div class="no-data">No raw API logs available yet.</div>';
            return;
        }
        
        rawApiContent.innerHTML = logs.map((log, index) => {
            const combinedData = {
                call_info: {
                    index: index + 1,
                    provider: log.provider.toUpperCase(),
                    model: log.model,
                    timestamp: log.timestamp
                },
                request: log.request,
                response: log.response
            };
            
            return `
                <div class="api-log-entry">
                    <div class="api-log-header">
                        <span class="api-log-id">[${index + 1}] ${log.provider.toUpperCase()}</span>
                        <span class="api-log-timestamp">${new Date(log.timestamp).toLocaleString()}</span>
                        <span class="api-log-model">${log.model}</span>
                    </div>
                    <div class="api-log-content">
                        <pre class="api-log-data-combined">${JSON.stringify(combinedData, null, 2)}</pre>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    async clearRawApi() {
        if (confirm('Are you sure you want to clear all raw API logs?')) {
            try {
                if (window.electronAPI) {
                    const result = await window.electronAPI.clearRawApiLogs();
                    if (result.success) {
                        this.refreshRawApi();
                    } else {
                        alert('Error clearing raw API logs: ' + result.error);
                    }
                }
            } catch (error) {
                alert('Error clearing raw API logs: ' + error.message);
            }
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TuneChatApp();
});