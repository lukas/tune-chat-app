class TuneChatApp {
    constructor() {
        this.chatMessages = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.sendButton = document.getElementById('send-button');
        this.connectionStatus = document.getElementById('connection-status');
        
        this.isConnected = false;
        this.isWaitingForResponse = false;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupElectronIPC();
        this.autoResizeInput();
        this.updateConnectionStatus('Connecting...');
        
        // Simulate connection after a delay
        setTimeout(() => {
            this.updateConnectionStatus('Connected', true);
        }, 2000);
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
    
    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new TuneChatApp();
});