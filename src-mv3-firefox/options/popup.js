'use strict';

document.addEventListener('DOMContentLoaded', function () {
    const downloadBtn = document.getElementById('downloadAllBtn');
    const statusDiv = document.getElementById('status');

    downloadBtn.addEventListener('click', async function () {
        downloadBtn.disabled = true;
        statusDiv.textContent = 'Initializing mass download...';

        try {
            // In Firefox MV3, we cannot reliably send messages from popup to USER_SCRIPT world directly.
            // We send it to the background script, which will proxy it to the content script.
            chrome.runtime.sendMessage({ cmd: 'downloadAll' }, function (response) {
                if (chrome.runtime.lastError) {
                    statusDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
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
