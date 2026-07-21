'use strict';

(function () {
    // DOM elements
    const progressBody = document.getElementById('progressBody');
    const totalFilesEl = document.getElementById('totalFiles');
    const completedFilesEl = document.getElementById('completedFiles');
    const failedFilesEl = document.getElementById('failedFiles');
    const canceledFilesEl = document.getElementById('canceledFiles');
    const statsFoundEl = document.getElementById('stats-found');
    const statsFilteredEl = document.getElementById('stats-filtered');
    const refreshBtn = document.getElementById('refreshBtn');
    const clearBtn = document.getElementById('clearBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const cancelAllBtn = document.getElementById('cancelAllBtn');

    // State management
    let downloadItems = {};

    // Handle status response from background script
    function handleStatusResponse(response) {
        if (response) {
            if (response.items) {
                const newItems = response.items;
                downloadItems = {};
                for (const id in newItems) {
                    updateDownloadItem(newItems[id]);
                }
            }
            if (response.stats) {
                updateGlobalStats(response.stats);
            }
            updateDisplay();
        }
    }

    let refreshIntervalId = null;

    // Initialize
    function init() {
        // Set up event listeners
        refreshBtn.addEventListener('click', refreshDisplay);
        clearBtn.addEventListener('click', clearCompleted);
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', clearAll);
        }
        if (cancelAllBtn) {
            cancelAllBtn.addEventListener('click', () => {
                chrome.runtime.sendMessage({ cmd: 'stopScanning' });
            });
        }

        // Listen for messages from background script
        chrome.runtime.onMessage.addListener(handleMessage);

        // Register with background and request status
        chrome.runtime.sendMessage({ cmd: 'registerProgressTab' });
        refreshDisplay();

        // Don't start auto-refresh immediately - let background push updates
        // Only refresh if we detect stale data
    }

    // Handle messages from background script
    function handleMessage(request, sender, sendResponse) {
        if (request.cmd === 'ping') {
            // Respond to ping for tab validation
            sendResponse({ pong: true });
            return true;
        } else if (request.cmd === 'updateStatus') {
            const scanStatusEl = document.getElementById('scanStatus');
            if (scanStatusEl) {
                scanStatusEl.textContent = request.status;
                if (request.done) {
                    setTimeout(() => { scanStatusEl.textContent = '' }, 10000);
                }
            }
            if (request.items) {
                for (const url in request.items) {
                    updateDownloadItem(request.items[url]);
                }
                updateDisplay();
            }
            if (request.stats) {
                updateGlobalStats(request.stats);
            }
        } else if (request.cmd === 'allDownloadsComplete') {
            // Stop auto-refresh when all downloads complete
            stopAutoRefresh();
            const scanStatusEl = document.getElementById('scanStatus');
            if (scanStatusEl) {
                scanStatusEl.textContent = 'All downloads completed';
                setTimeout(() => { scanStatusEl.textContent = ''; }, 5000);
            }
        } else if (request.cmd === 'updateStats') {
            updateGlobalStats(request.stats);
            // Auto-refresh logic is now state-dependent in handleMessage/updateDownloadStatus
        } else if (request.cmd === 'updateDownloadStatus') {
            updateDownloadItem(request);
            updateDisplay();

            // Only start refresh if the new status is active
            if (['pending', 'scanning', 'downloading'].includes(request.status)) {
                startAutoRefresh();
            }
        } else if (request.cmd === 'resetForNewDownload') {
            // Clear UI for tab reuse
            downloadItems = {};
            updateDisplay();
            const scanStatusEl = document.getElementById('scanStatus');
            if (scanStatusEl) {
                scanStatusEl.textContent = '';
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

        // Cap records to prevent unbounded growth
        const maxRecords = 100;
        const keys = Object.keys(downloadItems);
        if (keys.length > maxRecords) {
            const sorted = keys.sort((a, b) => {
                const sa = downloadItems[a], sb = downloadItems[b];
                const order = { completed: 0, skipped: 1, failed: 2, canceled: 3, scanning: 4, downloading: 5, pending: 6 };
                const da = order[sa.status] ?? 7, db = order[sb.status] ?? 7;
                return da - db || (sa.timestamp || 0) - (sb.timestamp || 0);
            });
            const toRemove = sorted.slice(0, keys.length - maxRecords);
            toRemove.forEach(k => delete downloadItems[k]);
        }
    }

    // Calculate and display summary stats from the items table
    function calculateAndDisplaySummaryStats() {
        const items = Object.values(downloadItems);
        const skipped = items.filter(item => item.status === 'skipped').length;
        const completed = items.filter(item => item.status === 'completed').length;
        const failed = items.filter(item => item.status === 'failed').length;
        const canceled = items.filter(item => item.status === 'canceled').length;

        // "To Download" total should not include skipped files
        totalFilesEl.textContent = items.length - skipped;
        completedFilesEl.textContent = completed;
        failedFilesEl.textContent = failed;
        canceledFilesEl.textContent = canceled;

        // Final terminal state check: if nothing is active, stop refresh
        const activeCount = items.filter(item => ['pending', 'scanning', 'downloading'].includes(item.status)).length;
        if (activeCount === 0) {
            stopAutoRefresh();
        }
    }

    // Update the global stats display (found, filtered)
    function updateGlobalStats(stats) {
        if (stats.found !== undefined) statsFoundEl.textContent = stats.found;
        if (stats.filtered !== undefined) statsFilteredEl.textContent = stats.filtered;
    }

    // Update the entire display
    function updateDisplay() {
        calculateAndDisplaySummaryStats();
        renderTable();
    }

    // Render the table
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

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
      <tr data-id="${escapeHtml(item.id)}">
        <td>
          <div class="thumbnail">
            ${getThumbnail(item)}
          </div>
        </td>
        <td style="word-break: break-all;">
          <div><strong>${escapeHtml(item.fileName)}</strong></div>
          <div class="file-info"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a></div>
          <div class="file-info">${escapeHtml(item.fileType.toUpperCase())}</div>
        </td>
        <td>
          <span class="status-badge status-${escapeHtml(item.status)}">${escapeHtml(getStatusText(item.status))}</span>
          ${item.error ? `<div class="error-details">${escapeHtml(item.error)}</div>` : ''}
        </td>
        <td>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${item.progress || 0}%"></div>
          </div>
          <div class="file-info">${item.progress || 0}%</div>
        </td>
        <td>
          ${(item.status === 'failed' || item.status === 'canceled') ? `<button class="retry-btn" data-id="${escapeHtml(item.id)}">Retry</button>` : ''}
        </td>
      </tr>
    `).join('');

        document.querySelectorAll('.retry-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.getAttribute('data-id');
                if (id) retryDownload(id);
            });
        });
    }

    function getThumbnail(item) {
        if (item.fileType === 'image') {
            return `<img loading="lazy" decoding="async" src="${escapeHtml(item.url)}" alt="Preview" style="width:100%;height:100%;object-fit:cover;">`;
        } else if (item.fileType === 'video') {
            return '🎬';
        } else {
            return '📄';
        }
    }

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

    function getFileType(url) {
        if (/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(url)) return 'image';
        if (/\.(mp4|webm|ogg|avi|mov)$/i.test(url)) return 'video';
        if (/\.(mp3|wav|ogg)$/i.test(url)) return 'audio';
        return 'file';
    }

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

    function startAutoRefresh() {
        if (!refreshIntervalId) {
            console.log('Starting auto-refresh (active downloads detected)');
            refreshIntervalId = setInterval(refreshDisplay, 2000);
        }
    }

    function stopAutoRefresh() {
        if (refreshIntervalId) {
            console.log('Stopping auto-refresh (no active downloads)');
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
        }
    }

    function refreshDisplay() {
        chrome.runtime.sendMessage({ cmd: 'getDownloadStatus' }, handleStatusResponse);
    }

    function clearCompleted() {
        chrome.runtime.sendMessage({ cmd: 'clearCompletedDownloads' });
        Object.keys(downloadItems).forEach(id => {
            if (downloadItems[id].status === 'completed') delete downloadItems[id];
        });
        updateDisplay();
    }

    function clearAll() {
        chrome.runtime.sendMessage({ cmd: 'clearAllDownloads' });
        downloadItems = {};
        updateDisplay();
    }

    function retryDownload(id) {
        const item = downloadItems[id];
        if (item) {
            item.status = 'pending';
            item.progress = 0;
            item.error = null;
            item.timestamp = Date.now();
            chrome.runtime.sendMessage({
                cmd: 'retryDownload',
                url: item.url,
                referer: item.referer || (item.task && item.task.referer)
            });
            updateDisplay();
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
