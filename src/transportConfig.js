const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const userConfigDir = path.join(os.homedir(), '.config', 'psiphonlinuxgui');
const appConfigDir = path.join(__dirname, 'configs');

const TRANSPORT_STORAGE_KEYS = {
    protocol: 'transportProtocol',
    cdnUseBuiltInScan: 'cdnFrontingUseBuiltInScan',
    cdnCustomIpList: 'cdnFrontingCustomIpList',
    cdnCustomSni: 'cdnFrontingCustomSni',
    conduitMode: 'conduitMode',
    rejectCensoredCountryProxies: 'rejectCensoredCountryProxies',
};

const PROTOCOL_SELECTION = {
    auto: 'auto',
    direct: 'direct',
    cdnFronting: 'cdnFronting',
    conduit: 'conduit',
};

const CONDUIT_MODE = {
    auto: 'auto',
    shiroCommunity: 'shirokhorshid',
    publicOnly: 'public',
};

const CENSORED_COUNTRY_CODES = ['IR', 'CN', 'RU', 'BY', 'TM', 'KP'];

/** Shiro/AzadiTunnel fork — requires shirokhorshid/psiphon-tunnel-core binary. */
const SHIRO_DIRECT_PROTOCOLS = [
    'SSH', 'OSSH', 'TLS-OSSH',
    'UNFRONTED-MEEK-OSSH', 'UNFRONTED-MEEK-HTTPS-OSSH', 'UNFRONTED-MEEK-SESSION-TICKET-OSSH',
    'QUIC-OSSH', 'SHADOWSOCKS-OSSH',
    'FRONTED-MEEK-OSSH', 'FRONTED-MEEK-CDN-OSSH', 'FRONTED-MEEK-HTTP-OSSH',
    'FRONTED-MEEK-CDN-HTTP-OSSH', 'FRONTED-MEEK-QUIC-OSSH', 'FRONTED-MEEK-CDN-QUIC-OSSH',
];

const SHIRO_CDN_FRONTING_PROTOCOLS = [
    'FRONTED-MEEK-CDN-OSSH',
    'FRONTED-MEEK-CDN-HTTP-OSSH',
    'FRONTED-MEEK-CDN-QUIC-OSSH',
];

/** Psiphon-Labs psiphon-tunnel-core-binaries — no FRONTED-MEEK-CDN-* protocol names. */
const LABS_DIRECT_PROTOCOLS = SHIRO_DIRECT_PROTOCOLS.filter((p) => !p.includes('-CDN-'));

const LABS_CDN_FRONTING_PROTOCOLS = [
    'FRONTED-MEEK-OSSH',
    'FRONTED-MEEK-HTTP-OSSH',
    'FRONTED-MEEK-QUIC-OSSH',
];

/** Meek family on Psiphon-Labs — UNFRONTED has far more server entries than FRONTED-only. */
const LABS_CDN_ALL_MEEK_PROTOCOLS = [
    ...LABS_CDN_FRONTING_PROTOCOLS,
    'UNFRONTED-MEEK-OSSH',
    'UNFRONTED-MEEK-HTTPS-OSSH',
    'UNFRONTED-MEEK-SESSION-TICKET-OSSH',
];

const LABS_CDN_INITIAL_CANDIDATE_COUNT = 30;

const SHIRO_CDN_PROTOCOL_PROBE = 'FRONTED-MEEK-CDN-OSSH';
const BACKEND_CAPABILITIES_FILE = 'backendCapabilities.json';

const CONDUIT_PROTOCOLS = [
    'INPROXY-WEBRTC-SSH', 'INPROXY-WEBRTC-OSSH', 'INPROXY-WEBRTC-TLS-OSSH',
    'INPROXY-WEBRTC-UNFRONTED-MEEK-OSSH', 'INPROXY-WEBRTC-UNFRONTED-MEEK-HTTPS-OSSH',
    'INPROXY-WEBRTC-UNFRONTED-MEEK-SESSION-TICKET-OSSH',
    'INPROXY-WEBRTC-FRONTED-MEEK-OSSH', 'INPROXY-WEBRTC-FRONTED-MEEK-HTTP-OSSH',
    'INPROXY-WEBRTC-QUIC-OSSH', 'INPROXY-WEBRTC-FRONTED-MEEK-QUIC-OSSH',
    'INPROXY-WEBRTC-SHADOWSOCKS-OSSH',
];

const BUILT_IN_EDGE_IPS = [
    ['edge-a-1', '23.215.0.206'],
    ['edge-a-2', '23.215.0.203'],
    ['edge-b-1', '23.212.250.91'],
    ['edge-b-2', '23.212.250.78'],
    ['edge-c-1', '23.12.147.13'],
    ['edge-c-2', '23.12.147.29'],
    ['edge-d-1', '23.73.207.8'],
    ['edge-d-2', '23.73.207.15'],
    ['edge-original', '92.123.102.43'],
];

const BUNDLED_COMPARTMENT_KEY = 'ConduitPersonalCompartmentID';
const CONDUIT_BLOCKED_MESSAGE = 'Conduit blocked: missing Psiphon distributor keys (ServerEntrySignaturePublicKey). See psiphon.config.local.json.example.';
const DNS_RESOLVER_ALTERNATE_SERVERS = ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4'];

let cachedBackendCapabilities = null;

function getBackendCapabilitiesPath() {
    return path.join(userConfigDir, BACKEND_CAPABILITIES_FILE);
}

function readCachedBackendCapabilities(binaryPath) {
    const capPath = getBackendCapabilitiesPath();
    if (!fs.existsSync(capPath) || !fs.existsSync(binaryPath)) {
        return null;
    }
    try {
        const cached = JSON.parse(fs.readFileSync(capPath, 'utf-8'));
        const stat = fs.statSync(binaryPath);
        if (cached.binaryMtimeMs === stat.mtimeMs && cached.binarySize === stat.size) {
            return cached;
        }
    } catch (_) { /* re-probe */ }
    return null;
}

function writeCachedBackendCapabilities(binaryPath, capabilities) {
    try {
        const stat = fs.statSync(binaryPath);
        fs.writeFileSync(
            getBackendCapabilitiesPath(),
            JSON.stringify({ ...capabilities, binaryMtimeMs: stat.mtimeMs, binarySize: stat.size }, null, 2)
        );
    } catch (_) { /* ignore */ }
}

function probeBackendCapabilities(binaryPath) {
    const cached = readCachedBackendCapabilities(binaryPath);
    if (cached) {
        cachedBackendCapabilities = cached;
        return cached;
    }

    const capabilities = {
        supportsShiroCdnProtocols: false,
        buildRepo: '',
    };

    if (!binaryPath || !fs.existsSync(binaryPath)) {
        cachedBackendCapabilities = capabilities;
        return capabilities;
    }

    const probeConfigPath = path.join(userConfigDir, '.protocol-probe.json');
    const probeConfig = {
        LocalHttpProxyPort: 8081,
        LocalSocksProxyPort: 1081,
        PropagationChannelId: 'FFFFFFFFFFFFFFFF',
        SponsorId: 'FFFFFFFFFFFFFFFF',
        LimitTunnelProtocols: [SHIRO_CDN_PROTOCOL_PROBE],
    };

    try {
        fs.writeFileSync(probeConfigPath, JSON.stringify(probeConfig));
        const out = execFileSync(binaryPath, ['-config', probeConfigPath], {
            encoding: 'utf8',
            timeout: 4000,
            maxBuffer: 512 * 1024,
        });
        capabilities.supportsShiroCdnProtocols = !out.includes('invalid tunnel protocol');
        const buildMatch = out.match(/"buildRepo":"([^"]+)"/);
        if (buildMatch) {
            capabilities.buildRepo = buildMatch[1];
        }
    } catch (err) {
        const out = `${err.stdout || ''}${err.stderr || ''}${err.message || ''}`;
        capabilities.supportsShiroCdnProtocols = !out.includes('invalid tunnel protocol');
        const buildMatch = out.match(/"buildRepo":"([^"]+)"/);
        if (buildMatch) {
            capabilities.buildRepo = buildMatch[1];
        }
    }

    try {
        fs.unlinkSync(probeConfigPath);
    } catch (_) { /* ignore */ }

    writeCachedBackendCapabilities(binaryPath, capabilities);
    cachedBackendCapabilities = capabilities;
    return capabilities;
}

function getBackendCapabilities(binaryPath) {
    if (cachedBackendCapabilities) {
        return cachedBackendCapabilities;
    }
    return probeBackendCapabilities(binaryPath);
}

function usesShiroCdnProtocols(binaryPath) {
    return getBackendCapabilities(binaryPath).supportsShiroCdnProtocols === true;
}

function getDirectProtocols(binaryPath) {
    return usesShiroCdnProtocols(binaryPath) ? SHIRO_DIRECT_PROTOCOLS : LABS_DIRECT_PROTOCOLS;
}

function getCdnFrontingProtocols(binaryPath) {
    return usesShiroCdnProtocols(binaryPath) ? SHIRO_CDN_FRONTING_PROTOCOLS : LABS_CDN_ALL_MEEK_PROTOCOLS;
}

function getCdnFrontingInitialProtocols(binaryPath) {
    return usesShiroCdnProtocols(binaryPath) ? SHIRO_CDN_FRONTING_PROTOCOLS : LABS_CDN_FRONTING_PROTOCOLS;
}

function getTransportSettings() {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    if (!storage) {
        return defaultTransportSettings();
    }
    return {
        protocolSelection: storage.getItem(TRANSPORT_STORAGE_KEYS.protocol) || PROTOCOL_SELECTION.auto,
        cdnFrontingUseBuiltInScan: storage.getItem(TRANSPORT_STORAGE_KEYS.cdnUseBuiltInScan) !== 'false',
        cdnFrontingCustomIpList: storage.getItem(TRANSPORT_STORAGE_KEYS.cdnCustomIpList) || '',
        cdnFrontingCustomSni: storage.getItem(TRANSPORT_STORAGE_KEYS.cdnCustomSni) || '',
        conduitMode: storage.getItem(TRANSPORT_STORAGE_KEYS.conduitMode) || CONDUIT_MODE.publicOnly,
        rejectCensoredCountryProxies: storage.getItem(TRANSPORT_STORAGE_KEYS.rejectCensoredCountryProxies) !== 'false',
    };
}

function defaultTransportSettings() {
    return {
        protocolSelection: PROTOCOL_SELECTION.auto,
        cdnFrontingUseBuiltInScan: true,
        cdnFrontingCustomIpList: '',
        cdnFrontingCustomSni: '',
        conduitMode: CONDUIT_MODE.publicOnly,
        rejectCensoredCountryProxies: true,
    };
}

function protocolLimitsForSelection(selection, binaryPath) {
    const shiro = usesShiroCdnProtocols(binaryPath);
    switch (selection) {
        case PROTOCOL_SELECTION.direct:
            return getDirectProtocols(binaryPath);
        case PROTOCOL_SELECTION.cdnFronting:
            return getCdnFrontingProtocols(binaryPath);
        case PROTOCOL_SELECTION.conduit:
            return CONDUIT_PROTOCOLS;
        default:
            return null;
    }
}

function enablesCdnFrontingBlock(selection, binaryPath) {
    if (selection === PROTOCOL_SELECTION.cdnFronting) {
        return true;
    }
    if (!usesShiroCdnProtocols(binaryPath)) {
        return false;
    }
    return selection === PROTOCOL_SELECTION.auto || selection === PROTOCOL_SELECTION.direct;
}

function getConnectionTimeoutMs(settings) {
    switch (settings?.protocolSelection) {
        case PROTOCOL_SELECTION.conduit:
            return 180000;
        case PROTOCOL_SELECTION.cdnFronting:
            return 180000;
        case PROTOCOL_SELECTION.direct:
            return 45000;
        default:
            return 30000;
    }
}

function loadBundledCDNExtras() {
    const candidates = [
        path.join(userConfigDir, 'cdn-fronting.local.json'),
        path.join(appConfigDir, 'cdn-fronting.json'),
    ];
    for (const file of candidates) {
        try {
            if (fs.existsSync(file)) {
                return JSON.parse(fs.readFileSync(file, 'utf-8'));
            }
        } catch (_) { /* ignore */ }
    }
    return { extraEdgeIPs: [], extraSniHostnames: [] };
}

function parseIPList(text) {
    const out = [];
    const seen = new Set();
    String(text || '').split(/[,;\s\n\t]+/).forEach((entry) => {
        const candidate = entry.trim();
        if (!candidate || !isValidIPv4OrCIDR(candidate) || seen.has(candidate)) {
            return;
        }
        seen.add(candidate);
        out.push(candidate);
    });
    return out;
}

function parseSNIList(text) {
    const out = [];
    const seen = new Set();
    String(text || '').split(/[,;\s\n\t]+/).forEach((entry) => {
        const sni = normalizeHostname(entry);
        if (!sni || seen.has(sni)) {
            return;
        }
        seen.add(sni);
        out.push(sni);
    });
    return out;
}

function isValidIPv4(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every((part) => {
        if (!part || part.length > 3 || !/^\d+$/.test(part)) return false;
        const value = Number(part);
        return value >= 0 && value <= 255;
    });
}

function isValidIPv4OrCIDR(value) {
    if (value.includes('/')) {
        const [ip, prefix] = value.split('/', 2);
        const p = Number(prefix);
        return isValidIPv4(ip) && Number.isInteger(p) && p >= 0 && p <= 32;
    }
    return isValidIPv4(value);
}

function normalizeHostname(raw) {
    let host = String(raw || '').trim().toLowerCase();
    if (host.endsWith('.')) host = host.slice(0, -1);
    if (!host || host.length > 253 || isValidIPv4(host)) return '';
    const labels = host.split('.');
    if (!labels.length) return '';
    for (const label of labels) {
        if (!label || label.length > 63 || label.startsWith('-') || label.endsWith('-')) return '';
        if (!/^[a-z0-9-]+$/.test(label)) return '';
    }
    return host;
}

function meekOverride({ id, providerRegexes, dialAddressRegexes, dialAddress, sni, verifyNames, alpn }) {
    const o = {
        OverrideID: id,
        DialAddresses: [dialAddress],
        SNIServerName: sni,
        VerifyServerNames: verifyNames,
        ALPNProtocols: alpn,
        TLSProfile: 'Chrome-83',
    };
    if (providerRegexes) o.MatchFrontingProviderIDRegexes = providerRegexes;
    if (dialAddressRegexes) o.MatchDialAddressRegexes = dialAddressRegexes;
    return o;
}

function edgeOverride(id, ip, customSni) {
    const sni = customSni || ip;
    const verify = [...new Set([
        sni, ip,
        'a248.e.akamai.net', 'a.akamaized.net', 'a.akamaized-staging.net',
        'a.akamaihd.net', 'a.akamaihd-staging.net', 'www.akamai.com',
    ])];
    return meekOverride({
        id,
        dialAddressRegexes: ['.*'],
        dialAddress: ip,
        sni,
        verifyNames: verify,
        alpn: ['http/1.1'],
    });
}

function makeDialOverrides(customSni) {
    const overrides = [];
    const fastlyVerify = [
        'www.python.org', 'pypi.org', 'fastly.com', 'www.fastly.com',
        'developer.fastly.com', 'githubassets.com', 'github.com',
        'github.io', 'githubusercontent.com',
    ];
    const fastlyALPN = ['h2', 'http/1.1'];

    overrides.push(meekOverride({
        id: 'fastly-provider',
        providerRegexes: ['(?i)fastly'],
        dialAddress: 'pypi.org',
        sni: 'pypi.org',
        verifyNames: fastlyVerify,
        alpn: fastlyALPN,
    }));
    overrides.push(meekOverride({
        id: 'fastly-address',
        dialAddressRegexes: ['(?i)(fastly|pypi|python|github)'],
        dialAddress: 'pypi.org',
        sni: 'pypi.org',
        verifyNames: fastlyVerify,
        alpn: fastlyALPN,
    }));

    const seenIPs = new Set();
    const extras = loadBundledCDNExtras();
    for (const [id, ip] of BUILT_IN_EDGE_IPS) {
        if (seenIPs.has(ip)) continue;
        seenIPs.add(ip);
        overrides.push(edgeOverride(id, ip, customSni));
    }
    for (const ip of extras.extraEdgeIPs || []) {
        const trimmed = String(ip).trim();
        if (!trimmed || seenIPs.has(trimmed)) continue;
        seenIPs.add(trimmed);
        overrides.push(edgeOverride(`bundled-${trimmed}`, trimmed, customSni));
    }
    return overrides;
}

function makeScanSpec(ipCandidates, customSniText) {
    if (!ipCandidates.length) return null;
    const spec = { IPCandidates: ipCandidates };
    const snis = parseSNIList(customSniText);
    if (snis.length) spec.SNIServerNames = snis;
    return spec;
}

function allCustomIPCandidates(settings) {
    const extras = loadBundledCDNExtras();
    const out = [];
    const seen = new Set();
    for (const ip of [...parseIPList(settings.cdnFrontingCustomIpList), ...(extras.extraEdgeIPs || [])]) {
        if (seen.has(ip)) continue;
        seen.add(ip);
        out.push(ip);
    }
    return out;
}

function applyCdnTunnelProtocolPhases(config, settings, binaryPath) {
    delete config.InitialLimitTunnelProtocols;
    delete config.InitialLimitTunnelProtocolsCandidateCount;
    delete config.EstablishTunnelTimeoutSeconds;

    if (settings.protocolSelection !== PROTOCOL_SELECTION.cdnFronting) {
        return;
    }

    // Country egress + Meek-only often yields zero candidates (e.g. BE + FRONTED-MEEK).
    delete config.EgressRegion;

    config.EstablishTunnelTimeoutSeconds = 180;
    config.InitialLimitTunnelProtocols = getCdnFrontingInitialProtocols(binaryPath);
    config.InitialLimitTunnelProtocolsCandidateCount = LABS_CDN_INITIAL_CANDIDATE_COUNT;
}

function applyCdnFrontingConfig(config, settings, binaryPath) {
    if (!enablesCdnFrontingBlock(settings.protocolSelection, binaryPath)) {
        delete config.FrontedMeekDialOverrides;
        delete config.FrontedMeekDialOverridesProbability;
        delete config.FrontedMeekCDNScanUseBuiltInSpec;
        delete config.FrontedMeekCDNScanSpec;
        return;
    }

    const customSni = parseSNIList(settings.cdnFrontingCustomSni)[0] || '';
    config.FrontedMeekDialOverrides = makeDialOverrides(customSni);
    config.FrontedMeekDialOverridesProbability = 1.0;

    if (settings.cdnFrontingUseBuiltInScan) {
        config.FrontedMeekCDNScanUseBuiltInSpec = true;
    } else {
        delete config.FrontedMeekCDNScanUseBuiltInSpec;
    }

    const scanIPs = allCustomIPCandidates(settings);
    const scanSpec = makeScanSpec(scanIPs, settings.cdnFrontingCustomSni);
    if (scanSpec) {
        config.FrontedMeekCDNScanSpec = scanSpec;
    } else {
        delete config.FrontedMeekCDNScanSpec;
    }

    if (settings.protocolSelection === PROTOCOL_SELECTION.cdnFronting) {
        if (usesShiroCdnProtocols(binaryPath)) {
            config.DisableTactics = true;
        } else {
            delete config.DisableTactics;
            config.AggressiveEstablishment = true;
        }
    }
}

function usesPersonalCompartment(settings) {
    switch (settings.conduitMode) {
        case CONDUIT_MODE.shiroCommunity:
            return true;
        case CONDUIT_MODE.publicOnly:
            return false;
        case CONDUIT_MODE.auto:
        default:
            return true;
    }
}

function resolveGeoIPDatabasePath() {
    const candidates = [
        path.join(userConfigDir, 'GeoLite2-Country.mmdb'),
        path.join(appConfigDir, 'GeoLite2-Country.mmdb'),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
}

function applyConduitConfig(config, settings) {
    if (settings.protocolSelection !== PROTOCOL_SELECTION.conduit) {
        delete config.InproxyClientPersonalCompartmentID;
        delete config.GeoIPDatabasePath;
        delete config.InproxyRejectProxyCountryCodes;
        if (config[BUNDLED_COMPARTMENT_KEY] !== undefined) {
            // keep compartment key in base config until consumed
        }
        return;
    }

    const compartment = String(config[BUNDLED_COMPARTMENT_KEY] || '').trim();
    delete config[BUNDLED_COMPARTMENT_KEY];

    if (usesPersonalCompartment(settings) && compartment) {
        config.InproxyClientPersonalCompartmentID = compartment;
    } else {
        delete config.InproxyClientPersonalCompartmentID;
    }

    const geoPath = resolveGeoIPDatabasePath();
    if (geoPath) {
        config.GeoIPDatabasePath = geoPath;
    } else {
        delete config.GeoIPDatabasePath;
    }

    if (settings.rejectCensoredCountryProxies) {
        config.InproxyRejectProxyCountryCodes = [...CENSORED_COUNTRY_CODES];
    } else {
        delete config.InproxyRejectProxyCountryCodes;
    }

    delete config.DisableTactics;
    delete config.EstablishTunnelTimeoutSeconds;
}

function applyTunnelConfig(config, settings) {
    config.EmitDiagnosticNotices = true;
    config.DNSResolverAlternateServers = DNS_RESOLVER_ALTERNATE_SERVERS;

    if (settings.protocolSelection === PROTOCOL_SELECTION.direct) {
        config.DisableTactics = true;
    } else if (settings.protocolSelection !== PROTOCOL_SELECTION.conduit
        && settings.protocolSelection !== PROTOCOL_SELECTION.cdnFronting) {
        delete config.DisableTactics;
    }
}

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasRemoteServerList(config) {
    if (nonEmptyString(config.RemoteServerListUrl)) return true;
    const urls = config.RemoteServerListURLs;
    if (Array.isArray(urls) && urls.some((u) => nonEmptyString(u))) return true;
    if (Array.isArray(urls) && urls.some((item) => nonEmptyString(item?.URL))) return true;
    return false;
}

function conduitDistributorReadiness(config) {
    const entrySignatureKey = nonEmptyString(config.ServerEntrySignaturePublicKey);
    const remoteList = hasRemoteServerList(config);
    return {
        entrySignatureKey,
        remoteList,
        allowsConduit: entrySignatureKey && remoteList,
    };
}

function validateTransportSettings(settings, config, binaryPath) {
    if (settings.protocolSelection === PROTOCOL_SELECTION.conduit) {
        const readiness = conduitDistributorReadiness(config);
        if (!readiness.allowsConduit) {
            return {
                valid: false,
                message: CONDUIT_BLOCKED_MESSAGE,
            };
        }
    }

    if (settings.protocolSelection === PROTOCOL_SELECTION.cdnFronting && binaryPath) {
        const limits = getCdnFrontingProtocols(binaryPath);
        if (!limits.length) {
            return {
                valid: false,
                message: 'CDN fronting is not available with this tunnel-core binary.',
            };
        }
    }

    return { valid: true };
}

function applyTransportSettings(config, settings, binaryPath) {
    const selection = settings.protocolSelection || PROTOCOL_SELECTION.auto;

    applyTunnelConfig(config, settings);
    applyCdnFrontingConfig(config, settings, binaryPath);
    applyCdnTunnelProtocolPhases(config, settings, binaryPath);

    const limits = protocolLimitsForSelection(selection, binaryPath);
    if (limits) {
        config.LimitTunnelProtocols = limits;
    } else {
        delete config.LimitTunnelProtocols;
    }

    applyConduitConfig(config, settings);

    if (binaryPath) {
        config._transportBackendProfile = usesShiroCdnProtocols(binaryPath) ? 'shiro' : 'labs';
    }

    return config;
}

function getCdnFrontingModeHint(binaryPath) {
    if (usesShiroCdnProtocols(binaryPath)) {
        return 'Tries Shiro CDN protocols first, then all Meek variants. Country selection is ignored. Allow up to 3 minutes.';
    }
    return 'Tries FRONTED-MEEK first, then UNFRONTED-MEEK. Country selection is ignored (picking a country often blocks CDN). Allow up to 3 minutes.';
}

function mergeConfigOverlay(baseConfig) {
    const localPath = path.join(userConfigDir, 'psiphon.config.local.json');
    if (!fs.existsSync(localPath)) {
        return { ...baseConfig };
    }
    try {
        const overlay = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
        return { ...baseConfig, ...overlay };
    } catch (_) {
        return { ...baseConfig };
    }
}

function transportSelectionLabel(selection) {
    switch (selection) {
        case PROTOCOL_SELECTION.direct: return 'Direct';
        case PROTOCOL_SELECTION.cdnFronting: return 'CDN fronting';
        case PROTOCOL_SELECTION.conduit: return 'Conduit';
        default: return 'Auto';
    }
}

module.exports = {
    TRANSPORT_STORAGE_KEYS,
    PROTOCOL_SELECTION,
    CONDUIT_MODE,
    CONDUIT_BLOCKED_MESSAGE,
    getTransportSettings,
    applyTransportSettings,
    mergeConfigOverlay,
    validateTransportSettings,
    conduitDistributorReadiness,
    transportSelectionLabel,
    getCdnFrontingModeHint,
    getConnectionTimeoutMs,
    probeBackendCapabilities,
    getBackendCapabilities,
    usesShiroCdnProtocols,
    parseIPList,
    parseSNIList,
};
