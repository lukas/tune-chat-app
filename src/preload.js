const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    sendChatMessage: (message) => ipcRenderer.invoke('send-chat-message', message),
    onBackendMessage: (callback) => ipcRenderer.on('backend-message', callback),
    removeBackendMessageListener: (callback) => ipcRenderer.removeListener('backend-message', callback)
});