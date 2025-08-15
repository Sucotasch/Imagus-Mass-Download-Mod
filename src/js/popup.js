'use strict';

document.addEventListener('DOMContentLoaded', function() {
  const downloadBtn = document.getElementById('downloadAllBtn');
  const statusDiv = document.getElementById('status');

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.cmd === 'updateStatus') {
      
      if (request.done) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Process Finished';
        setTimeout(window.close, 3000);
      }
    }
  });

  downloadBtn.addEventListener('click', function() {
    downloadBtn.disabled = true;
    

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { cmd: 'downloadAll' }, function(response) {
                if (chrome.runtime.lastError) {
                    statusDiv.textContent = 'Error: Could not connect. Please reload the page and try again.';
                    downloadBtn.disabled = false;
                }
            });
        }
    });
  });
});
