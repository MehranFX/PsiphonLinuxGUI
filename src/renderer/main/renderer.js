// Import required modules from Electron and Node.js
const { ipcRenderer } = require('electron');
const path = require('path');
const {
    createBrowserList,
    createPsiphonConfig,
    fileUrlFromPath,
    getGUIUpdateInfo,
    getTransportSettings,
    transportSelectionLabel,
    getConnectionTimeoutMs,
    initBackend,
    iconsDir,
} = require('../../util');
const { getLocale, setLocale, applyI18n, t } = require('./i18n');

// Define the states the application can be in
const states = ['STOPPED', 'STARTING', 'STARTED'];

// Define an array of checkboxes with their properties
let checkboxes = [];

// Array to hold proxy settings changes
let changeProxySettings = [];

// Track the current state of the application and proxy changes
let currentStateIndex = 0;
let isProxySettingsChanging = false;
let isProxyServerRunning = false;
let isPortFree = true;
let proxyStartTimeout;
let liveLogLines = [];
let tunnelStatus = { protocol: '', serverRegion: '' };
let connectionTimerId = null;
let connectionStartedAt = 0;

localStorage.setItem("currentStateIndex", currentStateIndex); // Save initial state to localStorage

// Function to move to the next state in the application
function nextState() {
    currentStateIndex = (currentStateIndex + 1) % states.length; // Cycle through states

    localStorage.setItem("currentStateIndex", currentStateIndex);// Save current state to localStorage

    switch (currentStateIndex) {
        case 0: // STOPPED state
            ipcRenderer.send('shutdown'); // Notify main process to stop
            ipcRenderer.send('restore-settings'); // Restore original settings
            isProxySettingsChanging = false; // Reset flag
            clearTimeout(proxyStartTimeout); // Clear any existing timeouts
            showProxyWarningText(false);
            updateIpInfo('---', '---', null, '---');
            tunnelStatus = { protocol: '', serverRegion: '' };
            updateTunnelStatusDisplay();
            break;
        case 1: // STARTING state
            tunnelStatus = { protocol: '', serverRegion: '' };
            updateTunnelStatusDisplay();
            const country = document.getElementById('customSelect').getAttribute("data-value");
            if (localStorage.getItem("country") == "true") {
                localStorage.setItem("latestCountry", country);
            }

            // Create config based on the selected country and inti the backend
            const isBackendInit = initBackend();
            if (createPsiphonConfig(country) && isBackendInit) {
                isPortFree = true;
                updateIpInfo('Loading...', null, null, null);
                ipcRenderer.send('start-vpn-proxy-server'); // Start the VPN/proxy server

                isProxySettingsChanging = true;

                proxyStartTimeout = setTimeout(() => {
                    if (!isProxyServerRunning) {
                        const warning = document.getElementById('proxyWarning');
                        if (warning) {
                            warning.textContent = `${t('warning.server')} ${t('warning.server.hint')}`;
                        }
                        showProxyWarning();
                    }
                }, getConnectionTimeoutMs(getTransportSettings()));
            } else {
                currentStateIndex = -1;
                nextState();
            }
            break;
        case 2: // STARTED state
            syncChangeProxySettingsFromUI();
            if (changeProxySettings.length > 0) {
                ipcRenderer.send('change-proxy-setting', changeProxySettings);
                isProxySettingsChanging = true;
            }
            fetchIPInfo();
            if (localStorage.getItem("info") == "true") {
                showProxyWarningText(changeProxySettings.length == 0);
            }
            if (!isProxyServerRunning) {
                nextState();
            }
            break;
        default:
            break;
    }
    updateStateDisplay(); // Update UI at the end
    updatePowerButton();
    updateIcon();
    hideProxyWarning();
}

// Listener for handling proxy setting errors
ipcRenderer.on('proxy-setting-error', (event, changeProxySetting) => {
    changeProxySettings.splice(changeProxySettings.indexOf(changeProxySetting), 1); // Remove the failed setting
    if (currentStateIndex == 2) ipcRenderer.send('restore-setting', [changeProxySetting]); // Restore settings if in STARTED state
    // Update the checkbox status in the UI
    const htmlCheckboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        if (checkbox.name == changeProxySetting) {
            checkbox.checked = false;
            htmlCheckboxes.forEach(htmlcheckbox => {
                if (htmlcheckbox.id == checkbox.id) {
                    htmlcheckbox.checked = false;
                }
            });
        }
    });

    alert(`${changeProxySetting} is not installed`);
    if (localStorage.getItem("info") == "true") {
        showProxyWarningText(changeProxySettings.length == 0);
    }
});

// Listener for handling server errors
ipcRenderer.on('server-error', (event, err) => {
    nextState();
    alert(`Failed to execute psiphon-tunnel-core-x86_64. The file is not executable. ${err.toString()}`);
});

// Listener for handling proxy watch responses
ipcRenderer.on('proxy-watch', (event, response) => {
    const res = response.toString();
    const warningEl = document.getElementById('proxyWarning');

    if (res === "HTTP:OK" && !isProxyServerRunning) {
        clearTimeout(proxyStartTimeout);
        isProxyServerRunning = true;
        isProxySettingsChanging = false;
        nextState();
    } else if (res != "HTTP:OK" && isProxyServerRunning && currentStateIndex != 0 && isPortFree) {
        isProxyServerRunning = false;
        currentStateIndex = 0;
        nextState();
    }

    if (!warningEl) {
        return;
    }

    if (currentStateIndex === 1 && !isProxyServerRunning) {
        warningEl.textContent = res === 'DEVICE:DOWN' ? t('warning.network') : t('connect.hint.starting');
        return;
    }

    warningEl.textContent = res === 'HTTP:DOWN' ? t('warning.server') : t('warning.network');
});

ipcRenderer.on('tunnel-status', (_event, status) => {
    tunnelStatus = {
        protocol: status?.protocol || '',
        serverRegion: status?.serverRegion || '',
    };
    updateTunnelStatusDisplay();
});

// Listener for handling port errors
ipcRenderer.on('port-error', (event, err) => {
    isPortFree = false;
    isProxyServerRunning = false;
    clearTimeout(proxyStartTimeout);
    currentStateIndex = -1;
    nextState();
    alert(`${err.toString()}`);
});

// Function to show the proxy warning
function showProxyWarning() {
    const warning = document.getElementById("proxyWarning");
    if (warning) {
        warning.classList.remove("hidden");
        ipcRenderer.send('set-attention'); // Notify main process to set attention
    }
}

// Function to hide the proxy warning
function hideProxyWarning() {
    const warning = document.getElementById("proxyWarning");
    if (warning) {
        warning.classList.add("hidden");
    }
}


if (localStorage.getItem("country") == "true") {
    // restored after i18n in restoreCountrySelection()
}

function getCountryOption(value) {
    return document.querySelector(`#customOptions div[data-value="${value}"]`);
}

function getLocationIconMarkup(value, optionEl) {
    if (!value) {
        return '<i class="fa-solid fa-rocket fastest-icon"></i>';
    }
    const flag = optionEl ? optionEl.querySelector('.fi') : null;
    if (flag) {
        return `<span class="${flag.className}"></span>`;
    }
    return '<i class="fa-solid fa-rocket fastest-icon"></i>';
}

function getLocationLabel(value, optionEl) {
    if (!value) {
        return t('location.fastest');
    }
    const label = optionEl ? optionEl.querySelector('.option-label') : null;
    return label ? label.textContent.trim() : value;
}

function setLocationDisplay(value) {
    const customSelect = document.getElementById('customSelect');
    const optionEl = getCountryOption(value);
    customSelect.setAttribute('data-value', value);
    document.getElementById('locationFlag').innerHTML = getLocationIconMarkup(value, optionEl);
    document.getElementById('locationName').textContent = getLocationLabel(value, optionEl);
    syncCountryListSelection();
}

function syncCountryListSelection() {
    const customSelect = document.getElementById('customSelect');
    const value = customSelect?.getAttribute('data-value') ?? '';
    const options = document.querySelectorAll('#customOptions div');

    options.forEach((option) => {
        const isSelected = option.getAttribute('data-value') === value;
        option.classList.toggle('selected', isSelected);
        option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    return getCountryOption(value);
}

function scrollCountryListToSelection() {
    const selectedEl = syncCountryListSelection();
    if (!selectedEl) {
        return;
    }
    requestAnimationFrame(() => {
        selectedEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
}

function setCountryListOpen(open) {
    const wrapper = document.getElementById('countrySelectWrapper');
    if (!wrapper) {
        return;
    }
    wrapper.classList.toggle('open', open);
    if (open) {
        scrollCountryListToSelection();
    }
}

function restoreCountrySelection() {
    if (localStorage.getItem("country") != "true") {
        setLocationDisplay('');
        return;
    }
    const saved = localStorage.getItem("latestCountry");
    if (saved !== null && getCountryOption(saved)) {
        setLocationDisplay(saved);
    } else {
        setLocationDisplay('');
    }
}

// Function to change the country setting and reset the state if needed
function changeCountry() {
    if (currentStateIndex == 1 || currentStateIndex == 2) {
        currentStateIndex = 0; // Reset state to STOPPED
        ipcRenderer.send('shutdown'); // Notify main process to stop
        updateIcon(); // Update icon
        nextState(); // Proceed to next state
    }
}

// Function to update connection status UI
function updateStateDisplay() {
    const state = states[currentStateIndex];
    document.getElementById('currentState').textContent = state;

    const statusLabel = document.getElementById('statusLabel');
    const statusHint = document.getElementById('statusHint');
    const stateClass = state === 'STARTED' ? 'state-started' : (state === 'STARTING' ? 'state-starting' : 'state-stopped');

    statusLabel.className = `status-label ${stateClass}`;
    statusLabel.textContent = state === 'STARTED' ? t('status.started') : (state === 'STARTING' ? t('status.starting') : t('status.stopped'));

    statusHint.textContent = state === 'STARTED' ? t('connect.hint.started') : (state === 'STARTING' ? t('connect.hint.starting') : t('connect.hint'));

    updateConnectIpVisibility();
    updateTunnelStatusDisplay();
}

function updateTunnelStatusDisplay() {
    const transport = transportSelectionLabel(getTransportSettings().protocolSelection);
    const protocol = tunnelStatus.protocol || '—';
    const region = tunnelStatus.serverRegion || '—';
    const isActive = currentStateIndex === 1 || currentStateIndex === 2;
    const protocolText = (currentStateIndex === 1 && !tunnelStatus.protocol)
        ? t('connection.protocol.pending')
        : protocol;

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('tunnel-transport-mode', transport);
    setText('tunnel-protocol', isActive ? protocolText : '—');
    setText('tunnel-server-region', isActive && tunnelStatus.serverRegion ? region : '—');
    setText('connectTunnelProtocol', isActive ? protocolText : '—');
    setText('connectTunnelRegion', isActive && tunnelStatus.serverRegion ? region : '—');

    const meta = document.getElementById('connectTunnelMeta');
    if (meta) {
        meta.classList.toggle('hidden', !isActive);
    }
}

function updateConnectIpVisibility() {
    const wrap = document.getElementById('connectIpDisplay');
    if (!wrap) return;

    if (currentStateIndex === 1 || currentStateIndex === 2) {
        wrap.hidden = false;
    } else {
        wrap.hidden = true;
    }
}

function formatConnectionDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateConnectTimerDisplay() {
    const el = document.getElementById('connectTimer');
    if (!el || !connectionStartedAt) {
        return;
    }
    el.textContent = formatConnectionDuration(Date.now() - connectionStartedAt);
    const btn = document.getElementById('nextStateButton');
    if (btn && states[currentStateIndex] === 'STARTED') {
        btn.setAttribute('aria-label', `${t('btn.disconnect')} — ${el.textContent}`);
    }
}

function startConnectionTimer() {
    if (connectionTimerId) {
        return;
    }
    connectionStartedAt = Date.now();
    const el = document.getElementById('connectTimer');
    if (el) {
        el.classList.remove('hidden');
        updateConnectTimerDisplay();
    }
    connectionTimerId = setInterval(updateConnectTimerDisplay, 1000);
}

function stopConnectionTimer() {
    if (connectionTimerId) {
        clearInterval(connectionTimerId);
        connectionTimerId = null;
    }
    connectionStartedAt = 0;
    const el = document.getElementById('connectTimer');
    if (el) {
        el.classList.add('hidden');
        el.textContent = '00:00';
    }
}

function syncConnectionTimer(state) {
    if (state === 'STARTED') {
        startConnectionTimer();
    } else {
        stopConnectionTimer();
    }
}

function updatePowerButton() {
    const btn = document.getElementById('nextStateButton');
    const state = states[currentStateIndex];
    const glow = document.getElementById('powerGlow');
    const ring = document.getElementById('powerRing');
    const radiate = document.getElementById('powerRadiate');

    btn.className = 'power-btn ' + (state === 'STARTED' ? 'state-started' : (state === 'STARTING' ? 'state-starting' : 'state-stopped'));
    btn.classList.toggle('has-timer', state === 'STARTED');
    glow.className = 'power-glow ' + (state === 'STARTED' ? 'state-started' : (state === 'STARTING' ? 'state-starting' : ''));
    ring.classList.toggle('pulse', false);
    if (radiate) {
        radiate.classList.toggle('active', state === 'STARTING');
    }

    syncConnectionTimer(state);

    const label = state === 'STARTED' ? t('btn.disconnect') : (state === 'STARTING' ? t('btn.stop') : t('btn.connect'));
    document.getElementById('Button').textContent = label;
    if (state === 'STARTED' && connectionStartedAt) {
        btn.setAttribute('aria-label', `${label} — ${formatConnectionDuration(Date.now() - connectionStartedAt)}`);
    } else {
        btn.setAttribute('aria-label', label);
    }
}

// Function to update the icon
function updateIcon() {
    if (currentStateIndex != 2) {
        document.getElementById('icon').setAttribute("src", fileUrlFromPath(path.join(iconsDir, 'psiphonlinuxgui-off.png')));
    } else if (currentStateIndex == 2) {
        document.getElementById('icon').setAttribute("src", fileUrlFromPath(path.join(iconsDir, 'psiphonlinuxgui.png')));
    }
}

// Function to open the setting page
function openSettingsPage() {
    ipcRenderer.send('open-settings-page')
}

// Event listener for the button to switch states
document.getElementById('nextStateButton').addEventListener('click', nextState);

// Event listener for the button to open the setting page
document.getElementById('settingsBtn').addEventListener('click', openSettingsPage);

let windowHeightFitFrame = 0;

function scheduleWindowHeightFit() {
    cancelAnimationFrame(windowHeightFitFrame);
    windowHeightFitFrame = requestAnimationFrame(() => {
        const app = document.querySelector('.app');
        if (!app) {
            return;
        }
        const height = Math.ceil(app.getBoundingClientRect().height);
        ipcRenderer.send('fit-window-height', height);
    });
}

function initWindowHeightFit() {
    const app = document.querySelector('.app');
    if (!app) {
        return;
    }

    const observer = new ResizeObserver(scheduleWindowHeightFit);
    observer.observe(app);
    scheduleWindowHeightFit();
}

// Initial UI update
initPanels();
initLocale();
initLiveLog();
initSystemProxyToggle();
restoreCountrySelection();
initCountrySelect();
initBanner();
initWindowHeightFit();
updateStateDisplay();
updateTunnelStatusDisplay();
updatePowerButton();
updateIcon();

// Function to get the status of a checkbox by its ID
function getCheckboxStatus(id) {
    return document.getElementById(id).checked; // Return the checked state of the checkbox
}

// Function to sync enabled browsers from UI toggles
function syncChangeProxySettingsFromUI() {
    changeProxySettings = checkboxes
        .filter((checkbox) => getCheckboxStatus(checkbox.id))
        .map((checkbox) => checkbox.name);
}

// Function to update the proxy settings array based on checkbox changes
function updateProxySettings(name, checked) {
    const proxySetting = `${name}`;

    if (checked && !changeProxySettings.includes(proxySetting)) {
        changeProxySettings.push(proxySetting);
    }

    if (isProxySettingsChanging) {
        isProxySettingsChanging = false;
    }
}

// Function to check the status of all checkboxes and update settings
function checkCheckboxStatus() {
    checkboxes.forEach(checkbox => {
        let newChecked = getCheckboxStatus(checkbox.id);

        if (localStorage.getItem("browserScrips") == "true") {
            localStorage.setItem(checkbox.name, newChecked);
        }

        if (!newChecked && checkbox.checked) {
            // Remove unchecked proxy setting if previously checked
            changeProxySettings.splice(changeProxySettings.indexOf(checkbox.name), 1);
            if (currentStateIndex == 2) ipcRenderer.send('restore-setting', [checkbox.name]); // Restore settings if in STARTED state
            checkbox.checked = newChecked;
        } else if (newChecked !== checkbox.checked) {
            checkbox.checked = newChecked;
            updateProxySettings(checkbox.name, newChecked);
            if (currentStateIndex === 2 && newChecked) {
                syncChangeProxySettingsFromUI();
                ipcRenderer.send('change-proxy-setting', changeProxySettings);
            }
        }
    });

    if (currentStateIndex === 2 && localStorage.getItem("info") == "true") {
        showProxyWarningText(changeProxySettings.length === 0);
    }
}

// Listener for handling refresh theme
ipcRenderer.on('refresh-theme', () => {
    const savedTheme = localStorage.getItem("theme");
    setTheme(savedTheme);
});

// Function to set the theme based on a saved value
function setTheme(theme) {
    document.body.classList.remove("light", "dark", "auto");
    document.body.classList.add((theme == 1 ? "light" : (theme == 2 ? "dark" : "auto")));
}

// Load the saved theme from localStorage
const savedTheme = localStorage.getItem("theme");
setTheme(savedTheme);

// Initial call to create browserList
createBrowserList(document.getElementById('browserList'), createBrowserListItem);

// Listener for handling refresh browser list
ipcRenderer.on('refresh-browser-list', () => {
    checkboxes.forEach(checkbox => {
        document.getElementById(checkbox.id).removeEventListener('click', checkCheckboxStatus);
    });
    changeProxySettings = [];
    checkboxes = [];
    createBrowserList(document.getElementById('browserList'), createBrowserListItem);
    addEventListener();
});

// Listener for handling refresh info text
ipcRenderer.on('refresh-info-text', () => {
    changeInfoText();
});

// Function to change info text
function changeInfoText() {
    const ipInfo = document.getElementById('ip-info');
    if (!ipInfo) return;

    if (localStorage.getItem("info") == "true") {
        ipInfo.style.display = 'block';
        if (currentStateIndex == 2) {
            fetchIPInfo();
            showProxyWarningText(changeProxySettings.length == 0);
        }
    } else {
        ipInfo.style.display = 'none';
        showProxyWarningText(false);
    }
}
changeInfoText();

function scrollLiveLogToBottom() {
    const container = document.getElementById('liveLogContainer');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function renderLiveLog() {
    const el = document.getElementById('liveLog');
    if (!el) return;

    if (liveLogLines.length === 0) {
        el.textContent = t('log.empty');
        return;
    }

    el.textContent = liveLogLines.join('\n');
    scrollLiveLogToBottom();
    if (document.getElementById('connectionPanel')?.classList.contains('log-open')) {
        updateConnectionLogOverlayLayout();
    }
}

function appendLiveLogLine(line) {
    liveLogLines.push(line);
    if (liveLogLines.length > 400) {
        liveLogLines.shift();
    }
    renderLiveLog();
}

function requestLogBuffer() {
    ipcRenderer.send('get-log-buffer');
}

function initLiveLog() {
    ipcRenderer.on('app-log', (_event, line) => {
        appendLiveLogLine(line);
    });

    ipcRenderer.on('log-buffer', (_event, lines) => {
        liveLogLines = Array.isArray(lines) ? [...lines] : [];
        renderLiveLog();
    });

    renderLiveLog();
}

function initSystemProxyToggle() {
    const toggle = document.getElementById('systemProxyToggle');
    if (!toggle) return;

    const saved = localStorage.getItem('systemProxy') === 'true';
    toggle.checked = saved;

    if (saved) {
        ipcRenderer.invoke('set-system-proxy', true).then((result) => {
            if (!result.ok) {
                toggle.checked = false;
                localStorage.setItem('systemProxy', 'false');
            }
        });
    }

    toggle.addEventListener('change', async () => {
        const enabled = toggle.checked;
        const result = await ipcRenderer.invoke('set-system-proxy', enabled);
        if (!result.ok) {
            toggle.checked = !enabled;
            alert(result.error || t('system.proxy.error'));
            return;
        }
        localStorage.setItem('systemProxy', enabled ? 'true' : 'false');
    });
}

// Create browser toggle rows for installed browsers only
function createBrowserListItem(browserConfig) {
    return browserConfig.map((browser, id) => {
        let iconHTML;
        if (browser.icon.localPath) {
            const iconPath = path.join(__dirname, '../../assets/browserIcons', path.basename(browser.icon.localPath));
            iconHTML = `<img class="browser-icon-img" src="${fileUrlFromPath(iconPath)}" alt="${browser.name}">`;
        } else {
            iconHTML = `<i class="${browser.icon.css} browser-fa-icon"></i>`;
        }

        id += 1;
        checkboxes.push({ id: `${id}`, name: browser.name, checked: false });

        return `
            <div class="browser-item">
              <div class="browser-info">${iconHTML}<span>${browser.name}</span></div>
              <label class="toggle">
                <input type="checkbox" id="${id}">
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>`;
    }).join('');
}

function updateConnectionLogOverlayLayout() {
    const panel = document.getElementById('connectionPanel');
    const body = document.getElementById('connectionPanelBody');
    const toggle = document.getElementById('connectionPanelToggle');
    const content = document.querySelector('.content');
    const backdrop = document.getElementById('logOverlayBackdrop');

    if (!panel || !body || !toggle || !content) {
        return;
    }

    if (!panel.classList.contains('log-open')) {
        body.style.top = '';
        body.style.bottom = '';
        if (backdrop) {
            backdrop.classList.remove('visible');
            backdrop.classList.add('hidden');
            backdrop.setAttribute('aria-hidden', 'true');
        }
        return;
    }

    const toggleRect = toggle.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const gap = 8;

    body.style.top = `${toggleRect.bottom + gap}px`;
    body.style.bottom = `${window.innerHeight - contentRect.bottom + gap}px`;

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => backdrop.classList.add('visible'));
    }
}

function setConnectionLogOpen(open) {
    const panel = document.getElementById('connectionPanel');
    const btn = document.getElementById('connectionPanelToggle');
    const panelBody = document.getElementById('connectionPanelBody');
    if (!btn || !panelBody || !panel) {
        return;
    }

    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panelBody.classList.toggle('collapsed', !open);
    panel.classList.toggle('log-open', open);
    updateConnectionLogOverlayLayout();

    if (open) {
        requestLogBuffer();
        scrollLiveLogToBottom();
    }
}

function initPanels() {
    const browserPanel = {
        toggle: 'browserPanelToggle',
        body: 'browserPanelBody',
        defaultOpen: false,
    };

    const connectionBtn = document.getElementById('connectionPanelToggle');
    const connectionBody = document.getElementById('connectionPanelBody');
    const backdrop = document.getElementById('logOverlayBackdrop');

    if (connectionBtn && connectionBody) {
        connectionBtn.setAttribute('aria-expanded', 'false');
        connectionBody.classList.add('collapsed');

        connectionBtn.addEventListener('click', () => {
            const open = connectionBtn.getAttribute('aria-expanded') !== 'true';
            setConnectionLogOpen(open);
        });

        backdrop?.addEventListener('click', () => setConnectionLogOpen(false));
        window.addEventListener('resize', updateConnectionLogOverlayLayout);
    }

    const btn = document.getElementById(browserPanel.toggle);
    const panelBody = document.getElementById(browserPanel.body);
    if (btn && panelBody) {
        btn.setAttribute('aria-expanded', browserPanel.defaultOpen ? 'true' : 'false');
        panelBody.classList.toggle('collapsed', !browserPanel.defaultOpen);

        btn.addEventListener('click', () => {
            const open = btn.getAttribute('aria-expanded') !== 'true';
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            panelBody.classList.toggle('collapsed', !open);
        });
    }
}

function initLocale() {
    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
        langSelect.value = getLocale();
        langSelect.addEventListener('change', () => {
            setLocale(langSelect.value);
            restoreCountrySelection();
            updateStateDisplay();
            updatePowerButton();
            if (typeof renderLiveLog === 'function' && liveLogLines.length === 0) {
                renderLiveLog();
            }
            updateTunnelStatusDisplay();
        });
    }
    applyI18n();
}

function initCountrySelect() {
    const wrapper = document.getElementById('countrySelectWrapper');
    const customSelect = document.getElementById('customSelect');

    customSelect.addEventListener('click', () => {
        setCountryListOpen(!wrapper.classList.contains('open'));
    });

    document.getElementById('toggleButton').addEventListener('click', (e) => {
        e.stopPropagation();
        setCountryListOpen(!wrapper.classList.contains('open'));
    });

    document.querySelectorAll('#customOptions div').forEach((option) => {
        option.setAttribute('role', 'option');
        option.addEventListener('click', function () {
            const value = this.getAttribute('data-value');
            setLocationDisplay(value);
            setCountryListOpen(false);
            changeCountry();
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select-wrapper')) {
            setCountryListOpen(false);
        }
    });

    syncCountryListSelection();
}

function initBanner() {
    const notifyBtn = document.getElementById('notifyBtn');
    const banner = document.getElementById('updateBanner');
    const closeBtn = document.getElementById('closeBanner');

    notifyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        banner.classList.toggle('show');
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        banner.classList.remove('show');
    });

    document.addEventListener('click', (e) => {
        if (!banner.contains(e.target) && !notifyBtn.contains(e.target)) {
            banner.classList.remove('show');
        }
    });
}

// Initial call to add EventListener
addEventListener();

// Add event listeners to each checkbox for status checking
function addEventListener() {
    checkboxes.forEach(checkbox => {
        if (localStorage.getItem("browserScrips") == "true") {
            document.getElementById(checkbox.id).checked = localStorage.getItem(checkbox.name) == "true" ? true : false;
        }
        document.getElementById(checkbox.id).addEventListener('click', checkCheckboxStatus);
    });
}

// Initial call to set up checkbox status
checkCheckboxStatus();

// Run update check on startup
checkForUpdate();

// Function to check if a new version of the app is available on GitHub
async function checkForUpdate() {
    const result = await getGUIUpdateInfo();
    if (result.hasUpdate) {
        notifyBtn.style.display = "inline";
        bannerText.textContent = `Version ${result.latestVersion} of PsiphonLinuxGUI is available!`;
    } else {
        notifyBtn.style.display = "none";
    }
}

// Listener for handling ip info
ipcRenderer.on('ip-info-result', (event, { ip, country, countryCode, city }) => {
    updateIpInfo(ip, country, countryCode, city);
});

// Function to get IP info
function fetchIPInfo() {
    ipcRenderer.send('fetch-ip-info');
}

function updateIpInfo(ip, country, countryCode, city) {
    document.getElementById('current-ip').textContent = ip || '—';
    document.getElementById('current-country').textContent = country || '—';
    document.getElementById('current-city').textContent = city || '—';

    const ipEl = document.getElementById('current-ip');
    ipEl.classList.toggle('connected', ip && ip !== '—' && ip !== 'Loading...' && ip !== '---');

    const flagIcon = document.getElementById('flag-icon');

    if (countryCode) {
        flagIcon.className = `fi fi-${countryCode.toLowerCase()}`;
        flagIcon.style.display = 'inline-block';
    } else {
        flagIcon.className = '';
        flagIcon.style.display = 'none';
    }

    updateConnectIpDisplay(ip, countryCode);
}

function updateConnectIpDisplay(ip, countryCode) {
    const valueEl = document.getElementById('connectIpValue');
    const flagEl = document.getElementById('connectIpFlag');
    if (!valueEl) return;

    updateConnectIpVisibility();

    if (currentStateIndex === 0) {
        return;
    }

    valueEl.classList.remove('connected', 'loading');

    if (currentStateIndex === 1 || ip === 'Loading...') {
        valueEl.textContent = t('ip.loading');
        valueEl.classList.add('loading');
        if (flagEl) flagEl.style.display = 'none';
        return;
    }

    if (!ip || ip === '---') {
        valueEl.textContent = '—';
        if (flagEl) flagEl.style.display = 'none';
        return;
    }

    valueEl.textContent = ip;
    valueEl.classList.add('connected');

    if (flagEl && countryCode) {
        flagEl.className = `fi fi-${countryCode.toLowerCase()} connect-ip-flag`;
        flagEl.style.display = 'inline-block';
    } else if (flagEl) {
        flagEl.style.display = 'none';
    }
}

// Display a warning box if NO app proxy setting is active
function showProxyWarningText(show) {
    document.getElementById('proxy-warning-box').style.display = show ? 'block' : 'none';
}

// Modal open
document.getElementById('btn-show-manual-instructions').addEventListener('click', () => {
    document.getElementById('manual-proxy-modal').style.display = 'flex';
});

// Modal close
document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('manual-proxy-modal').style.display = 'none';
});

// Optional: Clicking the overlay closes the modal
document.getElementById('manual-proxy-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.style.display = 'none';
    }
});
