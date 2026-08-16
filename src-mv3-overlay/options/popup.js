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
                    // Audit N-10: the popup never receives updateStatus (the SW
                    // pushes status only to the progress tab) and it closes
                    // itself below — constant string via textContent.
                    statusDiv.textContent = 'Scan initiated! Opening progress tab...';
                    setTimeout(window.close, 2000);
                }
            });
        } catch (err) {
            statusDiv.textContent = 'Error: ' + err.message;
            downloadBtn.disabled = false;
        }
    });
});
