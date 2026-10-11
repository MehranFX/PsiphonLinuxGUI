/**
 * Parse psiphon-tunnel-core JSON diagnostic notices from process output (stderr).
 * @see Psiphon notice types: ConnectedServer, ActiveTunnel, ConnectedServerRegion
 */

function parseTunnelNoticeLines(text) {
    const notices = [];
    if (!text) {
        return notices;
    }

    String(text).split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
            return;
        }
        try {
            const obj = JSON.parse(trimmed);
            if (obj && obj.noticeType) {
                notices.push(obj);
            }
        } catch (_) { /* ignore non-JSON lines */ }
    });

    return notices;
}

/**
 * Merge notices into tunnel status { protocol, serverRegion }.
 * ActiveTunnel is authoritative for protocol once the tunnel is up.
 */
function mergeTunnelStatus(current, notices) {
    const next = {
        protocol: current?.protocol || '',
        serverRegion: current?.serverRegion || '',
    };
    let changed = false;

    for (const notice of notices) {
        const { noticeType, data } = notice;
        if (!data) {
            continue;
        }

        if (noticeType === 'ConnectedServerRegion' && data.serverRegion) {
            if (next.serverRegion !== data.serverRegion) {
                next.serverRegion = String(data.serverRegion);
                changed = true;
            }
        }

        if (noticeType === 'ConnectedServer' && data.protocol) {
            if (next.protocol !== data.protocol) {
                next.protocol = String(data.protocol);
                changed = true;
            }
            if (data.region && next.serverRegion !== data.region) {
                next.serverRegion = String(data.region);
                changed = true;
            }
        }

        if (noticeType === 'ActiveTunnel' && data.protocol) {
            if (next.protocol !== data.protocol) {
                next.protocol = String(data.protocol);
                changed = true;
            }
        }
    }

    return { status: next, changed };
}

module.exports = {
    parseTunnelNoticeLines,
    mergeTunnelStatus,
};
