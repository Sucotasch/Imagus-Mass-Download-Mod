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
// (42 SERVER_FORBIDDEN). Per the official RuleCondition docs a rule
// WITHOUT resourceTypes matches every type EXCEPT main_frame, and a
// downloads-API request is not typed xmlhttprequest and/or carries no
// extension initiator. Fix E-2 widens the condition: every documented
// resource type (main_frame included), no initiatorDomains. The rule
// stays registry-scoped and session-scoped and only substitutes a
// Referer — but the browser-context download now matches too, which is
// the whole fix: the same mechanism as the userscript (the right
// Referer travels with the request), without buffering a single byte
// in the SW.
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
var mdDnrActive = {};

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

// Fix E-2: every documented resource type, main_frame included. The
// no-resourceTypes shorthand deliberately excludes main_frame (Chrome
// RuleCondition docs), and a chrome.downloads request is not typed
// xmlhttprequest — the v2026.8.20.7 rule never matched it (42
// SERVER_FORBIDDEN in the live log). An explicit full list is also the
// common denominator with Firefox's engine. initiatorDomains
// deliberately dropped: the downloads request carries no extension
// initiator.
var MD_DNR_RESOURCE_TYPES = [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
    'object', 'xmlhttprequest', 'ping', 'csp_report', 'media',
    'websocket', 'webbundle', 'other'
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

// Idempotent ensure: install the session rule for the host behind `url`
// (a no-op resolve(false) for every non-registry host). Returns a promise
// resolving true once a rule is in place. All failures are swallowed
// and logged — DNR is a best-effort optimization, never a hard
// dependency: on failure the flow degrades to the pre-Fix-E behavior.
function mdDnrEnsureRule(url, referer) {
    var req = mdDnrRequestFor(url, referer);
    if (!req) return Promise.resolve(false);
    if (mdDnrActive[req.host]) return Promise.resolve(true);
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) {
        return Promise.resolve(false);
    }
    var rule = mdDnrBuildRule(req.host, req.referer);
    return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] })
        .then(function () {
            mdDnrActive[req.host] = true;
            console.info(chrome.runtime.getManifest().name + ': DNR referer rule active for ' + req.host
                + ' (Referer: ' + req.referer + ')');
            return true;
        })
        .catch(function (e) {
            mdDnrActive[req.host] = false;
            console.warn(chrome.runtime.getManifest().name + ': DNR rule install failed for ' + req.host
                + ': ' + (e && e.message ? e.message : e));
            return false;
        });
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
