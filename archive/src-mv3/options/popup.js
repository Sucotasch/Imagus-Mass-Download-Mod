'use strict';

document.addEventListener('DOMContentLoaded', function () {
    const downloadBtn = document.getElementById('downloadAllBtn');
    const statusDiv = document.getElementById('status');

    downloadBtn.addEventListener('click', async function () {
        downloadBtn.disabled = true;
        statusDiv.textContent = 'Initializing mass download...';

        try {
            // Send to background script, which proxies to the content script.
            // Direct chrome.tabs.sendMessage from popup fails in Chrome MV3 because
            // content.js onMessage doesn't call sendResponse, closing the channel.
            chrome.runtime.sendMessage({ cmd: 'downloadAll' }, function (response) {
                if (chrome.runtime.lastError) {
                    statusDiv.textContent = 'Error: Could not connect to the page. Please refresh the page and ensure Developer Mode is on.';
                    downloadBtn.disabled = false;
                } else {
                    statusDiv.innerHTML = '<span style="color: green;">Scan initiated!</span> Opening progress tab...';
                    setTimeout(window.close, 2000);
                }
            });
        } catch (err) {
            statusDiv.textContent = 'Error: ' + err.message;
            downloadBtn.disabled = false;
        }
    });

    // Listen for status updates from content script or background
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.cmd === 'updateStatus') {
            statusDiv.textContent = request.status;
            if (request.done) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'Start New Scan';
            }
        }
    });
});
