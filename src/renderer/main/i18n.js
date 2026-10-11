const translations = {
    en: {
        'app.name': 'Psiphon',
        'status.stopped': 'Disconnected',
        'status.starting': 'Connecting…',
        'status.started': 'Connected',
        'connect.hint': 'Press the button to connect',
        'connect.hint.starting': 'Establishing secure tunnel…',
        'connect.hint.started': 'Your traffic is routed through the tunnel',
        'panel.connection': 'Connection log',
        'panel.browsers': 'Browser proxy',
        'system.proxy.label': 'System proxy',
        'system.proxy.hint': 'Sets OS proxy to 127.0.0.1:8081 (HTTP/HTTPS) and 1081 (SOCKS). Connect first.',
        'log.empty': 'No log entries yet.',
        'system.proxy.error': 'Could not change system proxy settings.',
        'ip.current': 'Current IP',
        'ip.resolved': 'Resolved IP',
        'ip.loading': 'Resolving…',
        'ip.country': 'Country',
        'ip.city': 'City',
        'ip.verify': 'Verify at',
        'browser.hint': 'Browsers restart when the tunnel starts or stops. Local proxy:',
        'browser.none': 'No supported browsers detected on this system.',
        'browser.count': '{n} available',
        'location.label': 'Connect via',
        'location.fastest': 'Fastest Country',
        'btn.connect': 'Connect',
        'btn.stop': 'Stop',
        'btn.disconnect': 'Disconnect',
        'connection.transport': 'Transport setting',
        'connection.protocol': 'Tunnel protocol',
        'connection.serverRegion': 'Server region',
        'connection.protocol.pending': 'Establishing…',
        'warning.server': 'The server for the selected country is currently unavailable.',
        'warning.server.hint': 'Try Fastest Country or switch Transport to Auto. For CDN mode, country is ignored — wait up to 3 minutes.',
        'warning.network': 'Network is down. Check your internet connection.',
        'manual.title': 'Manual proxy settings',
        'manual.body': 'Set HTTP/HTTPS proxy to 127.0.0.1:8081 and SOCKS to 127.0.0.1:1081 in your browser.',
        'manual.close': 'Close',
        'update.available': 'Update available!',
        'lang.label': 'Language',
    },
    fa: {
        'app.name': 'سایفون',
        'status.stopped': 'قطع شده',
        'status.starting': 'در حال اتصال…',
        'status.started': 'متصل',
        'connect.hint': 'برای اتصال دکمه را بزنید',
        'connect.hint.starting': 'در حال برقراری تونل امن…',
        'connect.hint.started': 'ترافیک شما از تونل عبور می‌کند',
        'panel.connection': 'لاگ اتصال',
        'panel.browsers': 'پروکسی مرورگر',
        'system.proxy.label': 'پروکسی سیستم',
        'system.proxy.hint': 'پروکسی سیستم: HTTP/HTTPS روی 127.0.0.1:8081 و SOCKS روی 1081. ابتدا Connect بزنید.',
        'log.empty': 'هنوز لاگی ثبت نشده.',
        'system.proxy.error': 'تغییر پروکسی سیستم ممکن نشد.',
        'ip.current': 'IP فعلی',
        'ip.resolved': 'IP ریزالو شده',
        'ip.loading': 'در حال دریافت…',
        'ip.country': 'کشور',
        'ip.city': 'شهر',
        'ip.verify': 'تأیید در',
        'browser.hint': 'مرورگر هنگام اتصال/قطع مجدداً راه‌اندازی می‌شود. پروکسی محلی:',
        'browser.none': 'مرورگر پشتیبانی‌شده‌ای در سیستم یافت نشد.',
        'browser.count': '{n} مورد',
        'location.label': 'اتصال از طریق',
        'location.fastest': 'سریع‌ترین کشور',
        'btn.connect': 'اتصال',
        'btn.stop': 'توقف',
        'btn.disconnect': 'قطع',
        'connection.transport': 'حالت Transport',
        'connection.protocol': 'پروتکل تونل',
        'connection.serverRegion': 'منطقه سرور',
        'connection.protocol.pending': 'در حال برقراری…',
        'warning.server': 'سرور کشور انتخابی در دسترس نیست.',
        'warning.server.hint': '«سریع‌ترین کشور» را امتحان کنید یا Transport را روی Auto بگذارید. در CDN کشور نادیده گرفته می‌شود — تا ۳ دقیقه صبر کنید.',
        'warning.network': 'شبکه قطع است. اتصال اینترنت را بررسی کنید.',
        'manual.title': 'تنظیم دستی پروکسی',
        'manual.body': 'پروکسی HTTP/HTTPS را 127.0.0.1:8081 و SOCKS را 127.0.0.1:1081 قرار دهید.',
        'manual.close': 'بستن',
        'update.available': 'به‌روزرسانی موجود است!',
        'lang.label': 'زبان',
    },
};

const SUPPORTED_LOCALES = Object.keys(translations);

function getLocale() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('locale') : null;
    if (saved && translations[saved]) {
        return saved;
    }
    return 'en';
}

function setLocale(locale) {
    if (!translations[locale]) {
        return;
    }
    localStorage.setItem('locale', locale);
    applyI18n();
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
}

function t(key, vars = {}) {
    const locale = getLocale();
    let text = translations[locale][key] || translations.en[key] || key;
    Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
    });
    return text;
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
}

module.exports = {
    SUPPORTED_LOCALES,
    getLocale,
    setLocale,
    t,
    applyI18n,
};
