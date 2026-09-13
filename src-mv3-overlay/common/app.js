"use strict";

let cfg;

window.catchEvent = {};
const app = {};
const platform = navigator.userAgent.includes('Firefox') ? "firefox" : "chrome";

function buildNodes(element, nodes) {
    if (!element || !Array.isArray(nodes)) {
        return;
    }

    if (!nodes.length) {
        return element;
    }

    const doc = element.ownerDocument;
    const fragment = doc.createDocumentFragment();

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node) continue;

        if (typeof node !== "string") {
            const element = doc.createElement(node.tag);

            if (node.attrs) {
                for (const attr in node.attrs) {
                    if (attr === "style") {
                        element.style.cssText = node.attrs[attr];
                    } else {
                        element.setAttribute(attr, node.attrs[attr]);
                    }
                }
            }

            if (node.nodes) {
                buildNodes(element, node.nodes);
            } else if (node.text) {
                element.textContent = node.text;
            }

            fragment.appendChild(element);
        } else {
            fragment.appendChild(doc.createTextNode(node));
        }
    }

    if (fragment.childNodes.length) {
        element.appendChild(fragment);
    }

    return element;
}

// Message event listener
window.addEventListener(
    "message",
    function (event) {
        if (event.data?.vdfDpshPtdhhd) {
            event.stopImmediatePropagation();
            catchEvent?.onmessage?.(event);
        }
    },
    true
);

// Keydown event listener
window.addEventListener(
    "keydown",
    function (event) {
        catchEvent?.onkeydown?.(event);
    },
    true
);

// Delivery accounting (2026-09-14). Every mass-download command is
// fire-and-forget (downloadMass, updateStatus, updateFilterStats,
// reportSkippedItem, scanDiagnostics), and D-5's wrapper deliberately swallows
// runtime.lastError so the console is not flooded with "The message port closed
// before a response was received". That silence also hid the one failure that
// matters: a message that was never DELIVERED at all — live 2026-09-13 21:09,
// the page found ~180 items and the worker took over 8, with the sender unable
// to tell. Classify it instead of ignoring it:
//
//   'no-receiver'   — nothing was listening (the worker was still booting or is
//                     gone): the message went NOWHERE, counted as a loss.
//   'context-gone'  — the extension was reloaded under the page: same, a loss.
//   'no-answer'     — the port closed before a response: the normal shape of
//                     every fire-and-forget command (a listener received it and
//                     answered nothing), so it is NOT a loss and must never be
//                     counted as one — otherwise the counter would read 100%
//                     on a perfectly healthy run.
//
// Pure function (no chrome API) so the harness EXECUTES it on real source text.
function mdClassifySendError(message) {
    const text = String(message == null ? '' : message);
    if (!text) return 'ok';
    if (text.indexOf('Receiving end does not exist') > -1) return 'no-receiver';
    if (text.indexOf('context invalidated') > -1) return 'context-gone';
    return 'no-answer';
}

// Port handling
const Port = {
    // Sent / not-delivered counters for the world this Port lives in. Reported
    // to the worker (see _sendScanDiagnostics in content.js) so the Saved Log
    // can answer "did the page's messages reach anyone?" — the question the
    // 21:09 log could not answer at all.
    stats: { sent: 0, failed: 0, lastError: '' },

    // Copy for a message payload: these counters keep moving, and a message is
    // serialized whenever the browser gets to it, not when it was created.
    snapshot: function () {
        return { sent: Port.stats.sent, failed: Port.stats.failed, lastError: Port.stats.lastError };
    },

    listen: function (callback) {
        if (this.listener) {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.removeListener(this.listener);
            }
        }

        if (typeof callback === "function") {
            if (platform === "firefox") {
                this.listener = function (message, sender) {
                    if (!sender) {
                        callback(message);
                    }
                };
            } else {
                this.listener = callback;
            }
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.addListener(this.listener);
            }
        } else {
            this.listener = null;
        }
    },

    send: async function (message, callback) {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
            return Promise.reject(new Error('Extension context invalidated'));
        }
        const handler = callback || Port.listener;
        Port.stats.sent++;
        if (!handler) {
            return chrome.runtime.sendMessage(message);
        }
        // D-5 (2026-09-12): every fire-and-forget command (downloadMass,
        // updateStatus, updateFilterStats, reportSkippedItem, stopScanning, …)
        // has no responder, so Chrome reports "Unchecked runtime.lastError: The
        // message port closed before a response was received" for each one —
        // noise that buries real errors in the extension console and in the
        // Saved Log. The wrapper is the same callback with ONE difference: it
        // reads runtime.lastError inside the callback (which is what suppresses
        // that report) and then forwards the response unchanged, so
        // request/response commands (resolve, cfg_get, get_file, getDownloadLog)
        // keep working exactly as before. Nothing else changes: Port.listener is
        // still resolved at call time, and the callback still receives the
        // single response argument it received from Chrome directly.
        let pending;
        try {
            pending = chrome.runtime.sendMessage(message, function (response) {
                let kind = 'ok';
                try {
                    kind = mdClassifySendError(chrome.runtime.lastError && chrome.runtime.lastError.message);
                } catch (e) { /* nothing to read */ }
                // Still swallowed (D-5 noise), but now counted: only the two
                // kinds that mean "nobody received this" count as a loss.
                if (kind === 'no-receiver' || kind === 'context-gone') {
                    Port.stats.failed++;
                    Port.stats.lastError = kind;
                }
                return handler(response);
            });
        } catch (e) {
            // A dead extension context throws synchronously instead of setting
            // lastError. Count it the same way, then behave exactly as before:
            // the caller sees the same rejection.
            Port.stats.failed++;
            Port.stats.lastError = 'context-gone';
            throw e;
        }
        return pending;
    },
};

async function readCfg() {
    let resp = await Port.send({ cmd: "cfg_get", keys: ["hz", "keys", "tls", "grants", "grantUrls", "da", "sieve", "sieveUpdateLast", "sieveRepository"] });

    if (!resp?.cfg) return;
    cfg = resp.cfg;
}

const shortcut = {
    keys1: {
        8: "BS",
        9: "Tab",
        27: "Esc",
        45: "Ins",
        46: "Del",
        96: "0",
        97: "1",
        98: "2",
        99: "3",
        100: "4",
        101: "5",
        102: "6",
        103: "7",
        104: "8",
        105: "9",
        106: "*",
        107: "+",
        109: "-",
        110: ".",
        111: "/",
        173: "-",
        186: ";",
        187: "=",
        188: ",",
        189: "-",
        190: ".",
        191: "/",
        192: "`",
        219: "[",
        220: "\\",
        221: "]",
        222: "'",
        112: "F1",
        113: "F2",
        114: "F3",
        115: "F4",
        116: "F5",
        117: "F6",
        118: "F7",
        119: "F8",
        120: "F9",
        121: "F10",
        122: "F11",
        123: "F12",
    },
    keys2: {
        13: "Enter",
        16: "shift",
        17: "ctrl",
        18: "alt",
        32: "Space",
        33: "PgUp",
        34: "PgDn",
        35: "End",
        36: "Home",
        37: "Left",
        38: "Up",
        39: "Right",
        40: "Down",
    },
    isModifier: function (e) {
        return e.which > 15 && e.which < 19;
    },
    key: function (e, simple) {
        if (e.button !== undefined && [1, 3, 4].includes(e.button)) {
            return "M" + e.button;
        }

        if (simple && e.which < 47 && !this.keys1[e.which]) return;

        return this.keys1[e.which] || (!simple && this.keys2[e.which]) || String.fromCharCode(e.which).toUpperCase();
    },
};