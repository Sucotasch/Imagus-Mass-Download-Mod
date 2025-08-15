'use strict';

(function() {
  // DOM elements
  const progressBody = document.getElementById('progressBody');
  const totalFilesEl = document.getElementById('totalFiles');
  const completedFilesEl = document.getElementById('completedFiles');
  const pendingFilesEl = document.getElementById('pendingFiles');
  const failedFilesEl = document.getElementById('failedFiles');
  const refreshBtn = document.getElementById('refreshBtn');
  const clearBtn = document.getElementById('clearBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  
  // State management
  let downloadItems = {};
  let downloadStats = {
    total: 0,
    completed: 0,
    pending: 0,
    failed: 0,
    skipped: 0
  };
  
  // Handle status response from background script
  function handleStatusResponse(response) {
    if (response && response.items) {
        const newItems = response.items;
        downloadItems = {}; // Clear the old list to ensure a fresh start
        for (const id in newItems) {
            // Process each item through the standard update function
            // to ensure a consistent object structure (including the 'id' property).
            updateDownloadItem(newItems[id]);
        }
        updateDisplay();
    }
  }

  let refreshIntervalId = null;

  // Initialize
  function init() {
    // Create status element if it doesn't exist
    let scanStatusEl = document.getElementById('scanStatus');
    if (!scanStatusEl) {
        scanStatusEl = document.createElement('p');
        scanStatusEl.id = 'scanStatus';
        scanStatusEl.style.textAlign = 'center';
        scanStatusEl.style.fontSize = '1.1em';
        document.querySelector('h1').insertAdjacentElement('afterend', scanStatusEl);
    }

    const cancelAllBtn = document.getElementById('cancelAllBtn');

    // Set up event listeners
    refreshBtn.addEventListener('click', refreshDisplay);
    clearBtn.addEventListener('click', clearCompleted);
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAll);
    }
    if (cancelAllBtn) {
        cancelAllBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ cmd: 'cancelAllDownloads' });
        });
    }
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(handleMessage);
    
    // Request initial download status
    refreshDisplay();

    // Set up auto-refresh every 2 seconds
    if (refreshIntervalId) clearInterval(refreshIntervalId); // Clear previous interval if any
    refreshIntervalId = setInterval(refreshDisplay, 2000);
  }
  
  // Handle messages from background script
  function handleMessage(request, sender, sendResponse) {
    if (request.cmd === 'downloadProgress') {
      updateDownloadItem(request.data);
      updateDisplay();
      sendResponse({status: 'ok'});
    } else if (request.cmd === 'updateStatus') {
        const scanStatusEl = document.getElementById('scanStatus');
        if (scanStatusEl) {
            scanStatusEl.textContent = request.status;
            if(request.done) {
                setTimeout(() => { scanStatusEl.textContent = '' }, 10000);
            }
        }
    } else if (request.cmd === 'allDownloadsComplete') {
        if (refreshIntervalId) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
        }
    }
  }
  
  // Update a download item
  function updateDownloadItem(data) {
    const id = data.url || data.id;
    if (!id) return;
    
    if (!downloadItems[id]) {
      downloadItems[id] = {
        id: id,
        url: data.url,
        status: 'pending',
        progress: 0,
        fileName: getFileNameFromUrl(data.url),
        fileType: getFileType(data.url),
        error: null,
        timestamp: Date.now()
      };
    }
    
    // Update item properties
    Object.assign(downloadItems[id], data);
    
    // Update stats
    updateStats();
  }
  
  // Update statistics
  function updateStats() {
    const items = Object.values(downloadItems);
    downloadStats.total = items.length;
    downloadStats.completed = items.filter(item => item.status === 'completed').length;
    downloadStats.pending = items.filter(item => item.status === 'pending' || item.status === 'scanning' || item.status === 'downloading').length;
    downloadStats.failed = items.filter(item => item.status === 'failed' || item.status === 'canceled').length;
    downloadStats.skipped = items.filter(item => item.status === 'skipped').length;
  }
  
  // Update the display
  function updateDisplay() {
    updateStats();
    updateStatsDisplay();
    renderTable();
  }
  
  // Update statistics display
  function updateStatsDisplay() {
    totalFilesEl.textContent = downloadStats.total;
    completedFilesEl.textContent = downloadStats.completed;
    pendingFilesEl.textContent = downloadStats.pending;
    failedFilesEl.textContent = downloadStats.failed;
  }
  
  // Render the table
  function renderTable() {
    const items = Object.values(downloadItems);
    
    if (items.length === 0) {
      progressBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            No downloads in progress. Start a download to see progress here.
          </td>
        </tr>
      `;
      return;
    }
    
    // Sort by timestamp (newest first)
    items.sort((a, b) => b.timestamp - a.timestamp);
    
    progressBody.innerHTML = items.map(item => `
      <tr data-id="${item.id}">
        <td>
          <div class="thumbnail">
            ${getThumbnail(item)}
          </div>
        </td>
        <td style="word-break: break-all;">
          <div><strong>${item.fileName}</strong></div>
          <div class="file-info">${item.url}</div>
          <div class="file-info">${item.fileType.toUpperCase()}</div>
        </td>
        <td>
          <span class="status-badge status-${item.status}">${getStatusText(item.status)}</span>
          ${item.error ? `<div class="error-details">${item.error}</div>` : ''}
        </td>
        <td>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${item.progress || 0}%"></div>
          </div>
          <div class="file-info">${item.progress || 0}%</div>
        </td>
        <td>
          ${(item.status === 'failed' || item.status === 'canceled') ? `<button class="retry-btn" data-id="${item.id}">Retry</button>` : ''}
        </td>
      </tr>
    `).join('');
    
    // Add event listeners to retry buttons
    document.querySelectorAll('.retry-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = this.getAttribute('data-id');
        if (id) {
          retryDownload(id);
        } else {
          console.error('Cannot retry: id is undefined');
        }
      });
    });
  }
  
  // Get thumbnail based on file type
  function getThumbnail(item) {
    if (item.fileType === 'image') {
      return `<img src="${item.url}" alt="Preview" style="width:100%;height:100%;object-fit:cover;">`;
    } else if (item.fileType === 'video') {
      return '🎬';
    } else {
      return '📄';
    }
  }
  
  // Get file name from URL
  function getFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.split('/').pop();
      return fileName || 'unnamed';
    } catch (e) {
      return 'unnamed';
    }
  }
  
  // Get file type from URL
  function getFileType(url) {
    if (/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(url)) {
      return 'image';
    } else if (/\.(mp4|webm|ogg|avi|mov)$/i.test(url)) {
      return 'video';
    } else if (/\.(mp3|wav|ogg)$/i.test(url)) {
      return 'audio';
    } else {
      return 'file';
    }
  }
  
  // Get status text
  function getStatusText(status) {
    const statusMap = {
      'pending': 'Pending',
      'scanning': 'Scanning',
      'skipped': 'Skipped',
      'downloading': 'Downloading',
      'completed': 'Completed',
      'failed': 'Failed',
      'canceled': 'Canceled'
    };
    return statusMap[status] || status;
  }
  
  // Refresh display
  function refreshDisplay() {
    chrome.runtime.sendMessage({cmd: 'getDownloadStatus'}, handleStatusResponse);
  }
  
  // Clear completed downloads
  function clearCompleted() {
    chrome.runtime.sendMessage({ cmd: 'clearCompletedDownloads' });
    // For immediate UI feedback, we can clear locally and refresh.
    // The next full refresh will sync with the background state anyway.
    Object.keys(downloadItems).forEach(id => {
        const item = downloadItems[id];
        if (item.status === 'completed') {
            delete downloadItems[id];
        }
    });
    updateDisplay();
  }

  // Clear all downloads
  function clearAll() {
    chrome.runtime.sendMessage({ cmd: 'clearAllDownloads' });
    downloadItems = {};
    updateDisplay();
  }
  
  // Retry a failed download
  function retryDownload(id) {
    const item = downloadItems[id];
    if (item) { // No longer checks for item.task
      // Reset UI status immediately
      item.status = 'pending';
      item.progress = 0;
      item.error = null;
      item.timestamp = Date.now();
      
      // Send whatever we have. The background script will figure it out.
      const retryMessage = {
        cmd: 'retryDownload',
        task: item.task, // This might be null, which is fine
        url: item.url,   // Always send the URL as a fallback
        referer: item.referer || (item.task && item.task.referer) // Send referer if available
      };
      
      chrome.runtime.sendMessage(retryMessage);
      
      updateDisplay();
    }
  }
  
  // Initialize when DOM is loaded
  document.addEventListener('DOMContentLoaded', init);
})();