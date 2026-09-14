// SECURITY-C: mirror of static/index.html:68. The served sharedfloor page
// carries no theme picker, but office.theme.js validates the active theme
// against window.__OFFICE_SELECTABLE_THEMES__ (unset => it widens to ALL
// registered themes). Set here, in this EXTERNAL boot that loads before the
// keep scripts, so the baked page needs no inline <script> and PAGE_CSP needs
// no 'unsafe-inline'. Drift-pinned to index.html:68 in tests/test_sharedfloor_bake.py.
window.__OFFICE_SELECTABLE_THEMES__ = Object.freeze(['manhattan']);
Object.defineProperty(window, '__OFFICE_SHAREDFLOOR__', {
    value: true,
    writable: false,
    configurable: false,
});
(function() {
    var match = location.pathname.match(/^\/r\/([a-z0-9-]+)/);
    if (!match) return;
    
    var code = match[1];
    window.__sharedfloorRoom = code;
    
    var originalFetch = window.fetch;
    window.fetch = function(input, init) {
        var url = typeof input === 'string' ? input : input.url;
        if (url === '/api/state') {
            url = '/api/rooms/' + code + '/state';
            if (typeof input === 'string') {
                return originalFetch(url, init);
            }
            var newRequest = new Request(url, input);
            return originalFetch(newRequest, init);
        }
        return originalFetch(input, init);
    };
})();
