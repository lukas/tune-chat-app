const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

let mainWindow;
let pythonProcess;
let ws;

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

function startPythonBackend() {
    console.log('Starting Python backend...');
    
    const pythonScript = path.join(__dirname, 'backend', 'python', 'main.py');
    
    pythonProcess = spawn('python3', [pythonScript], {
        stdio: 'pipe'
    });
    
    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python backend: ${data}`);
    });
    
    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python backend error: ${data}`);
    });
    
    pythonProcess.on('close', (code) => {
        console.log(`Python backend process exited with code ${code}`);
    });
    
    // Wait a bit for the Python server to start, then connect WebSocket
    setTimeout(connectToBackend, 3000);
}

function connectToBackend() {
    ws = new WebSocket('ws://localhost:8765');
    
    ws.on('open', () => {
        console.log('Connected to Python backend');
    });
    
    ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        mainWindow.webContents.send('backend-message', message);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    
    ws.on('close', () => {
        console.log('Disconnected from Python backend');
    });
}

// IPC handlers
ipcMain.handle('send-chat-message', async (event, message) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'chat_message',
            content: message
        }));
        return { success: true };
    } else {
        return { success: false, error: 'Backend not connected' };
    }
});

app.whenReady().then(() => {
    createWindow();
    startPythonBackend();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
    if (ws) {
        ws.close();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
    if (ws) {
        ws.close();
    }
});