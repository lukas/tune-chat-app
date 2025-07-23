const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
    saveCredentials: (apiKey) => ipcRenderer.invoke('save-credentials', apiKey),
    saveWandbCredentials: (credentials) => ipcRenderer.invoke('save-wandb-credentials', credentials),
    switchProvider: (provider) => ipcRenderer.invoke('switch-provider', provider),
    getCurrentProvider: () => ipcRenderer.invoke('get-current-provider'),
    getEnvCredentials: () => ipcRenderer.invoke('get-env-credentials'),
    setModel: (model) => ipcRenderer.invoke('set-model', model),
    getServerLogs: () => ipcRenderer.invoke('get-server-logs'),
    getMCPCallLogs: () => ipcRenderer.invoke('get-mcp-call-logs'),
    clearMCPCallLogs: () => ipcRenderer.invoke('clear-mcp-call-logs'),
    clearConversation: () => ipcRenderer.invoke('clear-conversation'),
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
    onBackendMessage: (callback) => ipcRenderer.on('backend-message', callback),
    removeBackendMessageListener: (callback) => ipcRenderer.removeListener('backend-message', callback)
});