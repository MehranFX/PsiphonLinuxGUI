// Modules to control application life and create native browser window
const { app, BrowserWindow, shell, screen } = require('electron')
const path = require('node:path')

// Linux: avoid blank/white window (GPU compositor issues)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')

const openDevTools = process.argv.includes('--devtools')

const webPreferences = {
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    webSecurity: false,
}
const { execSync, spawn } = require('child_process');
const { ipcMain } = require('electron');
const { getScript, appBackendDir, iconsDir } = require('./util');
const { setSystemProxy, clearSystemProxy, isGsettingsAvailable } = require('./systemProxy');
const { parseTunnelNoticeLines, mergeTunnelStatus } = require('./tunnelNoticeParser');

const psiphonPath = path.join(appBackendDir, 'psiphon.sh');
const checkPort = path.join(appBackendDir, 'check-port.sh');
const proxyWatch = path.join(appBackendDir, 'proxy-watch.sh');

const LOG_BUFFER_MAX = 400;
const logBuffer = [];
let systemProxyEnabled = false;
let activeTunnelStatus = { protocol: '', serverRegion: '' };

function sendTunnelStatus() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    mainWindow.webContents.send('tunnel-status', { ...activeTunnelStatus });
}

function clearTunnelStatus() {
    activeTunnelStatus = { protocol: '', serverRegion: '' };
    sendTunnelStatus();
}

function handleTunnelStdout(msg, event) {
    const notices = parseTunnelNoticeLines(msg);
    if (!notices.length) {
        return;
    }
    const { status, changed } = mergeTunnelStatus(activeTunnelStatus, notices);
    if (!changed) {
        return;
    }
    activeTunnelStatus = status;
    if (event) {
        event.reply('tunnel-status', { ...activeTunnelStatus });
    } else {
        sendTunnelStatus();
    }
    if (activeTunnelStatus.protocol) {
        const region = activeTunnelStatus.serverRegion || '?';
        pushLog('tunnel', `Connected via ${activeTunnelStatus.protocol} (server ${region})`);
    }
}

function formatLogTime() {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function pushLog(source, message) {
    const text = String(message ?? '').trim();
    if (!text) {
        return;
    }

    text.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }
        const entry = `[${formatLogTime()}] [${source}] ${trimmed}`;
        logBuffer.push(entry);
        if (logBuffer.length > LOG_BUFFER_MAX) {
            logBuffer.shift();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app-log', entry);
        }
        console.log(entry);
    });
}

function clearSystemProxyIfEnabled() {
    if (!systemProxyEnabled) {
        return;
    }
    try {
        clearSystemProxy();
        pushLog('system', 'System proxy cleared');
    } catch (err) {
        pushLog('error', `Failed to clear system proxy: ${err.message}`);
    }
    systemProxyEnabled = false;
}

let restoreProxySettings = [];
let isPortFree = false;

let mainWindow = null;
let childWindow = null;

const MAIN_WINDOW_WIDTH = 400;
const MAIN_WINDOW_HEIGHT = 540;
const MAIN_WINDOW_MIN_HEIGHT = 420;

function getPrimaryCenteredBounds(width, height) {
    const { workArea } = screen.getPrimaryDisplay();
    return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height,
    };
}

function centerWindowOnPrimary(window, width, height) {
    if (!window || window.isDestroyed()) {
        return;
    }
    const bounds = getPrimaryCenteredBounds(width, height);
    window.setBounds(bounds);
}

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        ...getPrimaryCenteredBounds(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT),
        minWidth: 380,
        minHeight: MAIN_WINDOW_MIN_HEIGHT,
        show: false,
        backgroundColor: '#1e2433',
        icon: `${iconsDir}/psiphonlinuxgui.png`,
        autoHideMenuBar: true,
        webPreferences,
    })

    mainWindow.once('ready-to-show', () => {
        centerWindowOnPrimary(mainWindow, MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT);
        mainWindow.show()
    })

    mainWindow.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
        console.error(`[renderer] ${message} (${sourceId}:${line})`)
    })
    mainWindow.webContents.on('did-fail-load', (_, code, desc) => {
        console.error('Main window failed to load:', code, desc)
    })
    mainWindow.webContents.on('render-process-gone', (_, details) => {
        console.error('Main window render process gone:', details)
    })

    mainWindow.loadFile(path.join(__dirname, 'renderer/main/index.html'))
        .catch(err => console.error('loadFile error:', err))

    mainWindow.webContents.on('did-finish-load', () => {
        if (openDevTools) {
            mainWindow.webContents.openDevTools({ mode: 'detach' })
        }
    })

    // Event handler for new windows
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

function createSettingsWindow() {
    const settingsWidth = 700;
    const settingsHeight = 600;
    const settingsBounds = getPrimaryCenteredBounds(settingsWidth, settingsHeight);

    // Create the setting window.
    childWindow = new BrowserWindow({
        title: "Setting",
        ...settingsBounds,
        minWidth: settingsWidth,
        minHeight: settingsHeight,
        maxWidth: settingsWidth,
        maxHeight: settingsHeight,

        icon: `${iconsDir}/psiphonlinuxgui.png`,

        minimizable: false,
        maximizable: false,
        resizable: false,

        autoHideMenuBar: true,
        parent: mainWindow,
        modal: true,
        webPreferences,
    });

    // and load the settings.html of the app.
    childWindow.loadFile(path.join(__dirname, 'renderer/settings/settings.html'));

    // Open the DevTools.
    // childWindow.webContents.openDevTools();

    // Event handler for new windows
    childWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
    createWindow()
    pushLog('app', 'PsiphonLinuxGUI started');

    app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
    clearSystemProxyIfEnabled();
})


// Function to run a process with given command and arguments
function runProcess({ command, args = [], label = '', onStdOut, onStdErr, onError, event }) {
    const child = spawn(command, args, {
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    });

    let stdoutPrinted = false;
    let stderrPrinted = false;

    child.stdout.on('data', data => {
        const msg = data.toString();
        if (!stdoutPrinted && label) {
            pushLog('process', `Started: ${label}`);
            stdoutPrinted = true;
        }
        pushLog(label || 'process', msg);
        if (onStdOut) onStdOut(msg, event);
    });

    child.stderr.on('data', data => {
        const msg = data.toString();
        if (!stderrPrinted && label) {
            pushLog('process', `stderr: ${label}`);
            stderrPrinted = true;
        }
        pushLog(label || 'process', msg);
        if (onStdErr) onStdErr(msg, event);
    });

    child.on('close', code => {
        pushLog(label || 'process', `Exited with code ${code}`);
    });

    child.on('error', err => {
        pushLog('error', `Failed to execute ${label}: ${err}`);
        if (onError) onError(err, event);
    });
}

// Function to execute start/stop scripts for changing proxy settings
function executeScripts(proxySettings, scriptType, event) {
    // Iterate through the proxy settings and execute the corresponding script
    proxySettings.forEach(proxySetting => {
        const script = getScript(proxySetting, scriptType);
        if (!script) {
            return;
        }

        runProcess({
            command: 'bash',
            args: [script],
            label: script,
            event,
            onStdErr: (msg, event) => {
                if (event && msg.includes('is not installed')) {
                    event.reply('proxy-setting-error', proxySetting);
                }
            },
            onError: (err, event) => {
                if (event && err.toString().includes('is not installed')) {
                    event.reply('proxy-setting-error', proxySetting);
                }
            }
        });
    });
}

// Function to execute start/stop script for changing proxy settings
function executeStartStopScript(command, args, event) {
    const isTunnelStart = String(command).includes('psiphon') && args[0] === 'start';
    const isTunnelStop = String(command).includes('psiphon') && args[0] === 'stop';

    if (isTunnelStart) {
        clearTunnelStatus();
    } else if (isTunnelStop) {
        clearTunnelStatus();
    }

    runProcess({
        command,
        args,
        label: `${command} ${args[0]}`,
        event,
        onStdOut: isTunnelStart ? (msg, ev) => handleTunnelStdout(msg, ev) : undefined,
        onStdErr: isTunnelStart ? (msg, ev) => handleTunnelStdout(msg, ev) : undefined,
        onError: (err, event) => {
            if (event && err.toString().includes('EACCES')) {
                event.reply('server-error', err);
            }
        }
    });
}

// Function to execute the proxy watch script
function executeProxyWatchScript(event) {
    runProcess({
        command: 'bash',
        args: [proxyWatch],
        label: 'Proxy Watcher',
        event,
        onStdOut: (msg, event) => {
            if (event && msg.includes('HTTP:OK') && msg.includes('DEVICE:OK')) {
                pushLog('watch', 'Tunnel proxy is up (HTTP:OK)');
                event.reply('proxy-watch', "HTTP:OK");
            } else if (event && msg.includes('HTTP:DOWN') && msg.includes('DEVICE:OK')) {
                pushLog('watch', 'Tunnel proxy is down (HTTP:DOWN)');
                event.reply('proxy-watch', "HTTP:DOWN");
            } else if (event && msg.includes('DEVICE:DOWN')) {
                pushLog('watch', 'Device network is down (DEVICE:DOWN)');
                event.reply('proxy-watch', "DEVICE:DOWN");
            } else {
                pushLog('watch', msg.trim());
            }
        }
    });
}

// Stop any leftover tunnel from a previous session before starting a new one
function stopStaleTunnel() {
    try {
        execSync(`bash ${psiphonPath} stop`, { stdio: 'pipe' });
    } catch (_) { /* no running tunnel */ }

    for (let i = 0; i < 15; i++) {
        if (!getPortOccupiedMessage()) {
            return;
        }
        try {
            execSync(`bash ${psiphonPath} stop`, { stdio: 'pipe' });
            execSync('sleep 0.2', { stdio: 'pipe', shell: '/bin/bash' });
        } catch (_) { /* retry */ }
    }
}

// Check whether the local proxy port is available (synchronous)
function getPortOccupiedMessage() {
    try {
        const out = execSync(`bash ${checkPort}`, { encoding: 'utf-8' });
        if (out.includes('to connect to proxy server is occupied')) {
            return out.trim();
        }
    } catch (e) {
        const out = (e.stdout && e.stdout.toString()) || '';
        if (out.includes('to connect to proxy server is occupied')) {
            return out.trim();
        }
    }
    return null;
}

// Function to get IP info via curl
function fetchIPInfoViaCurl(event) {
    runProcess({
        command: 'bash',
        args: ['-c', 'curl -s --max-time 10 --proxy http://127.0.0.1:8081 http://ip-api.com/json/'],
        label: 'Fetch IP Info',
        event,
        onStdOut: (msg, event) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.status === 'success' && event) {
                    event.reply('ip-info-result', {
                        ip: data.query,
                        country: data.country,
                        countryCode: data.countryCode,
                        city: data.city
                    });
                } else {
                    if (event) event.reply('ip-info-result', {
                        ip: '---', country: '---', countryCode: null, city: '---'
                    });
                }
            } catch (e) {
                if (event) event.reply('ip-info-result', {
                    ip: '---', country: '---', countryCode: null, city: '---'
                });
            }
        },
        onStdErr: (msg, event) => {
            if (event) event.reply('ip-info-result', {
                ip: '---', country: '---', countryCode: null, city: '---'
            });
        },
        onError: (err, event) => {
            if (event) event.reply('ip-info-result', {
                ip: '---', country: '---', countryCode: null, city: '---'
            });
        }
    });
}

// Event listener for the process exit event
process.on('exit', () => {
    // Iterate through the list of proxy settings to restore
    restoreProxySettings.forEach(restoreProxySetting => {
        // Execute a command to kill the psiphon-tunnel-core process synchronously
        executeStartStopScript(psiphonPath, ['stop'], null);

        let stopScript = getScript(restoreProxySetting, "stopScript");

        // Execute a script to disable each proxy setting
        execSync(`bash ${stopScript}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Failed to execute ${stopScript}:`, error); // Log error on script failure
            }
            if (stderr) {
                console.log(`Script ${stopScript} produced stderr:`, stderr); // Log any warnings from stderr
            }
            console.log(`Executed ${stopScript}:`, stdout); // Log success message
        });
    });

    // Execute a command to kill the psiphon-tunnel-core process synchronously
    executeStartStopScript(psiphonPath, ['stop'], null);
});

function getWorkAreaForWindow(bounds) {
    const point = {
        x: bounds.x + Math.floor(bounds.width / 2),
        y: bounds.y + Math.floor(bounds.height / 2),
    };
    return screen.getDisplayNearestPoint(point).workArea;
}

ipcMain.on('fit-window-height', (_event, height) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const current = mainWindow.getBounds();
    const workArea = getWorkAreaForWindow(current);
    const clamped = Math.min(
        workArea.height - 24,
        Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.round(height)),
    );

    let { x, y, width } = current;

    if (y + clamped > workArea.y + workArea.height) {
        y = workArea.y + workArea.height - clamped;
    }
    if (y < workArea.y) {
        y = workArea.y;
    }
    if (x + width > workArea.x + workArea.width) {
        x = workArea.x + workArea.width - width;
    }
    if (x < workArea.x) {
        x = workArea.x;
    }

    mainWindow.setBounds({ x, y, width, height: clamped });
});

// Listener for debug logging
ipcMain.on('debug', (_, args) => {
    // Log each debug argument to the console
    args.forEach(arg => {
        console.log(arg);
    });
});

// Listener for opening the settings page
ipcMain.on('open-settings-page', () => {
    createSettingsWindow();
});

// Listener for getting IP info 
ipcMain.on('fetch-ip-info', (event) => {
    fetchIPInfoViaCurl(event);
});

// Listener for starting the VPN/proxy server
ipcMain.on('start-vpn-proxy-server', (event) => {
    pushLog('tunnel', 'Starting VPN/proxy server…');
    stopStaleTunnel();

    if (!isPortFree) {
        const portError = getPortOccupiedMessage();
        if (portError) {
            isPortFree = false;
            pushLog('error', portError);
            event.reply('port-error', portError);
            return;
        }
    }
    isPortFree = true;

    // Start the proxy watch script to monitor the connection status
    executeProxyWatchScript(event);

    // Execute a command to start the psiphon-tunnel-core with a specific configuration
    executeStartStopScript(psiphonPath, ['start'], event);
});

// Listener for shutting down the VPN/proxy server
ipcMain.on('shutdown', () => {
    pushLog('tunnel', 'Stopping VPN/proxy server…');
    isPortFree = false;
    // Execute a command to kill the psiphon-tunnel-core process synchronously
    executeStartStopScript(psiphonPath, ['stop'], null);
});

// Listener for changing proxy settings
ipcMain.on('change-proxy-setting', (event, changeProxySettings) => {
    pushLog('browser', `Applying browser proxy: ${changeProxySettings.join(', ')}`);
    executeScripts(changeProxySettings, "startScript", event);
    restoreProxySettings = [...changeProxySettings];
});

// Listener for restoring individual proxy settings
ipcMain.on('restore-setting', (_, args) => {
    pushLog('browser', `Restoring browser proxy: ${args.join(', ')}`);
    // Execute the stop script for the specified proxy settings
    executeScripts(args, "stopScript", null);

    // Update the restore list by removing the restored settings
    args.forEach(arg => {
        // Remove the setting from the restore list
        restoreProxySettings.splice(restoreProxySettings.indexOf(arg), 1);
    });
});

// Listener for restoring all proxy settings
ipcMain.on('restore-settings', (_) => {
    // Execute the stop script for all proxy settings in the restore list
    executeScripts(restoreProxySettings, "stopScript", null);

    // Clear the restore list
    restoreProxySettings = [];
});

// Listener to refresh the browser list 
ipcMain.on('browser-list-updated', () => {
    if (mainWindow) {
        mainWindow.webContents.send('refresh-browser-list');
    }
});

// Listener to refresh the browser list 
ipcMain.on('info-text-change', () => {
    if (mainWindow) {
        mainWindow.webContents.send('refresh-info-text');
    }
});

// Listener to refresh the theme 
ipcMain.on('theme-updated', () => {
    if (mainWindow) {
        mainWindow.webContents.send('refresh-theme');
    }
});

// Listener to set attention to the app window
ipcMain.on('set-attention', () => {
    if (!mainWindow) return;

    mainWindow.focus(true);
});

// Handler for an invoke the version number of the app
ipcMain.handle('get-version', async () => {
    return app.getVersion();
});

ipcMain.handle('set-system-proxy', async (_, enabled) => {
    try {
        if (!isGsettingsAvailable()) {
            throw new Error('gsettings is not available on this system');
        }
        if (enabled) {
            setSystemProxy();
            systemProxyEnabled = true;
            pushLog('system', 'System proxy enabled → HTTP/HTTPS 127.0.0.1:8081, SOCKS 127.0.0.1:1081');
        } else {
            clearSystemProxy();
            systemProxyEnabled = false;
            pushLog('system', 'System proxy cleared');
        }
        return { ok: true };
    } catch (err) {
        pushLog('error', err.message);
        return { ok: false, error: err.message };
    }
});

ipcMain.on('get-log-buffer', (event) => {
    event.reply('log-buffer', logBuffer);
});
