"use strict";

var manifest = chrome.runtime.getManifest();
var cachedSieveRes = [],
    cachedPrefs = {};

// === MASS DOWNLOAD ===
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js');

const platform = navigator.userAgent.includes('Firefox') ? "firefox" : "chrome";

const _ = function (msg) {
    try {
        return chrome.i18n.getMessage(msg) || msg;
    } catch (err) {
        return msg;
    }
};

const scriptMessages = {
    "INVALID_URL": "", "DOWNLOAD_FAILED": "", "HIDE_TOOLBAR": "", "SAVE": "", "OPEN_IN_NEW_TAB": "", "GALLERY": "", "GOTO_SEARCH": "", "ROTATE_RIGHT": "",
    "PREFERENCES": "", "CANNOT_FIND_URL": "", "ADD_TO_IGNORE_LIST": ""
};
for (let key in scriptMessages) {
    scriptMessages[key] = _(key);
}

var cfg = {
    sessionGet: (keys, callback) => {
        return callback ? chrome.storage.session.get(keys, callback) : chrome.storage.session.get(keys);
    },
    sessionSet: (items) => {
        return chrome.storage.session.set(items);
    },
    sessionRemove: (keys) => {
        return chrome.storage.session.remove(keys);
    },
    async get(keys, callback) {
        const items = await chrome.storage.local.get(keys);
        for (var key in items) {
            try {
                if (!items[key]) throw new Error();
                items[key] = JSON.parse(items[key]);
            } catch (error) {
                delete items[key];
            }
        }
        callback?.(items);
        return items;
    },
    async set(items, callback) {
        for (var key in items) {
            items[key] = JSON.stringify(items[key]);
        }
        await chrome.storage.local.set(items);
        callback?.();
    },
    async remove(keys) {
        return chrome.storage.local.remove(keys);
    },
};

function withBaseURI(base, relative, secure) {
    if (relative[0] === '/' && relative[1] === '/') {
        return secure ? base.slice(0, base.indexOf(":") + 1) + relative : relative;
    } else if (/^[\w-]{2,20}:/i.test(relative)) {
        return relative;
    } else {
        const regex = relative[0] === '/' ? /(\/\/[^/]+)\/.*/ : /(\/)[^/]*(?:[?#].*)?$/;
        return base.replace(regex, "$1") + relative;
    }
}

function jsDelivrMirror(repoUrl) {
    // Convert raw.githubusercontent.com/user/repo/branch/path into the jsDelivr
    // CDN equivalent (no GitHub rate limit):
    //   cdn.jsdelivr.net/gh/user/repo@branch/path
    const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i.exec(repoUrl);
    if (!m) return null;
    return `https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}/${m[4]}`;
}

async function updateSieve(local, retryCount = 0, useMirror = false, force = false) {
    const MAX_RETRIES = 3;
    const { sieve: curSieve, sieveRepository: sieveRepoUrl } = await cfg.get(["sieveRepository", "sieve"]);
    local = local || !sieveRepoUrl;

    // A local sieve with zero usable rules must never be treated as "up to
    // date": if the user deleted all rules and wants to re-download them,
    // If-Modified-Since/304 would silently hand the (now empty) local sieve
    // back instead of fetching a full copy.
    const hasLocalRules = !!curSieve && Object.keys(curSieve).some(k => curSieve[k] && (curSieve[k].link || curSieve[k].img));

    const primaryUrl = local ? "/data/sieve.json" : sieveRepoUrl;
    const mirrorUrl = (!local && !useMirror) ? jsDelivrMirror(sieveRepoUrl) : null;
    const url = useMirror ? mirrorUrl : primaryUrl;
    if (!url) throw new Error("No sieve repository configured");

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const headers = {};
        if (!local && !useMirror && !force && hasLocalRules) {
            const { sieveUpdateLast } = await cfg.get("sieveUpdateLast");
            if (sieveUpdateLast) {
                headers['If-Modified-Since'] = new Date(Number(sieveUpdateLast)).toUTCString();
            }
        }

        const response = await fetch(url, { signal: controller.signal, headers });
        clearTimeout(timeoutId);

        if (response.status === 304) {
            if (force) {
                // A manual forced update must deliver the full remote content
                // (e.g. the user deleted rules and wants them back) — never
                // accept "not modified" on a forced update.
                throw new Error("HTTP 304 on forced update");
            }
            if (!hasLocalRules) {
                // Empty local sieve + 304 means the conditional request is
                // misleading — go fetch the full content from the mirror.
                throw new Error("HTTP 304 with empty local sieve");
            }
            console.info(manifest.name + ": Sieve is up to date (HTTP 304).");
            return { updated_sieve: curSieve, upToDate: true };
        }
        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        let newSieve = await response.json();

        if (typeof newSieve !== 'object' || newSieve === null) {
            throw new Error('Invalid sieve format: must be an object');
        }

        let validRuleCount = 0;
        for (let key in newSieve) {
            if (newSieve[key] && (newSieve[key].link || newSieve[key].img)) {
                validRuleCount++;
            }
        }

        if (validRuleCount === 0) {
            throw new Error('Sieve contains no valid rules');
        }

        if (curSieve) {
            let merged = {};
            for (let key in curSieve) {
                if (key.startsWith("_")) {
                    merged[key] = curSieve[key];
                }
            }
            for (let key in newSieve) {
                merged[key] = newSieve[key];
            }
            for (let key in curSieve) {
                if (merged[key]) {
                    merged[key].off = curSieve[key].off;
                } else {
                    curSieve[key].off = 1;
                    merged[key] = curSieve[key];
                }
            }
            newSieve = merged;
        }
        await updatePrefs({ sieve: newSieve });
        await cfg.set({ sieveUpdateLast: Date.now() });
        console.info(manifest.name + ": Sieve updated from " + (useMirror ? "jsDelivr mirror" : (local ? "local" : "remote")) + " repository.");
        return { updated_sieve: newSieve };

    } catch (error) {
        const source = useMirror ? "jsDelivr mirror" : (local ? "local" : "remote");
        const isRateLimit = /429|rate ?limit/i.test(error.message || "");
        console.warn(manifest.name + ": Sieve failed to update from " + source + " repository"
            + (isRateLimit ? " (HTTP 429 - GitHub rate limit)" : "") + "! | ", error.message);

        if (!local && !useMirror && mirrorUrl) {
            console.info(manifest.name + ": Trying jsDelivr mirror instead.");
            return updateSieve(local, retryCount, true, force);
        }

        if (!local && retryCount < MAX_RETRIES) {
            const delay = Math.pow(2, retryCount) * 1000;
            console.info(manifest.name + ": Retrying sieve update in " + delay + "ms (attempt " + (retryCount + 1) + "/" + MAX_RETRIES + ")");
            await new Promise(resolve => setTimeout(resolve, delay));
            return updateSieve(local, retryCount + 1, useMirror, force);
        }

        if (!local) {
            const data = await cfg.get("sieve");
            if (!data.sieve || !hasLocalRules) {
                return updateSieve(true);
            }
        }

        return { error: "Error. " + error.message + (isRateLimit ? " (HTTP 429 - GitHub rate limit; try again later or use the jsDelivr mirror)" : "") };
    }
}

function isSafeRegex(pattern) {
    if (typeof pattern !== 'string') return true;
    const dangerousPatterns = [
        /(\.\*){2,}/,
        /(\.\+){2,}/,
        /(\w\*){2,}/,
        /(\\[.*\\]\*){2,}/
    ];
    return !dangerousPatterns.some(p => p.test(pattern));
}

function cacheSieve(newSieve) {
    if (typeof newSieve === "string") newSieve = JSON.parse(newSieve);
    else newSieve = JSON.parse(JSON.stringify(newSieve));
    const cachedSieve = [];
    cachedSieveRes = [];

    for (var ruleName in newSieve) {
        var rule = newSieve[ruleName];
        if ((!rule.link && !rule.img) || (rule.img && !rule.to && !rule.res)) continue;
        try {
            if (rule.off) throw ruleName + " is off";

            if (rule.link && typeof rule.link === 'string' && !isSafeRegex(rule.link)) {
                console.warn(`Skipping potentially dangerous regex in rule ${ruleName} (link)`);
                continue;
            }
            if (rule.img && typeof rule.img === 'string' && !isSafeRegex(rule.img)) {
                console.warn(`Skipping potentially dangerous regex in rule ${ruleName} (img)`);
                continue;
            }

            if (rule.res)
                if (/^:\n/.test(rule.res)) {
                    cachedSieveRes[cachedSieve.length] = rule.res.slice(2);
                    rule.res = 1;
                } else {
                    if (rule.res.indexOf("\n") > -1) {
                        var lines = rule.res.split(/\n+/);
                        rule.res = RegExp(lines[0]);
                        if (lines[1]) rule.res = [rule.res, RegExp(lines[1])];
                    } else rule.res = RegExp(rule.res);
                    cachedSieveRes[cachedSieve.length] = rule.res;
                    rule.res = true;
                }
        } catch (ex) {
            if (typeof ex === "object") console.error(ruleName, rule, ex);
            else console.info(ex);
            continue;
        }
        if (rule.to && rule.to.indexOf("\n") > 0 && rule.to.indexOf(":\n") !== 0) rule.to = rule.to.split("\n");
        delete rule.note;
        cachedSieve.push(rule);
    }
    cachedPrefs.sieve = cachedSieve;
}

async function toggleIgnoreElementMenu(enabled) {
    if (!chrome.contextMenus) return;

    enabled ??= cachedPrefs?.hz?.grantUrlsEnabled !== false;

    try {
        await chrome.contextMenus.remove("ignore-element");
    } catch (err) {
        // It's fine if the menu doesn't exist yet.
    }

    if (enabled) {
        chrome.contextMenus.create({
            id: "ignore-element",
            title: _("IGNORE_ELEMENT"),
            contexts: ["page", "link", "image", "video", "audio", "editable"]
        });
    }
}

let prefsMutex = Promise.resolve();

async function updatePrefs(prefs, callback) {
    prefs = prefs || {};

    let defaults = await (await fetch("/data/defaults.json")).json();
    let storedPrefs = await cfg.get(Object.keys(defaults));
    let newPrefs = {};
    let changes = {};

    for (let key in defaults) {
        let isChanged = false;
        if (typeof defaults[key] === "object") {
            isChanged = true;
            if (Array.isArray(defaults[key])) {
                newPrefs[key] = prefs[key] || storedPrefs[key] || defaults[key];
            } else {
                newPrefs[key] = Object.assign({}, defaults[key], storedPrefs[key], prefs[key]);
                for (let subKey in defaults[key]) {
                    if (newPrefs[key][subKey] === undefined ||
                        typeof newPrefs[key][subKey] !== typeof defaults[key][subKey])
                    {
                        newPrefs[key][subKey] =
                            cachedPrefs?.[key]?.[subKey] !== undefined
                            ? cachedPrefs[key][subKey]
                            : defaults[key][subKey];
                    }
                }
            }
        } else {
            let value = prefs[key] || storedPrefs[key] || defaults[key];
            if (typeof value !== typeof defaults[key]) {
                value = defaults[key];
            }
            if (!cachedPrefs || cachedPrefs[key] !== value) {
                isChanged = true;
            }
            newPrefs[key] = value;
        }
        if (isChanged || storedPrefs[key] === undefined) {
            changes[key] = newPrefs[key];
        }
    }

    if (newPrefs.grants?.length > 0) {
        let grants = newPrefs.grants || [];
        let processedGrants = [];
        for (let i = 0; i < grants.length; ++i) {
            if (grants[i].op !== ";") {
                processedGrants.push({
                    op: grants[i].op,
                    url: grants[i].op.length === 2 ? RegExp(grants[i].url, "i") : grants[i].url,
                });
            }
        }
        if (processedGrants.length) {
            newPrefs.grants = processedGrants;
        }
    } else {
        delete newPrefs.grants;
    }

    cachedPrefs = newPrefs;
    await toggleIgnoreElementMenu(newPrefs?.hz?.grantUrlsEnabled);
    if (prefs.sieve) {
        changes.sieve = typeof prefs.sieve === "string" ? JSON.parse(prefs.sieve) : prefs.sieve;
        cacheSieve(changes.sieve);
    }

    await (prefsMutex = prefsMutex.then(async () => {
        await cfg.set(changes);
    }).catch(err => {
        console.error('updatePrefs storage error:', err);
    }));

    if (!prefs.sieve) {
        const data = await cfg.get("sieve");
        if (!data?.sieve) {
            await updateSieve(false);
        } else {
            cacheSieve(data.sieve);
        }
    }
    if (typeof callback === "function") {
        callback();
    }
}

function onMessage(message, sender, sendResponse) {
    return handleMessage(message, sender, sendResponse);
}

function handleMessage(message, sender, sendResponse) {
    let msg, context;
    if (sender === null) {
        msg = message;
    } else {
        context = { msg: message, origin: sender.url, postMessage: sendResponse };
        msg = context.msg;
    }
    if (!msg.cmd) return;

    switch (msg.cmd) {
        case "hello": {
            initTab(sender, sendResponse);
            break;
        }
        case "toggle":
            toggleTab(sender.tab);
            break;

        case "ignore_url":
            grantUrlAdd(msg.grantString);
            break;

        case "deinit_tabs":
            deinitTabs();
            break;

        case "cfg_get":
            if (!Array.isArray(msg.keys)) {
                msg.keys = [msg.keys];
            }
            cfg.get(msg.keys, function (data) {
                context.postMessage({ cfg: data });
            });
            return true;
        case "cfg_del":
            if (!Array.isArray(msg.keys)) {
                msg.keys = [msg.keys];
            }
            cfg.remove(msg.keys);
            break;
        case "getLocaleList":
            fetch("/data/locales.json")
                .then((resp) => resp.text())
                .then(function (resp) {
                    context.postMessage(resp);
                });
            return true;
        case "savePrefs":
            updatePrefs(msg.prefs, function () { context.postMessage({}); });
            return true;
        case "update_sieve":
            updateSieve(msg.local, 0, false, true).then(context.postMessage);
            return true;
        case "loadScripts":
            registerContentScripts();
            break;
        case "download":
            download(msg, sender.tab?.incognito, sendResponse);
            return true;
        case "history":
            if (chrome.extension?.inIncognitoContext || sender.tab?.incognito) break;
            if (typeof msg.url !== "string" || !msg.url) break;
            if (msg.manual) {
                chrome.history.getVisits({ url: msg.url }, function (hv) {
                    chrome.history[(hv.length ? "delete" : "add") + "Url"]({ url: msg.url });
                });
            } else {
                chrome.history.addUrl({ url: msg.url });
            }
            return true;
        case "options":
            chrome.runtime.openOptionsPage();
            break;

        case "get_file":
            fetch(`${chrome.runtime.getURL(message.file)}`)
                .then(r => r.text())
                .then(text => sendResponse(text))
                .catch(() => {});   // Audit N-23: no unhandled rejection on 404/network error
            return true;

        case "open":
            openUrl(msg, sender);
            break;
        case "resolve": {
            const data = {
                cmd: "resolved",
                id: msg.id,
                m: null,
                params: msg.params,
            };
            const rule = cachedPrefs.sieve[data.params.rule.id];

            // Audit U-01: rule.id indexes the sieve cached at scan start; a
            // re-cache (weekly update / options save) can shift or drop the
            // index. Without this guard `rule.res` throws, the response is
            // never sent, and the content side waits out its timeout.
            if (!rule) {
                console.warn(chrome.runtime.getManifest().name + ": stale resolve request (rule " + data.params.rule.id + " gone — sieve re-cached?)");
                if (context) context.postMessage(data);
                return;
            }

            if (data.params.rule.req_res) {
                data.params.rule.req_res = cachedSieveRes[data.params.rule.id];
            }
            if (data.params.rule.skip_resolve) {
                data.params.url = [""];
                context.postMessage(data);
                return;
            }

            const urlParts = /([^\s]+)(?: +:(.+)?)?/.exec(msg.url);
            msg.url = urlParts[1];
            let postData = urlParts[2] || null;

            if (rule.res === 1) {
                data.m = true;
                data.params._ = "";
                data.params.url = [urlParts[1], postData];
            }

            fetch(msg.url, {
                method: postData ? "POST" : "GET",
                body: postData,
                headers: postData ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
            })
                .then((fetchResp) => {
                    const contentType = fetchResp.headers.get("Content-Type");
                    if (/^(image|video|audio)\//i.test(contentType)) {
                        data.m = msg.url;
                        data.noloop = true;
                        console.warn(chrome.runtime.getManifest().name + ": rule " + data.params.rule.id + " matched against an image file");
                        context.postMessage(data);
                        return null;
                    }
                    return fetchResp.text();
                })
                .then((body) => {
                    // if (body === null) return;
                    let base = body.slice(0, 4096);
                    const baseHrefMatch = /<base\s+href\s*=\s*("[^"]+"|'[^']+')/.exec(base);
                    base = baseHrefMatch
                        ? withBaseURI(msg.url, baseHrefMatch[1].slice(1, -1).replace(/&amp;/g, "&"), true)
                        : msg.url;

                    if (rule.res === 1) {
                        data.params._ = body;
                        data.params.base = base.replace(/(\/)[^\/]*(?:[?#].*)*$/, "$1");
                        context.postMessage(data);
                        return;
                    }

                    let patterns = cachedSieveRes[data.params.rule.id];
                    patterns = Array.isArray(patterns) ? patterns : [patterns];
                    patterns = patterns.map((pattern) => {
                        const source = pattern.source || pattern;
                        if (!source.includes("$")) return pattern;
                        let group = data.params.length;
                        group = Array.from({ length: group }, (_, i) => i).join("|");
                        group = RegExp("([^\\\\]?)\\$(" + group + ")", "g");
                        group = group.test(source)
                            ? source.replace(group, (match, pre, idx) => {
                                  return idx < data.params.length && pre !== "\\"
                                      ? pre + (data.params[idx] ? data.params[idx].replace(/[/\\^$-.+*?|(){}[\]]/g, "\\$&") : "")
                                      : match;
                              })
                            : group;
                        return typeof pattern === "string" ? group : RegExp(group);
                    });

                    let match = patterns[0].exec(body);
                    if (match) {
                        const loopParam = data.params.rule.loop_param;
                        if (rule.dc && (("link" === loopParam && rule.dc !== 2) || ("img" === loopParam && rule.dc > 1))) {
                            match[1] = decodeURIComponent(decodeURIComponent(match[1]));
                        }
                        data.m = withBaseURI(base, match[1].replace(/&amp;/g, "&"));
                        if ((match[2] && (match = match.slice(1))) || (patterns[1] && (match = patterns[1].exec(body)))) {
                            data.m = [data.m, match.filter((val, idx) => idx && val).join(" - ")];
                        }
                    } else {
                        console.info(chrome.runtime.getManifest().name + ": no match for " + data.params.rule.id);
                    }
                    context.postMessage(data);
                })
                .catch((error) => {
                    // Audit N-17: a network failure must not leave the sender
                    // hanging for its resolutionTimeout — fail fast as "no match".
                    console.warn(manifest.name + ": resolve fetch failed: " + (error && error.message));
                    context?.postMessage({ cmd: "resolved", id: msg.id, m: null, params: msg.params });
                });
            return true;
        }

        // === MASS DOWNLOAD CASES ===
        case 'downloadAll':
            return handleDownloadAll(msg, sender, sendResponse);
        case 'openDownloadProgress':
            handleOpenDownloadProgress(msg, sender);
            break;
        case 'registerProgressTab':
            handleRegisterProgressTab(msg, sender);
            break;
        case 'downloadMass':
            handleDownloadMass(msg, sender);
            break;
        case 'resolveAndDownloadGroups':
            handleResolveGroups(msg, sender);
            break;
        case 'updateStatus':
            handleUpdateStatus(msg);
            break;
        case 'updateFilterStats':
            handleUpdateFilterStats(msg);
            break;
        case 'stopScanning':
            handleStopScanning();
            break;
        case 'getDownloadStatus':
            handleGetDownloadStatus(msg, sendResponse);
            break;
        case 'getDownloadLog':
            {
                const items = serializeAllProgress();
                const da = cachedPrefs?.da || {};
                sendResponse({
                    log: Object.values(items),
                    stats: downloadStats,
                    version: chrome.runtime.getManifest().version,
                    sessionStart: sessionStartTime,
                    settings: {
                        hiRes: !!(cachedPrefs?.hz?.hiRes),
                        maxConcurrentFilters: Number(da.maxConcurrentFilters) || 5,
                        maxConcurrentDownloads: Number(da.maxConcurrentDownloads) || 3,
                        minImageSizeKB: da.minImageSize != null ? da.minImageSize : 45,
                        minVideoSizeMB: da.minVideoSize != null ? da.minVideoSize : 2,
                        downloadOnUnknown: da.downloadOnUnknown !== false,
                        excludedExtensions: da.excludedExtensions != null ? da.excludedExtensions : '.svg, .ico, .gif',
                        resolutionTimeout: da.resolutionTimeout != null ? da.resolutionTimeout : 8,
                        showProgressTab: da.showProgressTab !== false
                    }
                });
            }
            return true;
        case 'clearCompletedDownloads':
            handleClearCompleted();
            break;
        case 'clearAllDownloads':
            handleClearAll();
            break;
        case 'retryDownload':
            handleRetryDownload(msg, sender);
            break;
        case 'refererDownloadReady':
            handleRefererDownloadReady(msg, sender);
            break;
        case 'refererDownloadFailed':
            handleRefererDownloadFailed(msg);
            break;
        case 'refererDownloadDone':
            handleRefererDownloadDone(msg);
            break;
    }
}

async function deinitTabs() {
    const tabs = await chrome.tabs.query({ url: "<all_urls>" });
    for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { cmd: "reinit" }).catch(() => {});
    }
}

function sanitizeFilename(filename) {
    // replace invalid chars (\ / : * ? " < > |) + control chars
    return filename.replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, "_");
}

const downloadItems = {};
async function download(msg, tab, sendResponse) {
    if (!msg.url) return;

    const ext = msg.priorityExt ?? msg.ext;

    const filename =
        msg.filename && ext
            ? `${msg.filename}.${ext}`
            : msg.urlName;

    // Audit U-02: keep the object URL so it can be revoked once the download
    // reaches a terminal state (see onChanged below).
    const objectUrl = msg.blob ? URL.createObjectURL(msg.blob) : null;
    const params = {
        url: objectUrl || msg.url,
        filename: filename ? sanitizeFilename(filename) : undefined,
        conflictAction: "uniquify"
    };

    if (platform === "firefox") {
        params.incognito = tab.incognito;
    }

    let id;
    try {
        id = await chrome.downloads.download(params);
    } catch (error) {
        // Audit N-18: a rejected download must not leave the sender waiting
        // for a response that never comes.
        if (typeof sendResponse === "function") sendResponse({ error: (error && error.message) || "Download failed" });
        return;
    }

    // save info in case we need to use alternative downloading method
    if (!msg.alterDownload) {
        msg.tabId = tab.id;
        msg.sendResponse = sendResponse;
        msg._objectUrl = objectUrl;
        downloadItems[id] = msg;
    }
}
/* // seems like onDeterminingFilename exists only in Chrome, so commenting that out for now
chrome.downloads.onDeterminingFilename?.addListener(function (item, suggest) {
    if (!downloadItems[item.id]) return;
    if (item.mime === "text/html") {
        // calceling download of HTML files, most probably an error page
        chrome.downloads.cancel(item.id);
        const msg = downloadItems[item.id];

        // request alternative download method
        msg.alterDownload = true;
        chrome.tabs.sendMessage(msg.tabId, msg);
    }
    delete downloadItems[item.id];
}); */

chrome.downloads.onChanged.addListener(function (delta) {
    const msg = downloadItems[delta.id];
    if (!msg) return;

    // Audit U-02/U-03: clean up entries and object URLs on terminal states;
    // cancel/erase get callbacks so chrome.runtime.lastError stays checked.
    const cleanup = () => {
        if (msg._objectUrl) URL.revokeObjectURL(msg._objectUrl);
        delete downloadItems[delta.id];
    };

    if (delta.state?.current === "complete") {
        cleanup();
        return;
    }

    if (delta.error || /\.html?$/.exec(delta.filename?.current)) {
        // calceling download of HTML files, most probably an error page
        chrome.downloads.cancel(delta.id, () => {});
        chrome.downloads.erase({ id: delta.id }, () => {});

        // request alternative download method
        msg.alterDownload = true;
        if (typeof msg.sendResponse === "function") msg.sendResponse(msg);
        cleanup();
        // chrome.tabs.sendMessage(msg.tabId, msg);
    }
});


function keepAlive() {
    // keep the service worker alive
    setInterval(chrome.runtime.getPlatformInfo, 25_000);
}

let optionsOpened = false;
async function registerContentScripts() {
    if (!chrome.userScripts) {
        console.warn("chrome.userScripts API not available - user scripts will not be registered");
        return;
    }
    try {
        await chrome.userScripts.configureWorld({ csp: "script-src 'self' 'unsafe-eval'", messaging: true });

        await chrome.runtime.onUserScriptMessage?.addListener(onMessage);
        await chrome.userScripts.unregister();
        await chrome.userScripts.register([
            {
                id: "app.js",
                allFrames: true,
                matches: ["<all_urls>"],
                world: "USER_SCRIPT",
                runAt: "document_start",
                js: [{ file: "common/app.js" }],
            },
            {
                id: "content.js",
                allFrames: true,
                matches: ["<all_urls>"],
                runAt: "document_idle",
                world: "USER_SCRIPT",
                js: [{ file: "content/content.js" }],
            },
        ]);
    } catch(error) {
        if (error?.message?.includes("is already registered")) {
            return;
        }
        console.error("Failed to register user scripts:", error);
        if (!optionsOpened) {
            chrome.runtime.openOptionsPage();
            optionsOpened = true;
        }
    }
}

// Sieve auto update once a week
chrome.alarms.onAlarm.addListener(autoUpdateSieve);
setTimeout(autoUpdateSieve, 20_000);
async function autoUpdateSieve(alarm) {
    const ALARM_ID = 'alarm-sieve-update';
    if (alarm?.name && alarm.name !== ALARM_ID) return;

    alarm = await chrome.alarms.get(ALARM_ID);
    if (!alarm) {
        await chrome.alarms.create(ALARM_ID, { periodInMinutes: 60 });
    }

    let { sieveUpdateNext } = await cfg.get("sieveUpdateNext") || {};
    const now = Date.now();

    if (sieveUpdateNext && sieveUpdateNext <= now) {
        if (cachedPrefs.tls?.autoUpdateSieve) {
            let res = await updateSieve(false);
            if (res?.error) return;
        }
        sieveUpdateNext = 0;
    }

    if (!sieveUpdateNext) {
        cfg.set({ sieveUpdateNext: now + 7*24*60*60*1000 });
    }
}

function initTab(sender, sendResponse) {
    const resp = {
        cmd: "hello",
        isIframe: !!sender.frameId,
        prefs: {
            hz: cachedPrefs.hz,
            sieve: grantsIsBlocked(sender.tab.url) ? null : cachedPrefs.sieve,
            tls: cachedPrefs.tls,
            keys: cachedPrefs.keys,
            da: cachedPrefs.da,
            grantUrls: cachedPrefs.grantUrls,
            app: { name: manifest.name, version: manifest.version },
            messages: scriptMessages,
        }
    };

    if (typeof sendResponse === "function") {
        sendResponse(resp);
    } else {
        chrome.tabs.sendMessage(sender.tab.id, resp).catch(() => {});
    }
}

async function toggleTab(tab) {
    if (!tab.url) return;
    if (grantsIsBlocked(tab.url)) {
        await grantsRemove(tab.url);
        if (grantsIsBlocked(tab.url)) {
            // still blocked, most probably RegEx is used - should be handled manually
            chrome.tabs.create({ url: "options/options.html#grants" });
            return;
        }
    } else {
        await grantsAdd(tab.url);
    }

    updateBadge(tab.id, tab.url);

    // init/deinit tabs with the same origin
    let tabs = await chrome.tabs.query({ url: new URL(tab.url).origin + "/*" }) || [];
    tabs.forEach(t => initTab({ tab: t }));
}

function openUrl(msg, sender) {
    const urls = Array.isArray(msg.url) ? msg.url : [msg.url];
    const active = msg.active !== undefined ? msg.active : !msg.nf;
    for (const url of urls) {
        if (!url || typeof url !== "string") continue;
        if (msg.inWindow) {
            chrome.windows.create({
                type: "popup",
                url: url,
                top: msg.top,
                left: msg.left,
                width: msg.width,
                height: msg.height,
            })
            .catch(error => {
                chrome.windows.create({
                    type: "popup",
                    url: url,
                }).catch(() => {});
            });

        } else {
            let tabOptions = { url, active };
            if (sender?.tab?.id) {
                tabOptions.openerTabId = sender.tab.id;
                tabOptions.index = sender.tab.index + 1;
            }
            chrome.tabs.create(tabOptions)
            .catch(error => {
                delete tabOptions.openerTabId;
                chrome.tabs.create(tabOptions).catch(() => {});
            });
        }
    }
}

// check if Imagus is disabled on the given URL
function grantsIsBlocked(url) {
    if (!url || !cachedPrefs.grants) return false;

    let blocked = false;
    for (let i = 0, len = cachedPrefs.grants.length; i < len; ++i) {
        let grant = cachedPrefs.grants[i];
        if (grant.url === "*" || (grant.op[1] && grant.url.test(url)) || url.indexOf(grant.url) > -1) {
            blocked = grant.op[0] === "!";
        }
    }

    return blocked;
}

// disable Imagus on an elements with the given URL
async function grantUrlAdd(str) {
    if (!str) return;
    let { grantUrls } = await cfg.get("grantUrls");
    grantUrls ||= [];

    str = /(!{1,2}):(.+)/.exec(str);
    if (!str) return;
    grantUrls.push({ op: str[1], url: str[2] });
    await updatePrefs({ grantUrls: grantUrls });
    deinitTabs();
}

// disable Imagus on the given URL
async function grantsAdd(url) {
    if (!url) return;
    const host = new URL(url).host;
    if (!host) return;
    let { grants } = await cfg.get("grants");
    grants ||= [];

    grants.push({ op: "!", url: host + "/" });
    await updatePrefs({ grants: grants });
}

// enable Imagus on the given URL
async function grantsRemove(url) {
    if (!url) return;
    const host = new URL(url).host;
    if (!host) return;
    let { grants } = await cfg.get("grants");
    grants ||= [];

    grants = grants.filter(grant =>
        grant.url !== host + "/" ||
        grant.op.length > 1 ||
        grant.op[0] !== "!"
    );
    await updatePrefs({ grants: grants });
}

function updateBadge(tabId, tabUrl) {
    if (!tabUrl) return;
    if (grantsIsBlocked(tabUrl)) {
        chrome.action.setBadgeText({ text: "X", tabId: tabId });
        chrome.action.setBadgeBackgroundColor({color: "#ff8080ff", tabId: tabId });
        chrome.action.setBadgeTextColor({ color: "#FFF", tabId: tabId });
    } else {
        chrome.action.setBadgeText({ text: "", tabId: tabId });
    }
}

// disable/enable Imagus on icon click
chrome.action.onClicked.addListener(toggleTab);

// update badge on tab update
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (!tab.active) return;
    updateBadge(tabId, tab.url);
});

// update badge on tab activation
chrome.tabs.onActivated.addListener(async function(info) {
    try {
        updateBadge(info.tabId, (await chrome.tabs.get(info.tabId)).url);
    } catch (e) {}
});


chrome.action.setTitle({ title: `${manifest.name} v${manifest.version}\nClick to toggle on this site` });
updatePrefs(null, registerContentScripts);
chrome.runtime.onStartup.addListener(updatePrefs);
chrome.runtime.onInstalled.addListener(function (e) {
    if (e.reason === "update") {
        registerContentScripts();
    } else if (e.reason === "install") {
        chrome.runtime.openOptionsPage();
    }
});
chrome.runtime.onMessage?.addListener(onMessage);

keepAlive();

if (chrome.contextMenus) {
    chrome.runtime.onInstalled.addListener(() => {
        // Add context menu to toolbar button to open options page (Firefox only)
        if (platform === "firefox") {
            chrome.contextMenus.create({
                id: "open-options",
                title: _("OPTIONS"),
                contexts: ["action"]
            });
        }

        // Add on-page context menu to ignore elements (if enabled in settings)
        toggleIgnoreElementMenu();
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === "open-options") {
            chrome.runtime.openOptionsPage();
        } else if (info.menuItemId === "ignore-element" && tab?.id) {
            chrome.tabs.sendMessage(tab.id, { cmd: "ignore_element" }).catch(() => {});
        }
    });
}

cfg.get("open_settings", ({ open_settings }) => {
    if (open_settings) {
        cfg.remove("open_settings");
        chrome.runtime.openOptionsPage();
    }
});
