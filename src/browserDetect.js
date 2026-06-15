const { execSync } = require('child_process');

function shellOk(cmd) {
    try {
        execSync(cmd, { stdio: 'pipe', shell: '/bin/bash' });
        return true;
    } catch {
        return false;
    }
}

function commandExists(cmd) {
    return shellOk(`command -v ${cmd}`);
}

function snapInstalled(name) {
    return shellOk(`snap list 2>/dev/null | awk '{print $1}' | grep -qx '${name}'`);
}

function flatpakInstalled(appId) {
    return shellOk(`flatpak info ${appId} >/dev/null 2>&1`);
}

function hasMozillaProfiles(...searchRoots) {
    for (const root of searchRoots) {
        if (shellOk(`find ${root} -maxdepth 2 -type d \\( -name "*.default*" -o -name "*Default*" \\) 2>/dev/null | grep -q .`)) {
            return true;
        }
    }
    return false;
}

const INSTALL_CHECKS = {
    Firefox: () =>
        commandExists('firefox') ||
        commandExists('firefox-esr') ||
        hasMozillaProfiles(
            '~/.mozilla/firefox',
            '~/.config/mozilla/firefox',
            '~/snap/firefox/common/.mozilla/firefox',
            '~/.var/app/org.mozilla.firefox/.mozilla/firefox'
        ) ||
        flatpakInstalled('org.mozilla.firefox') ||
        snapInstalled('firefox'),

    'Google Chrome': () =>
        commandExists('google-chrome-stable') ||
        commandExists('google-chrome') ||
        flatpakInstalled('com.google.Chrome'),

    Chromium: () =>
        commandExists('chromium') ||
        commandExists('chromium-browser') ||
        flatpakInstalled('org.chromium.Chromium') ||
        snapInstalled('chromium'),

    Opera: () =>
        commandExists('opera') ||
        flatpakInstalled('com.opera.Opera') ||
        snapInstalled('opera'),

    Brave: () =>
        commandExists('brave') ||
        commandExists('brave-browser') ||
        flatpakInstalled('com.brave.Browser') ||
        snapInstalled('brave'),

    'Microsoft Edge': () =>
        commandExists('microsoft-edge-stable') ||
        commandExists('microsoft-edge') ||
        commandExists('msedge') ||
        flatpakInstalled('com.microsoft.Edge') ||
        snapInstalled('edge'),

    Vivaldi: () =>
        commandExists('vivaldi') ||
        commandExists('vivaldi-stable') ||
        flatpakInstalled('com.vivaldi.Vivaldi'),

    'Zen Browser': () =>
        commandExists('zen') ||
        commandExists('zen-browser') ||
        flatpakInstalled('app.zen_browser.zen') ||
        hasMozillaProfiles('~/.var/app/app.zen_browser.zen/.zen', '~/.zen'),

    LibreWolf: () =>
        commandExists('librewolf') ||
        flatpakInstalled('io.gitlab.librewolf-community') ||
        hasMozillaProfiles(
            '~/.var/app/io.gitlab.librewolf-community/.librewolf',
            '~/.librewolf'
        ),
};

function isBrowserInstalled(name) {
    const check = INSTALL_CHECKS[name];
    return check ? check() : false;
}

function filterInstalledBrowsers(browserConfig) {
    if (!Array.isArray(browserConfig)) {
        return [];
    }
    return browserConfig.filter((browser) => isBrowserInstalled(browser.name));
}

module.exports = {
    isBrowserInstalled,
    filterInstalledBrowsers,
};
