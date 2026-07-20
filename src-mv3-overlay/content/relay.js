// Firefox-only content script
// Listens for messages from the background script and relays them to the user script context

"use strict";

chrome.runtime.onMessage.addListener(function(message) {
    window.postMessage({ vdfDpshPtdhhd: "relay", message: message }, "*");
});
