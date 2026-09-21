"use strict";

var manifest = chrome.runtime.getManifest();
var cachedSieveRes = [],
    cachedPrefs = {};

// === MASS DOWNLOAD ===
importScripts('../mass-download/service-init.js', '../mass-download/service-core.js', '../mass-download/md-dnr.js');

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
    "PREFERENCES": "", "CANNOT_FIND_URL": "", "ADD_TO_IGNORE_LIST": "", "COPY_URL": ""
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

// Which URL a sieve attempt reads. Pure, so the contract can be executed by the
// smoke test instead of described in a comment.
//
// Why it exists (2026-09-21, live console after a full Chrome restart): the mirror
// URL used to be computed only while `useMirror` was false, but the fallback
// re-enters updateSieve WITH useMirror=true - so the retry reached `url = null` and
// threw "No sieve repository configured" instead of fetching, one line into the
// catch that was supposed to save the update. The throw sits before the try, so it
// escaped as an unhandled rejection, and the jsDelivr mirror had therefore never
// actually fetched anything.
function sieveUrlFor(local, useMirror, sieveRepoUrl) {
    if (local) return "/data/sieve.json";
    if (useMirror) return jsDelivrMirror(sieveRepoUrl) || sieveRepoUrl || null;
    return sieveRepoUrl || null;
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

    // The mirror URL must be known on BOTH attempts: it is the retry's whole point.
    const mirrorUrl = local ? null : jsDelivrMirror(sieveRepoUrl);
    const url = sieveUrlFor(local, useMirror, sieveRepoUrl);
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

// ---------------------------------------------------------------------------
// D-1 (2026-09-12) — E-Hentai|Exhentai gallery pagination hardening.
//
// The bundled rule for e-hentai /g/ walks up to 50 gallery pages with a
// SYNCHRONOUS XHR (xhr.open('GET', link, false)). One failing page throws out of
// res() and the exception aborts that element's whole resolve chain. A timeout
// is NOT an option: assigning xhr.timeout on a sync request throws
// InvalidAccessError by specification, so the request would fail harder, not
// softer.
//
// The guard is applied HERE — at the single point where the rule text becomes
// executable (the body is handed to the page as req_res and compiled there) —
// instead of as a duplicate `_`-prefixed rule with the upstream one switched
// off. Three consequences, all wanted: the rule list the user sees is unchanged;
// a weekly sieve update cannot undo the guard; there is exactly one E-Hentai
// rule to keep working. The patch is anchored on exact upstream text, so if
// upstream ever reformats the rule the anchors stop matching, nothing is
// patched, and a warning names the rule instead of shipping broken JS.
// ---------------------------------------------------------------------------
const MD_SIEVE_RES_MARK = '/* D-1 hardened */';
const MD_SIEVE_RES_PATCHES = {
    'E-Hentai|Exhentai-x-q-p': [
        [
            "function processLink(link) {\n  const xhr = new XMLHttpRequest();\n  xhr.open('GET', link, false);\n  xhr.send();",
            "function processLink(link) {\n  " + MD_SIEVE_RES_MARK + "\n  try {\n  const xhr = new XMLHttpRequest();\n  xhr.open('GET', link, false);\n  xhr.send();"
        ],
        [
            "  if (matches) {\n  res.push([matches[1]]);\n  }\n}",
            "  if (matches) {\n  res.push([matches[1]]);\n  }\n  } catch (e) { return; }\n}"
        ]
    ]
};

function hardenSieveRes(ruleName, res) {
    const patches = MD_SIEVE_RES_PATCHES[ruleName];
    if (!patches || typeof res !== 'string') return res;
    if (res.indexOf(MD_SIEVE_RES_MARK) !== -1) return res; // already hardened
    let patched = res;
    for (const p of patches) {
        if (patched.indexOf(p[0]) === -1) {
            console.warn(manifest.name + ': sieve hardening (D-1) NOT applied to ' + ruleName
                + ' — the rule text changed upstream; re-check the sync-XHR guard in data/sieve.json');
            return res;
        }
        patched = patched.replace(p[0], p[1]);
    }
    console.info(manifest.name + ': sieve rule "' + ruleName + '" hardened (D-1): a failed gallery page no longer aborts the album');
    return patched;
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
                    rule.res = hardenSieveRes(ruleName, rule.res); // D-1
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
            // Fix E: hotlink CDNs (i.pximg.net) 403 SW-initiated downloads
            // — declarativeNetRequest session rules substitute the Referer
            // the gate wants. Best-effort, registry-scoped (md-dnr.js).
            // handleMessage is sync (returns true to hold the channel);
            // fire-and-forget ensure here, and the authoritative gate is
            // in the alterDownload interrupt hook (onChanged below) which
            // re-ensures + retries once before giving up.
            mdDnrEnsureForTask(msg);
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

            // GEN-4: bounded (see MD_RESOLVE_FETCH_MS). The chain below already
            // answers 'no match' on failure, so an abort is a normal outcome.
            const resolveController = new AbortController();
            const resolveTimeoutId = setTimeout(() => resolveController.abort(), MD_RESOLVE_FETCH_MS);
            const resolveInflightId = mdInflightStart('resolve fetch', msg.url, MD_RESOLVE_FETCH_MS);
            const mdResolveSettled = function () {
                clearTimeout(resolveTimeoutId);
                mdInflightEnd(resolveInflightId);
            };

            fetch(msg.url, {
                method: postData ? "POST" : "GET",
                body: postData,
                headers: postData ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
                signal: resolveController.signal,
            })
                .then((fetchResp) => {
                    const contentType = fetchResp.headers.get("Content-Type");
                    if (/^(image|video|audio)\//i.test(contentType)) {
                        data.m = msg.url;
                        data.noloop = true;
                        console.warn(chrome.runtime.getManifest().name + ": rule " + data.params.rule.id + " matched against an image file");
                        mdResolveSettled();
                        context.postMessage(data);
                        return null;
                    }
                    return fetchResp.text();
                })
                .then((body) => {
                    mdResolveSettled();
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
                    mdResolveSettled();
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
        // The page says it is alive but still walking its own DOM queue (see
        // mdAskInitiatorToResume / mdProbeInitiatorTab): answers the bounded
        // resume window without ending it as "no one home".
        case 'resumeGroupAnalysisAck':
            mdResumeAck();
            break;
        case 'updateStatus':
            handleUpdateStatus(msg);
            break;
        case 'updateFilterStats':
            handleUpdateFilterStats(msg);
            break;
        // Scan diagnostics (2026-09-13): the page's walk counters/spans, printed
        // by the Saved Log next to the worker's own phase spans.
        case 'scanDiagnostics':
            handleScanDiagnostics(msg);
            break;
        case 'reportSkippedItem':
            handleReportSkippedItem(msg);
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
                    // Unfinished work at save time: every other number here counts
                    // what is DONE, so a stalled queue and a finished session look
                    // alike (see mdPendingSnapshot in mass-download/service-core.js).
                    pending: mdPendingSnapshot(),
                    // Where the time went (phases) and where the items died
                    // (counters) — null when the session produced no diagnostics.
                    scanDiagnostics: mdScanDiagnosticsForLog(),
                    // 2026-09-21 (duplicate hunt): the UNCAPPED terminal ledger.
                    // The item table below is capped at da.maxProgressRecords (the
                    // 10:34 run shipped 100 of 296 rows), and the dropped rows are
                    // exactly where the evidence for the ' (1)' duplicates lived.
                    outcomes: mdOutcomesForLog(),
                    version: chrome.runtime.getManifest().version,
                    sessionStart: sessionStartTime,
                    // Worker identity: lets Save Log prove "the worker answering
                    // never opened this session" (state lost on restart). See
                    // mdRecordWorkerStart/workerMarker in service-core.js.
                    worker: workerMarker(),
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
    }
}

async function deinitTabs() {
    const tabs = await chrome.tabs.query({ url: "<all_urls>" });
    for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { cmd: "reinit" }).catch(() => {});
    }
}

function sanitizeFilename(filename) {
    // Replace invalid chars (\ / : * ? " < > |) + control chars
    let s = filename.replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, "_");
    // Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) — any
    // extension after the reserved name is ignored by the OS, and a bare
    // reserved name without extension causes a download error. Rename by
    // prefixing with an underscore so the file is still visible.
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(s)) {
        s = '_' + s;
    }
    // Trailing dots and spaces are silently stripped by Windows (NTFS), which
    // can lead to collisions or hidden files. Replace them explicitly.
    s = s.replace(/[. ]+$/, '_');
    // NTFS max component length: 255 code points. Trim before that.
    if (s.length > 255) s = s.slice(0, 255);
    return s;
}

// Port of upstream 8.20 saveDir templates ({page_domain}/{link_domain}/{Y}{M}{D}).
// Hardening vs upstream issues #134/#69: every path segment is sanitized and
// stripped of trailing dots/spaces (Windows), unreplaced placeholders become
// "unknown", empty segments are dropped.
function getDownloadDirectory(msg) {
    let dir = (cachedPrefs?.hz?.saveDir ?? "").trim();
    if (!dir) return "";

    // upstream 9.6: domains are computed in the content script (lowercase) and
    // arrive as three fields — page/link/file. The SW no longer derives
    // link_domain from msg.url (that was the link's target, not the link).
    if (msg.pageDomain) {
        dir = dir.replace(/\{page_domain\}/gi, msg.pageDomain);
    }
    if (msg.linkDomain) {
        dir = dir.replace(/\{link_domain\}/gi, msg.linkDomain);
    }
    if (msg.fileDomain) {
        dir = dir.replace(/\{file_domain\}/gi, msg.fileDomain);
    }

    const now = new Date();
    dir = dir.replace(/\{Y\}/gi, now.getFullYear());
    dir = dir.replace(/\{M\}/gi, String(now.getMonth() + 1).padStart(2, "0"));
    dir = dir.replace(/\{D\}/gi, String(now.getDate()).padStart(2, "0"));

    dir = dir.replace(/^[/.]+/, "").replace(/\/+$/, "");
    dir = dir.replace(/\{[^}]+\}/g, "unknown");

    dir = dir.split("/")
        .map(seg => sanitizeFilename(seg).replace(/[. ]+$/, ""))
        .filter(Boolean)
        .join("/");
    return dir;
}

function getFilenameFromUrl(url) {
    try {
        const pathname = new URL(url).pathname;
        return pathname.substring(pathname.lastIndexOf("/") + 1) || undefined;
    } catch (_) {
        return undefined;
    }
}

// GEN-4 (2026-09-14): an UNBOUNDED request in the worker is a documented hard
// kill — Chrome terminates a service worker whose fetch() response takes more
// than 30 seconds to arrive — and the dying worker leaves no record of it (all
// of the live 2026-09-13 generations ended 'abrupt': no onSuspend, no error).
// This HEAD runs in the DOWNLOAD path (handleDownloadMass -> filename), i.e.
// after the scan, on the very hosts that are already rate-limiting us: exactly
// where a hang lands. The cap only ever costs a filename — getFilenameFromUrl
// is the caller's next attempt.
const MD_FILENAME_HEAD_MS = 5000;
// The sieve resolver (case 'resolve', res:1 rules) fetched page bodies with no
// cap at all. The content side gives up after da.resolutionTimeout (8 s by
// default) and nobody is waiting for the answer any more, while the worker kept
// the request open — the 30 s kill path above, with no symptom at all until the
// whole session restarted. 20 s stays under Chrome's limit and far above a page
// that is actually alive.
const MD_RESOLVE_FETCH_MS = 20000;

async function getFilenameFromHeaders(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MD_FILENAME_HEAD_MS);
    const inflightId = mdInflightStart('HEAD (filename)', url, MD_FILENAME_HEAD_MS);
    try {
        const resp = await fetch(url, { method: "HEAD", signal: controller.signal });
        const match = /filename[^;=\n]*=["']?([^"';\n]*)/.exec(resp.headers.get("Content-Disposition") || "");
        return match?.[1];
    } catch (_) {
        return undefined;
    } finally {
        clearTimeout(timeoutId);
        mdInflightEnd(inflightId);
    }
}

const downloadItems = {};
async function download(msg, tab, sendResponse) {
    if (!msg.url) return;

    const ext = msg.priorityExt ?? msg.ext;

    let filename =
        msg.filename && ext
            ? `${msg.filename}.${ext}`
            : msg.filename || msg.urlName;

    // Port of upstream 8.20 saveDir (plan WP-2 / decision Р1): the directory
    // is prefixed into params.filename directly on BOTH platforms — no
    // chrome.downloads.onDeterminingFilename, which upstream used on Chrome
    // and which intercepted all browser downloads (#132), broke domain
    // directories (#134) and renames (#69).
    // Upstream 9.6: the directory takes three domain fields
    // (pageDomain/linkDomain/fileDomain) — all computed in the content script.
    const dir = getDownloadDirectory(msg);
    if (dir && !filename) {
        filename = await getFilenameFromHeaders(msg.url) || getFilenameFromUrl(msg.url);
    }
    if (filename && dir) {
        filename = `${dir}/${sanitizeFilename(filename)}`;
    } else if (filename) {
        filename = sanitizeFilename(filename);
    }

    // Audit U-02: keep the object URL so it can be revoked once the download
    // reaches a terminal state (see onChanged below). SAVE-1: msg._offscreenObjectUrl
    // is the single-save offscreen retry's payload — a blob: URL created in the
    // offscreen document (mdSaveViaOffscreen, mass-download/service-core.js),
    // already materialized, so nothing is created for it here. It is CONSUMED here
    // on purpose: if this download is refused too, the page-fetch fallback re-enters
    // this function with the same msg object, and it must then download msg.url (the
    // page's fresh blob), not a stale — by then revoked — offscreen URL.
    const objectUrl = msg.blob ? URL.createObjectURL(msg.blob) : (msg._offscreenObjectUrl || null);
    delete msg._offscreenObjectUrl;
    const params = {
        url: objectUrl || msg.url,
        filename: filename || undefined,
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
// NOTE: upstream 8.20 routes saveDir renaming through
// chrome.downloads.onDeterminingFilename — deliberately NOT ported: the
// listener fires for every browser download and broke download managers /
// domain directories / renames (upstream issues #132/#134/#69). We prefix
// the directory into params.filename instead (see download() above).

chrome.downloads.onChanged.addListener(function (delta) {
    const msg = downloadItems[delta.id];
    if (!msg) return;

    // Audit U-02/U-03: clean up entries and object URLs on terminal states;
    // cancel/erase get callbacks so chrome.runtime.lastError stays checked.
    const cleanup = () => {
        if (msg._objectUrlScope === 'offscreen') {
            // The offscreen document is the only context that can revoke a URL it
            // created — same routing as the mass path (releaseDownloadSlot).
            mdOffscreenRevokeObjectUrl(msg._objectUrl);
        } else if (msg._objectUrl) {
            URL.revokeObjectURL(msg._objectUrl);
        }
        delete downloadItems[delta.id];
    };

    if (delta.state?.current === "complete") {
        cleanup();
        return;
    }

    // USER_* errors are user-initiated (cancel via the downloads UI) — do not
    // fall back to the page-context retry for them (upstream 8.20 behavior).
    if ((delta.error && !delta.error.current?.startsWith("USER_")) || /\.html?$/.exec(delta.filename?.current)) {
        // calceling download of HTML files, most probably an error page
        // NF-8 (2026-09-12): consume runtime.lastError in both callbacks — a
        // completed/cancelled item (or an already-erased one) makes these fail
        // routinely, and an unread lastError is logged by Chrome as
        // "Unchecked runtime.lastError".
        chrome.downloads.cancel(delta.id, () => {
            if (chrome.runtime.lastError) { /* already finished */ }
        });
        chrome.downloads.erase({ id: delta.id }, () => {
            if (chrome.runtime.lastError) { /* already erased */ }
        });

        // request alternative download method
        // One verdict per downloadId: `state` and `error` arrive as separate
        // deltas, and the offscreen attempt below is asynchronous — the entry has
        // to leave downloadItems NOW, or a second delta would start a SECOND
        // attempt (and a second page-fetch fallback beside it).
        cleanup();

        const fallBackToPageFetch = () => {
            msg.alterDownload = true;
            // Fix E (pixiv 403, 2026-09-10): a SERVER_FORBIDDEN interrupt on a
            // registry host means the rule was not yet installed when the
            // download started (popup-save before any scan) — ensure it now so
            // the alterDownload fetch below passes the gate. Registry-scoped,
            // idempotent; non-registry hosts are untouched.
            mdDnrEnsureForTask(msg);
            if (typeof msg.sendResponse === "function") msg.sendResponse(msg);
        };

        // SAVE-1 (2026-09-21, plan §D2): the fallback above asks the PAGE for the
        // bytes, which a Referer-gated CDN can never satisfy — i.pximg.net sends no
        // CORS headers, so the page-context fetch dies with "Failed to fetch" and
        // the user gets an alert and no file (measured; log/
        // `Pixiv imagus-mass-download-log-2026-09-11T18-28-25.txt`). For those
        // hosts only — registry-scoped, and only after Chrome itself refused the
        // download — the extension-origin offscreen document fetches instead (no
        // CORS, and the DNR rule supplies the Referer). Every other case, and any
        // failure or refusal inside the attempt, lands in the old path unchanged.
        mdSaveViaOffscreen(msg).then(function (handled) {
            if (!handled) fallBackToPageFetch();
        });
        // chrome.tabs.sendMessage(msg.tabId, msg);
    }
});


function keepAlive() {
    // keep the service worker alive
    setInterval(chrome.runtime.getPlatformInfo, 25_000);
}

let optionsOpened = false;

// The badge title, restored the moment user scripts are registered again.
const MD_ACTION_TITLE = manifest.name + " v" + manifest.version + "\nClick to toggle on this site";
// Retry gate for the self-heal below: 0 = nothing to heal.
let mdUsRetryAt = 0;

// 2026-09-21 — "why did it stop working?" after a browser restart.
//
// On Chrome 138+ the "Allow User scripts" toggle lives on the extension's OWN
// details page, and when it is off chrome.userScripts is simply undefined: the
// content scripts this extension is made of never register, and NOTHING says so.
// A live probe (ext-dev-loop, Edge 153, fresh profile) showed exactly that state:
// "chrome.userScripts API not available - user scripts will not be registered".
//
// The console warning alone is not enough: the owner had to open the extension's
// settings by hand to discover the cause, which means a first-time user meets a
// dead extension and no reason to keep it. So the missing API now does what a
// first install already does - opens the options page, whose banner deep-links to
// the toggle - once per BROWSER SESSION (chrome.storage.session, cleared exactly
// at the restart that re-evaluates the grant), plus a title the user can read by
// hovering the toolbar icon without opening anything.
async function mdWarnUserScriptsMissing(why) {
    console.warn(manifest.name + ": " + why);
    mdUsRetryAt = Date.now() + 30_000;
    try {
        // 2026-09-21: the wording is per-platform, because this branch is reachable on
        // Firefox too (measured live, 155.0.1: with userScripts declared optional and
        // not granted, this notice opened the options page). Firefox has no Details
        // page and no "Allow user scripts" toggle — the grant is requested on our own
        // options page, whose banner already branches on `platform` — so telling a
        // Firefox user to find a Chrome toggle is worse than saying nothing.
        const usHint = platform === "firefox"
            ? "open the extension's settings and enable the User Scripts permission"
            : "open Details and enable \"Allow user scripts\"";
        chrome.action.setTitle({ title: manifest.name + ": user scripts are OFF - " + usHint });
    } catch {}
    let already = optionsOpened;
    try {
        const got = await cfg.sessionGet("mdUsOptionsOpened");
        already = already || !!got?.mdUsOptionsOpened;
        if (!got?.mdUsOptionsOpened) await cfg.sessionSet({ mdUsOptionsOpened: true });
    } catch {}
    if (!already) {
        optionsOpened = true;
        console.info(manifest.name + ": opening the options page - the user has to allow user scripts for this extension to work at all");
        chrome.runtime.openOptionsPage().catch(() => {});
    }
}

async function registerContentScripts() {
    if (!chrome.userScripts) {
        mdWarnUserScriptsMissing("chrome.userScripts API not available - user scripts will not be registered");
        return;
    }
    try {
        await chrome.userScripts.configureWorld({ csp: "script-src 'self' 'unsafe-eval'", messaging: true });

        // NOTE: the onUserScriptMessage listener is NOT registered here. A user
        // script reaches the worker ONLY through that dedicated event (the
        // userScripts docs: "they don't use onMessage"), and this function runs
        // after an awaited chrome.storage.local.get — so registering it here
        // left the worker deaf to its own page for the whole boot window and
        // every downloadMass sent in it vanished without a trace. It is
        // registered synchronously at the top level now, next to onMessage.
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
        mdUsRetryAt = 0;
        try { chrome.action.setTitle({ title: MD_ACTION_TITLE }); } catch {}
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
    // Guard (upstream hardening): a tab closed between the tabs.get/update
    // event and the badge call rejects the promise — unhandled
    // "No tab with id" noise in the SW console.
    if (grantsIsBlocked(tabUrl)) {
        chrome.action.setBadgeText({ text: "X", tabId: tabId }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({color: "#ff8080ff", tabId: tabId }).catch(() => {});
        chrome.action.setBadgeTextColor({ color: "#FFF", tabId: tabId }).catch(() => {});
    } else {
        chrome.action.setBadgeText({ text: "", tabId: tabId }).catch(() => {});
    }
}

// disable/enable Imagus on icon click
chrome.action.onClicked.addListener(toggleTab);

// update badge on tab update
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    // Self-heal for a toggle that was off when this worker booted: the user flips
    // "Allow user scripts", and their next page load re-registers the scripts -
    // no extension reload required. Throttled to one attempt per 30 s, and armed
    // only while the API was missing the last time we looked.
    if (mdUsRetryAt && Date.now() >= mdUsRetryAt) {
        mdUsRetryAt = 0;
        registerContentScripts();
    }
    if (!tab.active) return;
    updateBadge(tabId, tab.url);
});

// update badge on tab activation
chrome.tabs.onActivated.addListener(async function(info) {
    try {
        updateBadge(info.tabId, (await chrome.tabs.get(info.tabId)).url);
    } catch (e) {}
});


chrome.action.setTitle({ title: MD_ACTION_TITLE });
updatePrefs(null, registerContentScripts);
chrome.runtime.onStartup.addListener(updatePrefs);
// Diagnostic companion to the worker marker (mdRecordWorkerStart in
// service-core.js): a browser start is the one event that clears
// chrome.storage.session, i.e. the only legitimate reason for the worker start
// counter to fall back to 1. Without this line a reset counter and a fresh
// death look identical in the log.
chrome.runtime.onStartup.addListener(function () {
    console.info(manifest.name + ': browser session started — worker start history reset (storage.session cleared)');
});
// Fix E (pixiv 403): DNR session rules live across SW restarts — re-mark
// the in-memory registry state from the live session rules so a resumed
// SW does not re-install them blindly (idempotent either way).
mdDnrRearm();
chrome.runtime.onInstalled.addListener(function (e) {
    // An unpacked reload reports 'update' too, so this line also marks the
    // deliberate reloads that discard the in-memory session — otherwise a
    // reload-induced empty state reads as a crash in the logs.
    console.info(manifest.name + ': extension (re)loaded — onInstalled reason: ' + e.reason);
    // FIX-7: a deliberate reload/update discards the recoverable mass-download
    // session instead of resurrecting it — a reload is the user's decision, not
    // a crash. (Chrome also clears storage.session on reload/update; this covers
    // Firefox, where session storage is only cleared when the browser stops.)
    mdDropSessionSnapshot();
    if (e.reason === "update") {
        registerContentScripts();
        // upstream 9.6 (ce1072b): add the "C" (copy URL) toolbar button for
        // users migrating from the 8.20 line. We match the whole line with
        // startsWith because our releases are 2026.8.20.9/.10, not the
        // literal "2026.8.20" upstream compares against.
        if (e.previousVersion?.startsWith("2026.8.20")) {
            cfg.get("hz", ({ hz }) => {
                if (hz?.toolbarButtons && !hz.toolbarButtons.includes("C")) {
                    const b = ['O', 'S', 'G'].find(c => hz.toolbarButtons.includes(c));
                    if (b) {
                        hz.toolbarButtons = hz.toolbarButtons.replace(b, b + "C");
                    } else {
                        hz.toolbarButtons += "C";
                    }
                    updatePrefs({ hz });
                }
            });
        }
    } else if (e.reason === "install") {
        chrome.runtime.openOptionsPage();
    }
});
chrome.runtime.onMessage?.addListener(onMessage);
// A user script's message is delivered to onUserScriptMessage ONLY (the
// dedicated handler — see the userScripts docs), so this listener must be
// registered SYNCHRONOUSLY at the top level, exactly like onMessage above.
// Live 2026-09-13 21:09: the page found ~180 items while the worker took over 8
// — the old registration lived at the end of the async registerContentScripts(),
// i.e. beyond an awaited chrome.storage.local.get, and everything the page sent
// during that boot window was dropped silently (the sender cannot tell, see
// Port.send in common/app.js).
chrome.runtime.onUserScriptMessage?.addListener(onMessage);

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
