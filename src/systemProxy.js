const { execSync } = require('child_process');

const SCHEMA = 'org.gnome.system.proxy';
const HOST = '127.0.0.1';
const HTTP_PORT = 8081;
const SOCKS_PORT = 1081;

function runGsettings(args) {
    execSync(`gsettings ${args}`, { encoding: 'utf8', stdio: 'pipe' });
}

function isGsettingsAvailable() {
    try {
        execSync('which gsettings', { stdio: 'pipe' });
        execSync(`gsettings list-keys ${SCHEMA}`, { stdio: 'pipe' });
        return true;
    } catch (_) {
        return false;
    }
}

function setSystemProxy() {
    runGsettings(`set ${SCHEMA} mode 'manual'`);
    runGsettings(`set ${SCHEMA}.http host '${HOST}'`);
    runGsettings(`set ${SCHEMA}.http port ${HTTP_PORT}`);
    runGsettings(`set ${SCHEMA}.https host '${HOST}'`);
    runGsettings(`set ${SCHEMA}.https port ${HTTP_PORT}`);
    runGsettings(`set ${SCHEMA}.socks host '${HOST}'`);
    runGsettings(`set ${SCHEMA}.socks port ${SOCKS_PORT}`);
    runGsettings(`set ${SCHEMA} ignore-hosts "['localhost', '127.0.0.1', '::1']"`);
}

function clearSystemProxy() {
    runGsettings(`set ${SCHEMA} mode 'none'`);
}

module.exports = {
    HOST,
    HTTP_PORT,
    SOCKS_PORT,
    setSystemProxy,
    clearSystemProxy,
    isGsettingsAvailable,
};
