const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
    saveCredentials: (apiKey) => ipcRenderer.invoke('save-credentials', apiKey),
    getServerLogs: () => ipcRenderer.invoke('get-server-logs'),
    getMCPCallLogs: () => ipcRenderer.invoke('get-mcp-call-logs'),
    clearMCPCallLogs: () => ipcRenderer.invoke('clear-mcp-call-logs'),
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
    onBackendMessage: (callback) => ipcRenderer.on('backend-message', callback),
    removeBackendMessageListener: (callback) => ipcRenderer.removeListener('backend-message', callback)
});