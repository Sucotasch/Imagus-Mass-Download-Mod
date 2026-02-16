"use strict";

var manifest = chrome.runtime.getManifest();
var cachedSieveRes = [],
    cachedPrefs = {};

// --- Mass Download Queues and Flags ---
var filterQueue = [];
var downloadQueue = [];
var activeFilters = 0;
var activeDownloads = 0;
var scanInProgress = false;

// --- Mass Download Progress and Stats ---
var downloadProgress = {};
var downloadStats = { found: 0, filtered: 0, downloaded: 0 };
var downloadProgressTabId = null;
var downloadInitiatorTabId = null;

// --- URL Selection and Validation ---
var globalProcessedUrls = new Set();
var urlValidationStats = {
    totalValidations: 0,
    successfulValidations: 0,
    recentFailures: [],
    circuitBreakerOpen: false
};

// Track active fetch controllers to prevent memory leaks and enable request cancellation
const activeControllers = new Map();

const platform = location.protocol === "moz-extension:" ? "firefox" : "chrome";

var cfg = {
    sessionGet: (keys, callback) => {
        const storage = chrome.storage.session || chrome.storage.local;
        return callback ? storage.get(keys, callback) : storage.get(keys);
    },
    sessionSet: (items) => {
        const storage = chrome.storage.session || chrome.storage.local;
        return storage.set(items);
    },
    sessionRemove: (keys) => {
        const storage = chrome.storage.session || chrome.storage.local;
        return storage.remove(keys);
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
    remove(keys) {
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

// Sieve update with retry logic, timeout protection, and validation
async function updateSieve(local, retryCount = 0) {
    const MAX_RETRIES = 3;
    const { sieve: curSieve, sieveRepository: sieveRepoUrl } = await cfg.get(["sieveRepository", "sieve"]);
    local = local || !sieveRepoUrl;

    try {
        // Improvement #6: Add timeout to prevent hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(local ? "/data/sieve.json" : sieveRepoUrl, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        let newSieve = await response.json();

        // Improvement #5: Validate sieve structure
        if (typeof newSieve !== 'object' || newSieve === null) {
            throw new Error('Invalid sieve format: must be an object');
        }

        // Count valid rules
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
            // keep rules that starts with "_"
            for (let key in curSieve) {
                if (key.startsWith("_")) {
                    merged[key] = curSieve[key];
                }
            }
            // add new and updated rules
            for (let key in newSieve) {
                merged[key] = newSieve[key];
            }
            // add all other existing rules and disable them
            for (let key in curSieve) {
                if (!merged[key]) {
                    curSieve[key].off = 1;
                    merged[key] = curSieve[key];
                }
            }
            newSieve = merged;
        }
        await updatePrefs({ sieve: newSieve });
        await cfg.set({ sieveUpdateLast: Date.now() });
        console.info(manifest.name + ": Sieve updated from " + (local ? "local" : "remote") + " repository.");
        return { updated_sieve: newSieve };

    } catch (error) {
        console.warn(manifest.name + ": Sieve failed to update from " + (local ? "local" : "remote") + " repository! | ", error.message);

        // Improvement #8: Retry with exponential backoff
        if (!local && retryCount < MAX_RETRIES) {
            const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
            console.info(manifest.name + ": Retrying sieve update in " + delay + "ms (attempt " + (retryCount + 1) + "/" + MAX_RETRIES + ")");
            await new Promise(resolve => setTimeout(resolve, delay));
            return updateSieve(local, retryCount + 1);
        }

        if (!local) {
            const data = await cfg.get("sieve");
            if (!data.sieve) {
                return updateSieve(true);
            }
        }

        return { error: "Error. " + error.message };
    }
}

// ReDoS (Regular Expression Denial of Service) protection
function isSafeRegex(pattern) {
    if (typeof pattern !== 'string') return true;

    // Check for catastrophic backtracking patterns
    const dangerousPatterns = [
        /(\.\*){2,}/,           // Multiple .* in sequence
        /(\.\+){2,}/,           // Multiple .+ in sequence
        /(\w\*){2,}/,           // Nested quantifiers
        /(\\[.*\\]\*){2,}/      // Nested character classes with quantifiers
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

            // Improvement #1: Check regex safety before compilation
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

// Improvement #3: Mutex Lock for updatePrefs
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
                        typeof newPrefs[key][subKey] !== typeof defaults[key][subKey]) {
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
    if (prefs.sieve) {
        changes.sieve = typeof prefs.sieve === "string" ? JSON.parse(prefs.sieve) : prefs.sieve;
        cacheSieve(changes.sieve); // Cache immediately, BEFORE mutex
    }

    // Improvement #3: Only mutex-protect the storage write
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

// Simple progress tab management - close old tab by ID, create new one
async function getOrCreateProgressTab(initiatorTabId) {
    // Close old progress tab if exists (by stored ID)
    if (downloadProgressTabId) {
        console.info(manifest.name + ': Closing old progress tab (ID: ' + downloadProgressTabId + ')');
        chrome.tabs.remove(downloadProgressTabId).catch(() => {
            // Tab may already be closed, ignore error
        });
        downloadProgressTabId = null;
    }

    // Create new tab next to initiator
    const progressUrl = chrome.runtime.getURL('options/download-progress.html');
    let createOptions = {
        url: progressUrl,
        active: false // Always in background (per user request)
    };

    // Position next to initiator tab
    if (initiatorTabId) {
        try {
            const initiatorTab = await chrome.tabs.get(initiatorTabId);
            createOptions.index = initiatorTab.index + 1;
            createOptions.openerTabId = initiatorTabId;
        } catch (e) {
            console.warn(manifest.name + ': Could not get initiator tab position');
        }
    }

    const newTab = await chrome.tabs.create(createOptions);
    downloadProgressTabId = newTab.id; // Store for messaging

    console.info(manifest.name + ': Created new progress tab (ID: ' + newTab.id + ')');
    return newTab.id;
}

function onMessage(message, sender, sendResponse) {
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
            initTab(sender.tab, sendResponse);
            break;
        }
        case "toggle":
            toggleTab(sender.tab);
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
            break;
        case "savePrefs":
            updatePrefs(msg.prefs, function () {
                context.postMessage({});
            });
            return true;
        case "update_sieve":
            updateSieve(msg.local).then(context.postMessage);
            return true;
        case "loadScripts":
            registerContentScripts();
            break;
        case "download":
            download(msg, sender.tab?.incognito, sendResponse);
            return true;
        case "history":
            if (chrome.extension?.inIncognitoContext || sender.tab?.incognito) break;
            if (msg.manual) {
                chrome.history.getVisits({ url: msg.url }, function (hv) {
                    chrome.history[(hv.length ? "delete" : "add") + "Url"]({ url: msg.url });
                    context.postMessage({});
                });
            } else {
                chrome.history.addUrl({ url: msg.url });
                context.postMessage({});
            }
            return true;
        case "options":
            chrome.runtime.openOptionsPage();
            break;
        case "open":
            if (!Array.isArray(msg.url)) {
                msg.url = [msg.url];
            }
            msg.url.forEach(function (url) {
                if (url && typeof url === "string") {
                    let tabOptions = { url, active: !msg.nf };
                    if (sender?.tab?.id) {
                        tabOptions.openerTabId = sender.tab.id;
                    }
                    try {
                        chrome.tabs.create(tabOptions);
                        console.info(manifest.name + ': Opened new tab:', url);
                    } catch (error) {
                        delete tabOptions.openerTabId;
                        chrome.tabs.create(tabOptions);
                        console.warn(manifest.name + ': Failed to open tab with openerTabId, retrying without:', url, error);
                    }
                }
            });
            break;
        case "resolve": {
            const data = {
                cmd: "resolved",
                id: msg.id,
                m: null,
                params: msg.params,
            };
            const rule = cachedPrefs.sieve[data.params.rule.id];

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
                });
            break;
        }
    }

    switch (msg.cmd) {
        case 'openDownloadProgress':
            downloadInitiatorTabId = sender.tab?.id;
            scanInProgress = true;

            // Improvement #9: Optional progress tab opening
            const showProgressTab = cachedPrefs?.da?.showProgressTab ?? false;

            if (showProgressTab) {
                getOrCreateProgressTab(downloadInitiatorTabId).then(tabId => {
                    // Send initial state when tab is ready
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tabId, {
                            cmd: 'updateStatus',
                            status: 'Starting scan...',
                            items: downloadProgress,
                            stats: downloadStats
                        }).catch(() => {
                            console.warn(manifest.name + ': Progress tab not ready yet');
                        });
                    }, 100);
                }).catch(err => {
                    console.error(manifest.name + ': Failed to create progress tab:', err);
                });
            } else {
                console.info(manifest.name + ': Progress tab disabled in settings');
                // Don't reset downloadProgressTabId - preserve for next time setting is enabled
            }
            break;

        case 'registerProgressTab':
            // Register the tab ID and provide immediate feedback
            downloadProgressTabId = sender.tab?.id;
            console.info(manifest.name + ': Progress tab registered with ID:', downloadProgressTabId);

            // Send current state immediately
            chrome.tabs.sendMessage(downloadProgressTabId, {
                cmd: 'updateStatus',
                status: scanInProgress ? 'Scanning...' : '',
                items: downloadProgress,
                stats: downloadStats
            }).catch(() => { });
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        case 'downloadMass':
            downloadInitiatorTabId = sender.tab?.id;
            if (!scanInProgress) scanInProgress = true;
            filterQueue.push({
                url: msg.url,
                referer: msg.referer,
                priorityExt: msg.priorityExt,
                ext: msg.ext,
                isPrivate: sender.tab?.incognito
            });
            processFilterQueue();
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        case 'downloadAll':
            // Bridge: Popup -> Background -> Injection (Signal Flare) -> UserScript
            chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                if (tab) {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        world: 'MAIN', // Target MAIN world to ensure event is visible across worlds via DOM
                        func: () => {
                            window.dispatchEvent(new CustomEvent('imagus-mass-download-trigger'));
                        }
                    }).catch((err) => {
                        console.warn(manifest.name + ': Failed to inject signal flare:', err);
                    });
                }
            });
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        case 'resolveAndDownloadGroups':
            downloadInitiatorTabId = sender.tab?.id;
            if (!scanInProgress) scanInProgress = true;
            if (typeof sendResponse === 'function') sendResponse({});
            processUrlGroupsWithValidation(msg.groups, msg.referer);
            break;

        case 'updateStatus':
            if (sender.tab?.id) downloadInitiatorTabId = sender.tab.id;
            if (downloadProgressTabId) {
                chrome.tabs.sendMessage(downloadProgressTabId, msg).catch((err) => {
                    console.warn('Failed to send status to progress tab:', err);
                });
            }
            if (msg.done) scanInProgress = false;
            // updateStatus is usually fire-and-forget, but for safety:
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        case 'updateFilterStats':
            downloadStats.found += (msg.found || 0);
            downloadStats.filtered += (msg.filtered || 0);
            if (downloadProgressTabId) {
                chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats }).catch(() => {
                    console.warn(manifest.name + ': Failed to send stats to progress tab');
                });
            }
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        case 'stopScanning':
            scanInProgress = false;
            filterQueue = [];
            downloadQueue = [];

            // Improvement #4: Abort all active fetch requests
            activeControllers.forEach(ctrl => ctrl.abort());
            activeControllers.clear();

            if (downloadInitiatorTabId) {
                chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'stopScanning' }).catch(() => { downloadInitiatorTabId = null; });
            }
            if (typeof sendResponse === 'function') sendResponse({});

            // Force check for completion after clearing everything
            setTimeout(checkAllQueuesEmpty, 500);
            break;

        case 'getDownloadStatus':
            sendResponse({ items: downloadProgress, stats: downloadStats });
            break;

        case 'clearCompletedDownloads':
            for (let url in downloadProgress) {
                if (downloadProgress[url].status === 'completed') {
                    delete downloadProgress[url];
                }
            }
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        case 'clearAllDownloads':
            downloadProgress = {};
            downloadStats = { found: 0, filtered: 0, downloaded: 0 };
            globalProcessedUrls.clear();
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        case 'retryDownload':
            if (msg.url) {
                filterQueue.push({
                    url: msg.url,
                    referer: msg.referer,
                    isPrivate: sender.tab?.incognito
                });
                processFilterQueue();
            }
            if (typeof sendResponse === 'function') sendResponse({});
            break;

        default:
            // Ensure we always safeguard the async response if expected
            if (typeof sendResponse === 'function') sendResponse({});
            break;
    }
    return true;
}


async function download(msg, incognito, sendResponse) {
    if (!msg.url) return;

    // Simplified: directly skip the check and use downloads API
    const params = {
        url: msg.blob ? URL.createObjectURL(msg.blob) : msg.url,
        filename: msg.filename && (msg.ext || msg.priorityExt) ? `${msg.filename}.${msg.priorityExt || msg.ext}` : (msg.urlName || undefined),
        conflictAction: "uniquify"
    };

    if (platform === "firefox") {
        params.incognito = incognito;
    }

    chrome.downloads.download(params, (downloadId) => {
        if (typeof sendResponse === 'function') {
            sendResponse({ downloadId: downloadId, error: chrome.runtime.lastError?.message });
        }
    });
}

/* chrome.downloads.onChanged.addListener(change => {
    if (!change.state) return;
    chrome.notifications.clear("imagus_download");
}); */

function keepAlive() {
    // keep the service worker alive
    setInterval(chrome.runtime.getPlatformInfo, 25_000);
}

async function registerContentScripts() {
    try {
        await chrome.userScripts.configureWorld({ csp: "script-src 'self' 'unsafe-eval'", messaging: true });
    } catch (error) {
        chrome.runtime.openOptionsPage();
        return;
    }

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
        cfg.set({ sieveUpdateNext: now + 7 * 24 * 60 * 60 * 1000 });
    }
}

function initTab(tab, sendResponse) {
    const resp = {
        cmd: "hello",
        prefs: {
            hz: cachedPrefs.hz,
            sieve: grantsIsBlocked(tab.url) ? null : cachedPrefs.sieve,
            tls: cachedPrefs.tls,
            keys: cachedPrefs.keys,
            app: { name: manifest.name, version: manifest.version },
        }
    };

    if (typeof sendResponse === "function") {
        sendResponse(resp);
    } else {
        chrome.tabs.sendMessage(tab.id, resp);
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
    tabs.forEach(initTab);
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

// disable Imagus on the given URL
async function grantsAdd(url) {
    if (!url) return;
    const hostname = new URL(url).hostname;
    if (!hostname) return;
    let { grants } = await cfg.get("grants");

    grants.push({ op: "!", url: hostname + "/" });
    await updatePrefs({ grants: grants });
}

// enable Imagus on the given URL
async function grantsRemove(url) {
    if (!url) return;
    const hostname = new URL(url).hostname;
    if (!hostname) return;
    let { grants } = await cfg.get("grants");

    grants = grants.filter(grant =>
        grant.url !== hostname + "/" ||
        grant.op.length > 1 ||
        grant.op[0] !== "!"
    );
    await updatePrefs({ grants: grants });
}

function updateBadge(tabId, tabUrl) {
    if (!tabUrl) return;
    if (grantsIsBlocked(tabUrl)) {
        chrome.action.setBadgeText({ text: "X", tabId: tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#ff8080ff", tabId: tabId });
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
chrome.tabs.onActivated.addListener(async function (info) {
    updateBadge(info.tabId, (await chrome.tabs.get(info.tabId)).url);
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
chrome.runtime.onMessage?.addListener((msg, sender, sendResponse) => {
    // Keep channel open for async response if onMessage returns a promise, 
    // but in this specific case, we just return true to be safe for Firefox/Chrome diffs
    onMessage(msg, sender, sendResponse);
    return true;
});

// Removed complex port logic to match Chrome behavior and stability

keepAlive();

// --- Mass Download Logic Functions ---

function checkAllQueuesEmpty() {
    if (filterQueue.length === 0 && downloadQueue.length === 0 && activeFilters === 0 && activeDownloads === 0) {
        if (downloadProgressTabId) {
            chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'allDownloadsComplete' }).catch(() => {
                downloadProgressTabId = null;
            });
        }
    }
}

function updateDownloadProgress(url, status, progress, error, downloadId, task) {
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, {
            cmd: 'updateDownloadStatus',
            url: url,
            status: status,
            progress: progress,
            error: error,
            downloadId: downloadId,
            task: task
        }).catch(() => {
            downloadProgressTabId = null;
        });
    }

    // Also store locally for UI refresh if needed
    downloadProgress[url] = { url: url, status: status, progress: progress, error: error, downloadId: downloadId, task: task };
}

async function processFilterQueue() {
    let maxConcurrentFilters = (cachedPrefs.da && cachedPrefs.da.maxConcurrentFilters) || 5;
    if (maxConcurrentFilters === 0) maxConcurrentFilters = Infinity;

    while (activeFilters < maxConcurrentFilters && filterQueue.length > 0) {
        const task = filterQueue.shift();
        activeFilters++;

        updateDownloadProgress(task.url, 'scanning', 0, null, null, task);

        const excludedExtensions = ((cachedPrefs.da && cachedPrefs.da.excludedExtensions) || '.png, .svg').split(',').map(s => s.trim().toLowerCase());
        const minImageSize = ((cachedPrefs.da && cachedPrefs.da.minImageSize) || 45) * 1024;
        const minVideoSize = ((cachedPrefs.da && cachedPrefs.da.minVideoSize) || 2) * 1024 * 1024;
        const downloadOnUnknown = (cachedPrefs.da) ? cachedPrefs.da.downloadOnUnknown : true;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
            // HEAD request for quick size/type check
            let response = await fetch(task.url, {
                method: 'HEAD',
                signal: controller.signal,
                credentials: 'omit'
            });
            clearTimeout(timeoutId);

            const contentType = response.headers.get('Content-Type') || '';
            const contentLength = response.headers.get('Content-Length');

            if (!response.ok || !contentLength || contentType.startsWith('text/html')) {
                throw new Error('Fallback to GET');
            }

            const size = parseInt(contentLength, 10);
            const urlExtension = (task.url.match(/\.[^.?#]+/) || [''])[0].toLowerCase();

            if (excludedExtensions.includes(urlExtension) || excludedExtensions.includes(contentType.split(';')[0])) {
                updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                downloadStats.filtered++;
                // Don't continue - let finally block run to call checkAllQueuesEmpty
            } else {
                let passed = true;
                if (contentType.startsWith('image/')) {
                    if (minImageSize > 0 && size < minImageSize) passed = false;
                } else if (contentType.startsWith('video/')) {
                    if (minVideoSize > 0 && size < minVideoSize) passed = false;
                } else if (!downloadOnUnknown) {
                    passed = false;
                }

                if (passed) {
                    downloadQueue.push(task);
                    processDownloadQueue();
                } else {
                    updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                    downloadStats.filtered++;
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (!scanInProgress) {
                continue;
            }

            try {
                // GET fallback
                let response = await fetch(task.url, { credentials: 'omit' });
                if (!scanInProgress) {
                    continue;
                }
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                const contentType = response.headers.get('Content-Type') || '';
                if (contentType.startsWith('text/html')) {
                    updateDownloadProgress(task.url, 'failed', 0, 'Server returned HTML page', null, task);
                } else {
                    const blob = await response.blob();
                    const size = blob.size;
                    const type = blob.type;
                    const urlExtension = (task.url.match(/\.[^.?#]+/) || [''])[0].toLowerCase();

                    if (excludedExtensions.includes(urlExtension) || excludedExtensions.includes(type)) {
                        updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                        downloadStats.filtered++;
                    } else {
                        let passed = true;
                        if (type.startsWith('image/')) {
                            if (minImageSize > 0 && size < minImageSize) passed = false;
                        } else if (type.startsWith('video/')) {
                            if (minVideoSize > 0 && size < minVideoSize) passed = false;
                        } else if (!downloadOnUnknown) {
                            passed = false;
                        }

                        if (passed) {
                            downloadQueue.push(task);
                            processDownloadQueue();
                        } else {
                            updateDownloadProgress(task.url, 'skipped', 0, 'Too small', null, task);
                            downloadStats.filtered++;
                        }
                    }
                }
            } catch (getError) {
                if (getError.name === 'AbortError' || !scanInProgress) {
                    updateDownloadProgress(task.url, 'canceled', 0, 'Canceled', null, task);
                } else {
                    updateDownloadProgress(task.url, 'failed', 0, 'Filter error: ' + getError.message, null, task);
                }
            }
        } finally {
            activeFilters--;
            processFilterQueue();
            setTimeout(checkAllQueuesEmpty, 100);
        }
    }
}

function processDownloadQueue() {
    let maxConcurrentDownloads = (cachedPrefs.da && cachedPrefs.da.maxConcurrentDownloads) || 3;
    if (maxConcurrentDownloads === 0) maxConcurrentDownloads = Infinity;

    while (activeDownloads < maxConcurrentDownloads && downloadQueue.length > 0) {
        const task = downloadQueue.shift();
        activeDownloads++;

        updateDownloadProgress(task.url, 'downloading', 0, null, null, task);

        chrome.downloads.download({
            url: task.url,
            filename: task.filename || (task.ext ? undefined : task.priorityExt),
            conflictAction: "uniquify"
        }, function (downloadId) {
            if (chrome.runtime.lastError) {
                updateDownloadProgress(task.url, 'failed', 0, chrome.runtime.lastError.message, null, task);
                activeDownloads--;
                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            } else {
                updateDownloadProgress(task.url, 'downloading', 0, null, downloadId, task);
            }
        });
    }
}

chrome.downloads.onChanged.addListener(function (delta) {
    chrome.downloads.search({ id: delta.id }, function (results) {
        if (!results || !results[0]) return;
        const download = results[0];
        const url = download.url;
        const existingTask = downloadProgress[url] ? downloadProgress[url].task : null;

        if (delta.state) {
            if (delta.state.current === 'complete') {
                updateDownloadProgress(url, 'completed', 100, null, delta.id, existingTask);
                downloadStats.downloaded++;
                activeDownloads--;

                // Only send updateStats if there are still active downloads
                // This prevents triggering startAutoRefresh when downloads are actually complete
                if (downloadProgressTabId && activeDownloads > 0) {
                    chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats }).catch(() => {
                        console.warn(manifest.name + ': Failed to send stats to progress tab');
                    });
                }

                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            } else if (delta.state.current === 'interrupted') {
                updateDownloadProgress(url, 'failed', 0, 'Download interrupted', delta.id, existingTask);
                activeDownloads--;
                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            }
        } else if (download.totalBytes > 0) {
            const progress = Math.round((download.bytesReceived / download.totalBytes) * 100);
            updateDownloadProgress(url, 'downloading', progress, null, delta.id, existingTask);
        }
    });
});

function calculateUrlHeuristicScore(url) {
    let score = 0;
    if (/\.(jpg|jpeg|png|gif|webp|mp4|webm|avi|mov)$/i.test(url)) score += 50;
    const dimensionMatch = url.match(/(\d{3,4})[x×](\d{3,4})/);
    if (dimensionMatch) {
        const width = parseInt(dimensionMatch[1]);
        const height = parseInt(dimensionMatch[2]);
        score += Math.min(width * height / 10000, 30);
    }
    if (/(?:original|full|large|master|raw|hd|high)/i.test(url)) score += 20;
    if (/(?:thumb|small|preview|mini|tiny)/i.test(url)) score -= 20;
    if (url.startsWith('https://')) score += 5;
    if (!url.includes('?')) score += 10;
    if (/\.(php|asp|jsp|cgi|do)/.test(url)) score -= 15;
    return score;
}

async function validateSingleUrlContent(url, referer, timeout = 2500) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            method: 'HEAD',
            headers: referer ? { 'Referer': referer } : {}
        });
        clearTimeout(timeoutId);
        if (response.status === 405 || response.status === 403 || response.status === 0) {
            // 405 Method Not Allowed, 403 Forbidden (sometimes works with GET), 0 (Opaque/CORS issue) -> retry with GET
            return validateSingleUrlContentGet(url, referer, timeout);
        }
        if (!response.ok) return { url, isValid: false, reason: `HTTP ${response.status}` };
        const contentType = response.headers.get('Content-Type') || '';
        const contentLength = parseInt(response.headers.get('Content-Length')) || 0;
        if (contentType.startsWith('text/html')) return { url, isValid: false, reason: 'HTML page' };
        const isValidMedia = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/');

        // If content-length is missing but type is valid, assume valid (common for some CDNs)
        if (isValidMedia && !contentLength) return { url, isValid: true, contentType, contentLength, reason: 'valid-no-length' };

        if (!isValidMedia && contentLength < 1024) return { url, isValid: false, reason: 'too small' };
        return { url, isValid: isValidMedia || contentLength > 1024, contentType, contentLength, reason: 'valid' };
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') return { url, isValid: false, reason: 'timeout' };
        return validateSingleUrlContentGet(url, referer, timeout); // Fallback to GET on network error too
    }
}

async function validateSingleUrlContentGet(url, referer, timeout = 3000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: referer ? { 'Referer': referer } : {}
        });
        clearTimeout(timeoutId);
        if (!response.ok) return { url, isValid: false, reason: `HTTP ${response.status}` };
        const contentType = response.headers.get('Content-Type') || '';
        const contentLength = parseInt(response.headers.get('Content-Length')) || 0;
        if (contentType.startsWith('text/html')) return { url, isValid: false, reason: 'HTML page' };
        const isValidMedia = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/');
        if (!isValidMedia && contentLength < 1024) return { url, isValid: false, reason: 'too small' };
        return { url, isValid: isValidMedia || contentLength > 1024, contentType, contentLength, reason: 'valid' };
    } catch (error) {
        clearTimeout(timeoutId);
        return { url, isValid: false, reason: 'network-error' };
    }
}

async function findBestUrlWithValidation(urlArray, referer) {
    const cleanUrlArray = urlArray.filter(url => typeof url === 'string' && url);
    if (cleanUrlArray.length === 0) return null;
    const recentFailureRate = urlValidationStats.recentFailures.length / 10;
    if (urlValidationStats.circuitBreakerOpen || recentFailureRate > 0.7) {
        const scored = cleanUrlArray.map(url => ({ url, score: calculateUrlHeuristicScore(url) })).sort((a, b) => b.score - a.score);
        return scored[0].url;
    }
    const scoredUrls = cleanUrlArray.map(url => ({ url, score: calculateUrlHeuristicScore(url) })).sort((a, b) => b.score - a.score);

    // Heuristic: if only one candidate, or top candidate is exceptionally good, skip validation
    if (scoredUrls.length === 1 || scoredUrls[0].score >= 70) return scoredUrls[0].url;

    // Limit candidates to validate to avoid long waits
    const candidatesToValidate = scoredUrls.slice(0, Math.min(3, scoredUrls.length));
    try {
        const results = await Promise.allSettled(candidatesToValidate.map(({ url }) => validateSingleUrlContent(url, referer, 2500)));
        const validUrls = results.filter(r => r.status === 'fulfilled' && r.value.isValid).map(r => r.value).sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0));
        urlValidationStats.totalValidations++;
        if (validUrls.length > 0) {
            urlValidationStats.successfulValidations++;
            urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-5);
            urlValidationStats.circuitBreakerOpen = false;
            return validUrls[0].url;
        }
        urlValidationStats.recentFailures.push(Date.now());
        urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-10);
        return scoredUrls[0].url;
    } catch (error) {
        urlValidationStats.recentFailures.push(Date.now());
        urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-10);
        if (urlValidationStats.recentFailures.length >= 8) {
            urlValidationStats.circuitBreakerOpen = true;
            setTimeout(() => { urlValidationStats.circuitBreakerOpen = false; }, 30000);
        }
        return scoredUrls[0].url;
    }
}

async function processUrlGroupsWithValidation(groups, referer) {
    console.info(manifest.name + ': Starting complex item analysis for ' + groups.length + ' groups');
    let processedGroups = 0;
    let foundUrls = 0;

    try {
        for (const group of groups) {
            if (!scanInProgress) break;

            processedGroups++;

            // Use sendMessage to update progress tab, fire-and-forget
            if (downloadProgressTabId) {
                chrome.tabs.sendMessage(downloadProgressTabId, {
                    cmd: 'updateStatus',
                    status: `Analyzing complex items (Phase 2): ${processedGroups}/${groups.length}...`,
                    done: false
                }).catch(() => { });
            }

            try {
                let timeoutId;
                const timeoutPromise = new Promise((resolve) => {
                    timeoutId = setTimeout(() => {
                        console.warn(manifest.name + ': Validation timed out for group:', group);
                        resolve(null);
                    }, 12000);
                });

                const validationPromise = findBestUrlWithValidation(group.urls, referer).finally(() => {
                    clearTimeout(timeoutId);
                });

                const bestUrl = await Promise.race([validationPromise, timeoutPromise]);

                console.info(manifest.name + `: Group processed. Best URL: ${bestUrl ? bestUrl : 'None'}. Group size: ${group.urls.length}`);
                if (bestUrl && !globalProcessedUrls.has(bestUrl) && !downloadProgress[bestUrl]) {
                    globalProcessedUrls.add(bestUrl);
                    foundUrls++;
                    const task = {
                        url: bestUrl,
                        referer: referer,
                        priorityExt: (bestUrl.match(/#([\da-z]{3,4})$/) || [])[1],
                        ext: { img: 'jpg', video: 'mp4', audio: 'mp3' }[((/.(?:m(?:4[abprv]|p[34])|og[agv]|webm)/.test(bestUrl)) ? 'video' : 'img')],
                        isFromArray: true,
                        originalArraySize: group.urls.length
                    };
                    filterQueue.push(task);
                    processFilterQueue();
                }
            } catch (error) {
                console.warn(manifest.name + ': Error during group validation:', error);
            }
        }
    } finally {
        scanInProgress = false;

        if (downloadInitiatorTabId) {
            // Optional completion signal (initiator tab might be gone or in finished state)
            chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'groupAnalysisComplete', processedCount: foundUrls })
                .catch(() => { /* Silent: handover expected */ });
        }

        checkAllQueuesEmpty();
    }
}
