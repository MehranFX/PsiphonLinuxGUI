const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { filterInstalledBrowsers } = require('./browserDetect');
const {
    getTransportSettings,
    applyTransportSettings,
    mergeConfigOverlay,
    validateTransportSettings,
    TRANSPORT_STORAGE_KEYS,
    PROTOCOL_SELECTION,
    CONDUIT_MODE,
    CONDUIT_BLOCKED_MESSAGE,
    conduitDistributorReadiness,
    transportSelectionLabel,
    probeBackendCapabilities,
    getCdnFrontingModeHint: getTransportCdnHint,
    getConnectionTimeoutMs: getTransportConnectionTimeoutMs,
} = require('./transportConfig');

function getCdnFrontingModeHint() {
    return getTransportCdnHint(userBackendBinaryPath);
}

function getConnectionTimeoutMs(settings) {
    return getTransportConnectionTimeoutMs(settings || getTransportSettings());
}

function getIpcRenderer() {
    try {
        if (typeof process !== 'undefined' && process.type === 'renderer') {
            return require('electron').ipcRenderer;
        }
    } catch (_) { /* main process */ }
    return null;
}

function notifyUser(message) {
    try {
        if (typeof process !== 'undefined' && process.type === 'renderer' && typeof alert === 'function') {
            alert(message);
            return;
        }
    } catch (_) { /* ignore */ }
    console.error(message);
}

function fileUrlFromPath(filePath) {
    return pathToFileURL(filePath).href;
}

const scriptPath = path.join(__dirname, '../scripts');

const assetsDir = path.join(__dirname, 'assets');
const iconsDir = path.join(assetsDir, 'icons');
const imagesDir = path.join(assetsDir, 'images');

const appConfigDir = path.join(__dirname, 'configs');

const userConfigDir = path.join(os.homedir(), '.config', 'psiphonlinuxgui');
const userBackendBinaryPath = path.join(userConfigDir, 'psiphon-tunnel-core-x86_64');

const appBackendDir = path.join(__dirname, 'backend');

// GitHub API URLs
const BACKEND_COMMITS_API = 'https://api.github.com/repos/Psiphon-Labs/psiphon-tunnel-core-binaries/commits?path=linux/psiphon-tunnel-core-x86_64&per_page=1';
const BACKEND_BINARY_URL = 'https://github.com/Psiphon-Labs/psiphon-tunnel-core-binaries/raw/master/linux/psiphon-tunnel-core-x86_64';
const GUI_RELEASES_API = 'https://api.github.com/repos/Alessandros-Hube/PsiphonLinuxGUI/releases/latest';

// Function to get the default file
function getDefaultFile(file) {
    let defaultFile;
    switch (file) {
        case 'browser.config':
            defaultFile = path.join(appConfigDir, 'browser.config');
            break;
        case 'psiphon.config':
            defaultFile = path.join(appConfigDir, 'psiphon.config');
            break;
        case 'backendVersion.config':
            defaultFile = path.join(appConfigDir, 'backendVersion.config');
            break;
        case 'psiphon-tunnel-core-x86_64':
            defaultFile = path.join(appBackendDir, 'psiphon-tunnel-core-x86_64');
            break;
        default:
            throw `Error: There is no default file defined for ${file}.`;
    }
    return defaultFile
}

// Function to read a file
function readFile(file) {
    return fs.readFileSync(file, 'utf-8');
}

// Function to write a file
function writeFile(file, data) {
    fs.writeFileSync(file, data, 'utf-8');
}

// Function to write a file safely
function writeFileSafe(file, data) {
    try {
        writeFile(file, data);
    } catch (e) {
        notifyUser(
            'Failed to write file.\n\n' +
            'The file could not be saved.\n\n' +
            `Details: ${e.message || e}`
        );
    }
}

// Function to copy file
function copyFile(src, dest) {
    fs.copyFileSync(src, dest);
}

// Function to get the user config path file
function getConfigPath(configFile) {
    try {
        const userConfigFilePath = path.join(userConfigDir, configFile);
        // User config does not exist - copy from default
        if (!fs.existsSync(userConfigFilePath)) {
            const defaultConfigPath = getDefaultFile(configFile);
            copyFile(defaultConfigPath, userConfigFilePath);
        }

        return userConfigFilePath;
    } catch (e) {
        notifyUser(
            'Failed to load the configuration file.\n\n' +
            'Either no default configuration was defined for this config file, ' +
            'or the default configuration file could not be found.\n\n' +
            'The installation may be corrupted.\n\n' +
            `Details: ${e.message || e}`
        );
        return false;
    }
}

// Create user config folder if it does not exist
function createUserConfigFolder() {
    if (!fs.existsSync(userConfigDir)) {
        fs.mkdirSync(userConfigDir, { recursive: true });
    }
}

// Function to get the user config as json
function getConfig(configFile) {
    createUserConfigFolder();

    try {
        const userConfigFilePath = getConfigPath(configFile);
        return userConfigFilePath ? JSON.parse(readFile(userConfigFilePath)) : false;
    } catch (e) {
        notifyUser(
            'Failed to read JSON file.\n\n' +
            `Details: ${e.message || e}`
        );
        return false;
    }
}

// Function to get the default browser config
function getDefaultBrowserConfig() {
    try {
        const defaultConfigPath = getDefaultFile('browser.config');
        return JSON.parse(readFile(defaultConfigPath));
    } catch (e) {
        notifyUser(
            'Failed to load the configuration file.\n\n' +
            'Either no default configuration was defined for this config file, ' +
            'or the default configuration file could not be found.\n\n' +
            'The installation may be corrupted.\n\n' +
            `Details: ${e.message || e}`
        );
        return false;
    }
}

// Merge user browser list with newly added defaults
function getMergedBrowserConfig() {
    const userConfig = getConfig('browser.config') || [];
    const defaultConfig = getDefaultBrowserConfig() || [];
    if (!Array.isArray(userConfig) || !Array.isArray(defaultConfig)) {
        return userConfig || defaultConfig || [];
    }
    const known = new Set(userConfig.map((b) => b.name));
    const merged = [...userConfig];
    defaultConfig.forEach((browser) => {
        if (!known.has(browser.name)) {
            merged.push(browser);
        }
    });
    return merged;
}

function persistMergedBrowserConfig() {
    const userConfig = getConfig('browser.config') || [];
    const merged = getMergedBrowserConfig();
    if (!Array.isArray(userConfig) || merged.length <= userConfig.length) {
        return;
    }
    const userConfigFilePath = getConfigPath('browser.config');
    if (userConfigFilePath) {
        writeFile(userConfigFilePath, JSON.stringify(merged, null, 2));
    }
}

// Create the browser list (only browsers installed on this system)
function createBrowserList(browserList, createBrowserListItem) {
    persistMergedBrowserConfig();
    const browserConfig = getMergedBrowserConfig();
    const installed = filterInstalledBrowsers(browserConfig);
    browserList.innerHTML = createBrowserListItem(installed);

    const emptyEl = document.getElementById('browserEmpty');
    const countEl = document.getElementById('browserCount');
    if (emptyEl) {
        emptyEl.classList.toggle('hidden', installed.length > 0);
    }
    if (countEl) {
        countEl.textContent = installed.length > 0 ? String(installed.length) : '';
        countEl.classList.toggle('hidden', installed.length === 0);
    }
}

const UPSTREAM_PROXY_STORAGE_KEYS = {
    enabled: 'upstreamProxyEnabled',
    type: 'upstreamProxyType',
    host: 'upstreamProxyHost',
    port: 'upstreamProxyPort',
    username: 'upstreamProxyUsername',
    password: 'upstreamProxyPassword',
};

function getUpstreamProxySettings() {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    if (!storage) {
        return { enabled: false, type: 'http', host: '', port: '', username: '', password: '' };
    }
    return {
        enabled: storage.getItem(UPSTREAM_PROXY_STORAGE_KEYS.enabled) === 'true',
        type: storage.getItem(UPSTREAM_PROXY_STORAGE_KEYS.type) || 'http',
        host: storage.getItem(UPSTREAM_PROXY_STORAGE_KEYS.host) || '',
        port: storage.getItem(UPSTREAM_PROXY_STORAGE_KEYS.port) || '',
        username: storage.getItem(UPSTREAM_PROXY_STORAGE_KEYS.username) || '',
        password: storage.getItem(UPSTREAM_PROXY_STORAGE_KEYS.password) || '',
    };
}

function buildUpstreamProxyURL(settings) {
    if (!settings || !settings.enabled) {
        return '';
    }

    const host = (settings.host || '').trim();
    const port = String(settings.port || '').trim();
    if (!host || !port) {
        return '';
    }

    const type = settings.type || 'http';
    const scheme = type === 'socks5' ? 'socks5' : (type === 'socks4a' ? 'socks4a' : 'http');

    const username = (settings.username || '').trim();
    const password = settings.password || '';

    let credentials = '';
    if (username) {
        credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
    }

    return `${scheme}://${credentials}${host}:${port}`;
}

function validateUpstreamProxySettings(settings) {
    if (!settings || !settings.enabled) {
        return { valid: true };
    }
    const host = (settings.host || '').trim();
    const port = String(settings.port || '').trim();
    if (!host || !port) {
        return {
            valid: false,
            message: 'Upstream proxy is enabled. Please enter host and port in Settings → General.',
        };
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return {
            valid: false,
            message: 'Upstream proxy port must be a number between 1 and 65535.',
        };
    }
    return { valid: true };
}

// Create the psiphon config
function createPsiphonConfig(country, upstreamProxyUrl = null) {
    try {
        const baseConfig = getConfig('psiphon.config');

        if (baseConfig) {
            const psiphonConfig = mergeConfigOverlay(baseConfig);

            const upstreamSettings = getUpstreamProxySettings();
            const upstreamValidation = validateUpstreamProxySettings(upstreamSettings);
            if (!upstreamValidation.valid) {
                notifyUser(upstreamValidation.message);
                return false;
            }

            const transportSettings = getTransportSettings();
            const transportValidation = validateTransportSettings(
                transportSettings,
                psiphonConfig,
                userBackendBinaryPath
            );
            if (!transportValidation.valid) {
                notifyUser(transportValidation.message);
                return false;
            }

            const region = (country || '').trim();
            const skipRegionForCdn = transportSettings.protocolSelection === PROTOCOL_SELECTION.cdnFronting;
            if (region && !skipRegionForCdn) {
                psiphonConfig.EgressRegion = region;
            } else {
                delete psiphonConfig.EgressRegion;
            }

            const upstreamUrl = buildUpstreamProxyURL(upstreamSettings);
            if (upstreamUrl) {
                psiphonConfig.UpstreamProxyURL = upstreamUrl;
            } else {
                delete psiphonConfig.UpstreamProxyURL;
            }

            applyTransportSettings(psiphonConfig, transportSettings, userBackendBinaryPath);
            delete psiphonConfig._transportBackendProfile;

            if (upstreamProxyUrl) {
                psiphonConfig.UpstreamProxyUrl = upstreamProxyUrl;
            } else {
                delete psiphonConfig.UpstreamProxyUrl;
            }

            const newPsiphonConfig = JSON.stringify(psiphonConfig, null, 2);

            writeFile(getConfigPath('psiphon.config'), newPsiphonConfig);
            return true;
        } else {
            return false;
        }
    } catch (e) {
        // Display an alert in case of an error
        notifyUser('Failed to save the file! Error: ' + e.message);
        return false;
    }
}

// Function to get start and stop script for changing browser settings
function getScript(name, scriptType) {
    try {
        const browserConfig = getMergedBrowserConfig();
        const browser = browserConfig.find(b => b.name === name);
        if (!browser) {
            throw new Error(`Browser "${name}" is not configured.`);
        }
        if (browser.scriptLocation == "interScript") {
            return `${scriptPath}/${browser[scriptType]}`;
        }
        return browser[scriptType];
    } catch (e) {
        notifyUser("An error occurred while loading the browser configuration. " + e.message);
        return null;
    }
}

// Function to checks if the backend binary and configuration exist in the user dir
function initBackend() {
    createUserConfigFolder();

    try {
        const appBackendVersionConfigPath = getDefaultFile('backendVersion.config');
        const appBackendBinaryPath = getDefaultFile('psiphon-tunnel-core-x86_64');

        const userBackendVersionConfigPath = path.join(userConfigDir, 'backendVersion.config');

        if (fs.existsSync(userBackendBinaryPath) && fs.existsSync(userBackendVersionConfigPath)) {
            const defaultBackendVersionConfig = JSON.parse(readFile(appBackendVersionConfigPath));
            const usrBackendVersionConfig = JSON.parse(readFile(userBackendVersionConfigPath));

            if (isDateNewer(defaultBackendVersionConfig.date, usrBackendVersionConfig.date)) {
                copyFile(appBackendVersionConfigPath, userBackendVersionConfigPath);
                copyFile(appBackendBinaryPath, userBackendBinaryPath);
            }
        } else {
            copyFile(appBackendVersionConfigPath, userBackendVersionConfigPath);
            copyFile(appBackendBinaryPath, userBackendBinaryPath);
        }

        probeBackendCapabilities(userBackendBinaryPath);
        return true;
    } catch (e) {
        notifyUser(
            'Failed to load the configuration file.\n\n' +
            'Either no default configuration was defined for this config file, ' +
            'or the default configuration file could not be found.\n\n' +
            'The installation may be corrupted.\n\n' +
            `Details: ${e.message || e}`
        );
        return false;
    }
}

// Function to get the App version
async function getAppVersion() {
    const ipc = getIpcRenderer();
    if (!ipc) return '0.0.0';
    return await ipc.invoke("get-version");
}

// Function to get GUI update info
async function getGUIUpdateInfo() {
    try {
        const currentVersion = await getAppVersion();
        const response = await fetch(GUI_RELEASES_API);
        const data = await response.json();
        const latestVersion = data.tag_name.replace(/^v/, '');

        const hasUpdate = isNewerVersion(latestVersion, currentVersion);

        return { currentVersion, latestVersion, hasUpdate }
    } catch {
        return null;
    }
}

// Function to check if is latest version number newer then the current version number
function isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    for (let i = 0; i < latestParts.length; i++) {
        if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
        if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
    }
    return false;
}

// Function to get the latest backend update
async function getLatestBackendUpdate() {
    try {
        const response = await fetch(BACKEND_COMMITS_API);
        const data = await response.json();
        const sha = data[0].sha.substring(0, 7);
        const date = data[0].commit.author.date;

        return { sha, date };
    } catch {
        return null;
    }
}

// Function to check is a backend update available
async function checkBackendUpdate() {
    try {
        const latestVersion = await getLatestBackendUpdate();
        const localVersion = getConfig('backendVersion.config');

        const hasUpdate = localVersion.sha !== latestVersion.sha || isDateNewer(localVersion.date, latestVersion.date);

        return { latestVersion, hasUpdate };
    } catch {
        return null;
    }
};

// Function to check if is default date newer then the current user date
function isDateNewer(defaultDate, userDate) {
    const defaultTime = new Date(defaultDate).getTime();
    const userTime = new Date(userDate).getTime();
    return defaultTime > userTime;
}

// Function to download the new binary
function downloadBinary(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        function doGet(targetUrl) {
            https.get(targetUrl, res => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return doGet(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
                }

                const totalStr = res.headers['content-length'];
                const total = totalStr ? parseInt(totalStr, 10) : null;
                let received = 0;

                const tmpPath = dest + '.tmp';
                const file = fs.createWriteStream(tmpPath);

                res.on('data', chunk => {
                    received += chunk.length;
                    if (total && onProgress) {
                        onProgress(Math.round((received / total) * 100));
                    }
                });

                res.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        fs.renameSync(tmpPath, dest);
                        fs.chmodSync(dest, '755');
                        resolve();
                    });
                });
                file.on('error', err => {
                    fs.unlink(tmpPath, () => { });
                    reject(err);
                });
            }).on('error', reject);
        }

        doGet(url);
    });
}

// Function to update the backend 
async function updateBackend(onProgress) {
    try {
        await downloadBinary(BACKEND_BINARY_URL, userBackendBinaryPath, onProgress);

        const localBackendVersionConfig = getConfig('backendVersion.config');
        const latestVersion = await getLatestBackendUpdate();

        localBackendVersionConfig.sha = latestVersion.sha;
        localBackendVersionConfig.date = latestVersion.date;

        const newBackendVersionConfig = JSON.stringify(localBackendVersionConfig, null, 2);

        writeFileSafe(getConfigPath('backendVersion.config'), newBackendVersionConfig);
    } catch (e) {
        throw e;
    }
}

module.exports = {
    buildUpstreamProxyURL,
    checkBackendUpdate,
    createBrowserList,
    createPsiphonConfig,
    fileUrlFromPath,
    getUpstreamProxySettings,
    validateUpstreamProxySettings,
    getAppVersion,
    UPSTREAM_PROXY_STORAGE_KEYS,
    TRANSPORT_STORAGE_KEYS,
    PROTOCOL_SELECTION,
    CONDUIT_MODE,
    CONDUIT_BLOCKED_MESSAGE,
    getTransportSettings,
    conduitDistributorReadiness,
    transportSelectionLabel,
    probeBackendCapabilities,
    getCdnFrontingModeHint,
    getConnectionTimeoutMs,
    getConfig,
    getConfigPath,
    getDefaultBrowserConfig,
    getGUIUpdateInfo,
    getScript,
    initBackend,
    updateBackend,
    writeFileSafe,
    appBackendDir,
    iconsDir,
    imagesDir,
};