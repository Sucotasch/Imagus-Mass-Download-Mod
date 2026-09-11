"use strict";

// md-dnr.js — Fix E-2 (2026-09-10, second pixiv live test,
// v2026.8.20.7 → v2026.8.20.8).
// Hotlink-protected CDNs (i.pximg.net) return 403 to every privileged
// context the mod uses:
//   - SW fetch: Chrome silently ignores the Referer header on fetch()
//     ("Referer" is a forbidden header name per the Fetch spec) and sends
//     Origin: chrome-extension://... — the CDN's Referer gate rejects it.
//   - chrome.downloads.download: initiated by the extension, no Referer
//     substitution possible (the downloads API takes no headers).
// The proof-of-concept userscript (greasyfork 39387) solves the SAME
// problem with a privileged GM_xmlhttpRequest that CAN set Referer —
// i.e. it lets the privileged context fetch with the browser's own
// Referer semantics. The extension equivalent of "let the request carry
// the right Referer" is a declarativeNetRequest session rule.
//
// Fix E (v2026.8.20.7, first live test) installed a rule with
// initiatorDomains: [extension] and no resourceTypes; the 2026-09-10
// log proved it matches the SW fetch (44/44 HEAD/200 — the filter
// phase is cured) but NOT the chrome.downloads.download request
// (42 SERVER_FORBIDDEN). Fix E-2 (v2026.8.20.8) widened the condition to
// every documented resource type, main_frame included, dropping
// initiatorDomains — on the hypothesis that the downloads request was
// merely an unmatched resource type.
//
// STATUS 2026-09-11 (v2026.8.20.9 live test, log/
// Pixiv imagus-mass-download-log-2026-09-11T18-28-25.txt): the E-2
// hypothesis is FALSIFIED. Same 42 items, same shape — every filter fetch
// HEAD/200 (rule matched, gate lifted) and every download
// `interrupted: SERVER_FORBIDDEN`. The two earlier E/E-2 logs from
// 2026-09-10 (18:54 v2026.8.20.7, 21:23 v2026.8.20.8) show the identical
// count, so widening resourceTypes changes nothing for the download.
// CONCLUSION: a chrome.downloads.download request is NOT routed through
// this extension's DNR rules; the Referer substitution reaches the SW
// fetch only. Do NOT spend a fourth test on resourceTypes/initiatorDomains
// tuning — a Chrome-side fix needs a different carrier for the bytes
// (open design item: extension-origin document fetch, e.g. offscreen).
// Firefox is unaffected by that limitation because its downloads API
// accepts a Referer header (see the FF tree's processDownloadQueue).
//
// Fix E-3 (2026-09-11): `webbundle` removed from the resource-type list.
// Firefox's schema does not know the value and REJECTS THE WHOLE CALL
// (live log/
// `Firefox pixiv imagus-mass-download-log-2026-09-11T18-35-24.txt`:
// "Type error for parameter options (Error processing
// addRules.0.condition.resourceTypes.12: Invalid enumeration value
// \"webbundle\")"), so in the FF tree NO rule was ever installed and
// every registry-host task died in the filter phase. The list below is
// the 13-type common denominator accepted by both engines (Chrome's
// enum minus its engine-specific values).
//
// Design (2026-09-10, user-approved — A only, re-scoped after review):
//   - Referer value: task.referer — the page the URL was found on and
//     PROVEN to pass the gate (the Imagus popup <img> loads with the
//     browser-sent Referer of that very page). Fallback when a task has
//     no referer (popup save sends none): the registry site root.
//   - Scope: ONLY hosts in the registry below. No initiatorDomains: the
//     rule also fires for non-extension requests to these hosts (a
//     side effect the user accepted: hotlinked pximg images on OTHER
//     pages get a valid pixiv Referer and load instead of 403ing).
//   - Lifetime: one session rule per host (stable ids 1..N by registry
//     order). Session rules survive SW suspension and are cleared by
//     the browser at shutdown; re-adding the same id overwrites in
//     place, so a re-ensure after any SW restart is always safe.
//   - Best-effort: if DNR is unavailable (old Chrome/FF, missing
//     permission), everything degrades to the previous behavior.
//   - NO byte-buffering tier (SW transfer → object URL) by design: a
//     SW-owned Blob cannot cross the JSON messaging boundary nor be
//     materialized as an object URL in the MV3 SW (no DOM), and pixiv
//     PNGs run 30-40 MB — buffering them through the SW heap is the
//     wrong architecture. The browser-context download streams any
//     size; the rule's whole job is to let it through the Referer gate.
//
// Load order (background/service.js): importScripts AFTER
// service-init.js/service-core.js — this module is self-contained
// otherwise.

// Hosts known to run a Referer gate. Registry, not a blanket rule: any
// host absent from here keeps today's behavior. pximg.net family: pixiv
// CDNs (img-original/img-master/user-profile; i-f/i-cf/i-og are the
// alternative CDN hosts used by the pixiv site).
var MD_DNR_MEDIA_HOSTS = {
    'i.pximg.net': 'https://www.pixiv.net/',
    'i-f.pximg.net': 'https://www.pixiv.net/',
    'i-cf.pximg.net': 'https://www.pixiv.net/',
    'i-og.pximg.net': 'https://www.pixiv.net/'
};

// In-memory "rule is live" marks. Reset by every SW restart; never a
// correctness gate — mdDnrEnsureRule overwrites the same rule id
// idempotently, so a stale-miss here costs one redundant (harmless)
// updateSessionRules call, nothing else.
// BT-08: null-prototype — keyed by host, and '__proto__' is a valid host
// that a plain {} silently fails to store (mdDnrActive['__proto__'] reads
// Object.prototype => "rule already active" for a rule that was never added).
var mdDnrActive = Object.create(null);

function mdDnrHostConfig(host) {
    if (typeof host !== 'string') return null;
    var h = host.toLowerCase().replace(/\.$/, '');
    if (Object.prototype.hasOwnProperty.call(MD_DNR_MEDIA_HOSTS, h)) {
        return { host: h, fallbackReferer: MD_DNR_MEDIA_HOSTS[h] };
    }
    return null;
}

// URL -> { host, referer } | null when the URL is not registry-covered.
// Referer preference: task.referer (the page the media was found on),
// then the registry site root. Never invents a referer for a host the
// registry does not know.
function mdDnrRequestFor(url, referer) {
    if (typeof url !== 'string' || !url) return null;
    try {
        var u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        var cfg = mdDnrHostConfig(u.hostname);
        if (!cfg) return null;
        var ref = (typeof referer === 'string' && referer) ? referer : cfg.fallbackReferer;
        if (!/^https?:\/\//i.test(ref)) ref = cfg.fallbackReferer;
        return { host: cfg.host, referer: ref };
    } catch (_) {
        return null;
    }
}

// Stable rule id per registry host (1..N by key order) so a re-ensure
// overwrites the same slot instead of accumulating duplicates.
function mdRuleIdForHost(host) {
    var keys = Object.keys(MD_DNR_MEDIA_HOSTS);
    var idx = keys.indexOf(host);
    return (idx > -1 ? idx : keys.length) + 1;
}

// Fix E-2/Fix E-3: explicit list, main_frame included, `webbundle` EXCLUDED.
// The explicit form is kept (rather than the no-resourceTypes shorthand,
// which excludes main_frame) because the rule must also cover requests made
// from contexts with no tab/initiator, and because an explicit list is the
// only form that can be kept valid across both engines. `webbundle` is
// Chrome-only and invalid in Firefox's schema, where it makes the entire
// updateSessionRules call fail (Fix E-3) — never re-add an engine-specific
// value here without a matching support check.
var MD_DNR_RESOURCE_TYPES = [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
    'object', 'xmlhttprequest', 'ping', 'csp_report', 'media',
    'websocket', 'other'
];

function mdDnrBuildRule(host, referer) {
    return {
        id: mdRuleIdForHost(host),
        priority: 1,
        action: {
            type: 'modifyHeaders',
            requestHeaders: [
                { header: 'Referer', operation: 'set', value: referer }
            ]
        },
        condition: {
            urlFilter: '||' + host + '^',
            resourceTypes: MD_DNR_RESOURCE_TYPES.slice()
        }
    };
}

// Warn at most once per host per SW lifetime: a permanent engine/schema
// rejection would otherwise log one warning per scanned item (42 identical
// "DNR rule install failed" lines in the 2026-09-11 FF pixiv live test) and
// bury the real message. mdDnrActive stays false, so later items still
// re-attempt the install — a transient failure recovers by itself.
var mdDnrWarned = Object.create(null);

function mdDnrInstallFailed(host, e) {
    mdDnrActive[host] = false;
    if (!mdDnrWarned[host]) {
        mdDnrWarned[host] = true;
        console.warn(chrome.runtime.getManifest().name + ': DNR referer rule install failed for '
            + host + ' (hotlink gate stays in place, downloads may 403): '
            + (e && e.message ? e.message : e));
    }
    return Promise.resolve(false);
}

// Idempotent ensure: install the session rule for the host behind `url`
// (a no-op resolve(false) for every non-registry host). Returns a promise
// resolving true once a rule is in place. All failures are swallowed
// and logged — DNR is a best-effort optimization, never a hard
// dependency: on failure the flow degrades to the pre-Fix-E behavior.
//
// Fix E-3: NO failure mode may reach the caller as a throw. Firefox
// rejects an invalid argument SYNCHRONOUSLY (schema validation in the
// caller), which used to escape mdDnrEnsureForTask → the filter task's
// catch → a terminal "Filter error" row for every pixiv item (the whole
// album lost in the filter phase).
function mdDnrEnsureRule(url, referer) {
    var req = mdDnrRequestFor(url, referer);
    if (!req) return Promise.resolve(false);
    if (mdDnrActive[req.host]) return Promise.resolve(true);
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) {
        return Promise.resolve(false);
    }
    var rule = mdDnrBuildRule(req.host, req.referer);
    var pending;
    try {
        pending = chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
    } catch (e) {
        return mdDnrInstallFailed(req.host, e);
    }
    if (!pending || typeof pending.then !== 'function') return Promise.resolve(false);
    return pending
        .then(function () {
            mdDnrActive[req.host] = true;
            console.info(chrome.runtime.getManifest().name + ': DNR referer rule active for ' + req.host
                + ' (Referer: ' + req.referer + ')');
            return true;
        })
        .catch(function (e) {
            return mdDnrInstallFailed(req.host, e);
        });
}

// "Is the rule actually LIVE for this URL?" — {host, referer} when the
// registry covers the host AND installation already succeeded, otherwise
// null. The offscreen tier (service-core.js, Chrome) uses it as a fail-fast
// gate: the extension-origin fetch is only worth attempting when the Referer
// substitution really is in place, because without it the CDN answers 403 to
// every context (the 2026-09-11 FF log) and the tier would just buffer an
// error page. Distinct from mdDnrRequestFor(), which answers "should there be
// a rule" without looking at installation state.
function mdDnrRuleActiveFor(url, referer) {
    var req = mdDnrRequestFor(url, referer);
    if (!req) return null;
    return mdDnrActive[req.host] === true ? req : null;
}

// Hook: ensure the rule before any privileged fetch/download of a
// registry host. Callers: processFilterQueue (before HEAD), the GET
// fallback, processDownloadQueue (BROWSER-path tasks that skipped the
// filter), background case "download" (popup save) and the alterDownload
// interrupt hook in service.js.
function mdDnrEnsureForTask(task) {
    if (!task || typeof task.url !== 'string') return Promise.resolve(false);
    return mdDnrEnsureRule(task.url, task.referer);
}

// Startup re-arm: session rules persist across SW restarts, mdDnrActive
// does not. Read the live session rules and mark known ids active so a
// resumed SW skips redundant updateSessionRules calls. Pure optimization;
// mdDnrEnsureRule remains the authoritative install path.
function mdDnrRearm() {
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.getSessionRules) return;
    chrome.declarativeNetRequest.getSessionRules().then(function (rules) {
        var live = {};
        (rules || []).forEach(function (r) { live[r.id] = true; });
        Object.keys(MD_DNR_MEDIA_HOSTS).forEach(function (host) {
            mdDnrActive[host] = !!live[mdRuleIdForHost(host)];
        });
    }).catch(function () {});
}
