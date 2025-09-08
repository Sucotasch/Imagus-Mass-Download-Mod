/* global app, cfg, Tabs, Port, to_fromHistory */
'use strict';

var prefs_, sieveResLocal;
var downloadReferers = {};
var downloadInitiatorTabId = null;

// Queues and flags
var filterQueue = [];
var downloadQueue = [];
var activeFilters = 0;
var activeDownloads = 0;
var scanInProgress = false;

// Download progress tracking
var downloadProgress = {};
var downloadStats = { found: 0, filtered: 0, downloaded: 0 };
var downloadProgressTabId = null;

// URL Selection and Validation Global Variables
var globalProcessedUrls = new Set(); // For deduplication across phases
var urlValidationStats = {
	totalValidations: 0,
	successfulValidations: 0,
	recentFailures: [],
	circuitBreakerOpen: false
};

function checkAllQueuesEmpty() {
    if (filterQueue.length === 0 && downloadQueue.length === 0 && activeFilters === 0 && activeDownloads === 0) {
        if (downloadProgressTabId) {
            chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'allDownloadsComplete' }, function() {
                if (chrome.runtime.lastError) {
                    downloadProgressTabId = null;
                }
            });
        }
    }
}

function forceAllComplete() {
    if (downloadProgressTabId) {
        chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'allDownloadsComplete' }).catch(() => { downloadProgressTabId = null; });
    }
}

function processFilterQueue() {
    let maxConcurrentFilters = (prefs_ && prefs_.da && prefs_.da.maxConcurrentFilters) || 5;
    if (maxConcurrentFilters === 0) {
        maxConcurrentFilters = Infinity;
    }

    while (activeFilters < maxConcurrentFilters && filterQueue.length > 0) {
        const task = filterQueue.shift();
        activeFilters++;

        updateDownloadProgress(task.url, 'scanning', 0, null, null, task);

        const excludedExtensions = ((prefs_ && prefs_.da && prefs_.da.excludedExtensions) || '.png, .svg').split(',').map(s => s.trim().toLowerCase());
        const minImageSize = ((prefs_ && prefs_.da && prefs_.da.minImageSize) || 45) * 1024;
        const minVideoSize = ((prefs_ && prefs_.da && prefs_.da.minVideoSize) || 2) * 1024 * 1024;
        const downloadOnUnknown = (prefs_ && prefs_.da) ? prefs_.da.downloadOnUnknown : true;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        // Step 1: Attempt HEAD Request
        fetch(task.url, { method: 'HEAD', signal: controller.signal, headers: { 'Referer': task.referer || '' } })
            .then(response => {
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
                    return Promise.reject('stop');
                }

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
                }
            })
            .catch(error => {
                clearTimeout(timeoutId);
                if (error === 'stop' || !scanInProgress) {
                    return; // Controlled stop, not a real error
                }

                // Step 2: Fallback to GET Request
                return fetch(task.url, { headers: { 'Referer': task.referer || '' } })
                    .then(response => {
                        if (!scanInProgress) return Promise.reject('Scan canceled');
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        
                        const contentType = response.headers.get('Content-Type') || '';
                        if (contentType.startsWith('text/html')) {
                            updateDownloadProgress(task.url, 'failed', 0, 'Server returned HTML page', null, task);
                            return Promise.reject('HTML page');
                        }
                        return response.blob();
                    })
                    .then(blob => {
                        if (!scanInProgress) return;

                        const size = blob.size;
                        const type = blob.type;
                        const urlExtension = (task.url.match(/\.[^.?#]+/) || [''])[0].toLowerCase();

                        if (excludedExtensions.includes(urlExtension) || excludedExtensions.includes(type)) {
                            updateDownloadProgress(task.url, 'skipped', 0, 'Excluded type', null, task);
                            return;
                        }

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
                        }
                    })
                    .catch(getError => {
                        if (getError.name !== 'AbortError' && getError !== 'Scan canceled' && getError !== 'HTML page') {
                            updateDownloadProgress(task.url, 'failed', 0, 'Filter error: ' + getError.message, null, task);
                        }
                    });
            })
            .finally(() => {
                activeFilters--;
                processFilterQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            });
    }
}

function processDownloadQueue() {
    let maxConcurrentDownloads = (prefs_ && prefs_.da && prefs_.da.maxConcurrentDownloads) || 3;
    if (maxConcurrentDownloads === 0) {
        maxConcurrentDownloads = Infinity;
    }
	while (activeDownloads < maxConcurrentDownloads && downloadQueue.length > 0) {
		const task = downloadQueue.shift();
		activeDownloads++;
		if (task.referer) {
			downloadReferers[task.url] = {
				referer: task.referer,
				timestamp: Date.now()
			};
		}
		
		updateDownloadProgress(task.url, 'downloading', 0, null, null, task);
		
		if (typeof window.saveURI === 'function') {
			window.saveURI({
				url: task.url,
				priorityExt: task.priorityExt,
				ext: task.ext,
				isPrivate: task.isPrivate
			});
		} else if (typeof chrome !== 'undefined' && chrome.downloads) {
			try {
				chrome.downloads.download({
					url: task.url,
					filename: task.ext ? undefined : task.priorityExt
				}, function(downloadId) {
					if (chrome.runtime.lastError) {
						updateDownloadProgress(task.url, 'failed', 0, chrome.runtime.lastError.message, null, task);
						activeDownloads--;
						processDownloadQueue();
						setTimeout(checkAllQueuesEmpty, 100);
					} else {
                        updateDownloadProgress(task.url, 'downloading', 0, null, downloadId, task);
					}
				});
			} catch (e) {
				updateDownloadProgress(task.url, 'failed', 0, e.message, null, task);
				activeDownloads--;
				processDownloadQueue();
			}
		}
	}
}

chrome.downloads.onChanged.addListener(function(delta) {
    if (delta.state) {
        if (delta.state.current === 'complete') {
            chrome.downloads.search({id: delta.id}, function(results) {
                if (results && results[0]) {
                    const url = results[0].url;
                    // Try to find the task in our downloadProgress
                    const existingTask = downloadProgress[url] ? downloadProgress[url].task : null;
                    updateDownloadProgress(url, 'completed', 100, null, delta.id, existingTask);
                    
                    downloadStats.downloaded++;
                    if (downloadProgressTabId) {
                        chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats });
                    }
                }
                activeDownloads--;
                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            });
        } else if (delta.state.current === 'interrupted') {
            chrome.downloads.search({id: delta.id}, function(results) {
                if (results && results[0]) {
                    const url = results[0].url;
                    // Try to find the task in our downloadProgress
                    const existingTask = downloadProgress[url] ? downloadProgress[url].task : null;
                    updateDownloadProgress(url, 'failed', 0, 'Download interrupted', delta.id, existingTask);
                }
                activeDownloads--;
                processDownloadQueue();
                setTimeout(checkAllQueuesEmpty, 100);
            });
        }
    }
    
    if (delta.bytesReceived || delta.totalBytes) {
        chrome.downloads.search({id: delta.id}, function(results) {
            if (results && results[0]) {
                const download = results[0];
                if (download.totalBytes > 0) {
                    const progress = Math.round((download.bytesReceived / download.totalBytes) * 100);
                    updateDownloadProgress(download.url, 'downloading', progress);
                }
            }
        });
    }
});

RegExp.escape = function(s) {
	return s.replace(/[/\\^$-.+*?|(){}[\]]/g, '\\$&');
};

var withBaseURI = function(base, link, addProtocol) {
	if ( link[1] === '/' && link[0] === '/' ) {
		if ( addProtocol ) {
			return base.slice(0, base.indexOf(':') + 1) + link;
		}
		return link;
	}
	if ( /^[\\w-]{2,20}:/i.test(link) ) {
		return link;
	}
	return base.replace(
		link[0] === '/'
			? /(\/\/[^/]+)\/.*/
			: /(\/)[^/]*(?:[?#].*)?$/,
		'$1'
	) + link;
};

var updateSieve = function(localUpdate, callback) {
	// Если не указано явно и настройки не загружены - используем локальное обновление
	if (localUpdate === undefined) {
		localUpdate = !prefs_ || !prefs_.tls;
	}
	
	var newSieve;
	var xhr = new XMLHttpRequest;

	var onStoredSieveReady = function(items) {
		var localSieve = items.sieve;

		if ( localSieve ) {
			var rule;
			var tempSieve = {};

			for ( rule in localSieve ) {
				if ( rule === 'dereferers' ) {
					break;
				}
				if ( !newSieve[rule] ) {
					tempSieve[rule] = localSieve[rule];
				}
			}

			for ( rule in newSieve ) {
				tempSieve[rule] = newSieve[rule];
			}

			newSieve = tempSieve;
		}

		updatePrefs({sieve: newSieve}, function() {
			if ( typeof callback === 'function' ) {
				callback(newSieve);
			}
		});

		console.info(
			app.name
				+ ': Sieve updated from '
				+ (localUpdate ? 'local' : 'remote') + ' repository.'
		);
	};

	xhr.onload = function() {
		this.onload = null;

		try {
			if (!localUpdate && (this.status !== 200 || !this.responseText)) {
				throw new Error('HTTP ' + this.status);
			}

			newSieve = JSON.parse(this.responseText);
			cfg.get('sieve', onStoredSieveReady);
		} catch (ex) {
			console.warn(
				app.name + ': Sieve failed to update from '
					+ (localUpdate ? 'local' : 'remote') + ' repository! | ',
				ex.message
			);

			if (callback) {
				callback(null);
			}
		}
	};

	xhr.onerror = function() {
		console.warn(app.name + ': Network error while updating sieve');
		if (callback) {
			callback(null);
		}
	};

	xhr.overrideMimeType('application/json;charset=utf-8');
	
	// Use repository URL from preferences for online update
	var sieveURL;
	if (localUpdate) {
		sieveURL = withBaseURI(document.baseURI, 'sieve.jsn');
	} else {
		// Проверяем наличие настроек и URL репозитория
		if (!prefs_ || !prefs_.tls) {
			console.warn(app.name + ': Preferences not initialized yet');
			if (callback) {
				callback(null);
			}
			return;
		}
		
		// Используем URL из настроек или настроек по умолчанию
		sieveURL = prefs_.sieveRepository || "https://raw.githubusercontent.com/kuzn123/Imagus-Sieve-RuBoard/master/update.txt";
	}
		
	xhr.open('GET', sieveURL, true);
	xhr.send(null);
};

var cacheSieve = function(newSieve) {
	if(typeof newSieve === 'string') {
		if (newSieve === '') {
			newSieve = {};
		} else {
			newSieve = JSON.parse(newSieve);
		}
	} else {
		newSieve = JSON.parse(JSON.stringify(newSieve));
	}

	var cachedSieve = [];
	sieveResLocal = [];

	for (var ruleName in newSieve) {
		var rule = newSieve[ruleName];

		if (!rule.link && !rule.img || rule.img && !rule.to && !rule.res) {
			continue;
		}

		try {
			if (rule.off) {
				throw ruleName + ' is off';
			}

			if (rule.res) {
				if (/^:\n/.test(rule.res)) {
					sieveResLocal[cachedSieve.length] = rule.res.slice(2);
					rule.res = 1;
				} else {
					if (rule.res.indexOf('\n') > -1) {
						var lines = rule.res.split('\n+');
						rule.res = RegExp(lines[0]);

						if (lines[1]) {
							rule.res = [rule.res, RegExp(lines[1])];
						}
					} else {
						rule.res = RegExp(rule.res);
					}

					sieveResLocal[cachedSieve.length] = rule.res;
					rule.res = true;
				}
			}
		} catch (ex) {
			if (typeof ex === 'object') {
				console.error(ruleName, rule, ex);
			} else {
				console.info(ex);
			}

			continue;
		}

		if (rule.to && rule.to.indexOf('\n') > 0 && rule.to.indexOf(':\n') !== 0) {
			rule.to = rule.to.split('\n');
		}

		delete rule.note;
		cachedSieve.push(rule);
	}

	prefs_.sieve = cachedSieve;
};

var updatePrefs = function(sentPrefs, callback) {
	if (!sentPrefs) {
		sentPrefs = {};
	}

	var defPrefs;
	var onStoredPrefsReady = function(items) {
		var needToUpdate, key, pref;
		var newPrefs = {};
		var itemsToStore = {};

		for (key in defPrefs) {
			needToUpdate = false;

			if (typeof defPrefs[key] === 'object') {
				newPrefs[key] = sentPrefs[key] || items[key] || defPrefs[key];
				needToUpdate = true;

				if (!Array.isArray(defPrefs[key])) {
					for (pref in defPrefs[key]) {
						if (newPrefs[key][pref] === void 0
							|| typeof newPrefs[key][pref] !== typeof defPrefs[key][pref]) {
							newPrefs[key][pref] = (!prefs_ || prefs_[key][pref] === void 0 ? defPrefs : prefs_)[key][pref];
						}
					}
				}
			} else {
				pref = sentPrefs[key] || items[key] || defPrefs[key];

				if (typeof pref !== typeof defPrefs[key]) {
					pref = defPrefs[key];
				}

				if (!prefs_ || prefs_[key] !== pref) {
					needToUpdate = true;
				}

				newPrefs[key] = pref;
			}

			if ( needToUpdate || items[key] === void 0 ) {
				itemsToStore[key] = newPrefs[key];
			}
		}

		prefs_ = newPrefs;

		if (newPrefs.grants) {
			pref = newPrefs.grants || [];
			var grants = [];

			for (key = 0; key < pref.length; ++key) {
				if (pref[key].op === ';') {
					continue;
				}

				grants.push({
					op: pref[key].op,
					url: pref[key].op.length === 2
						? RegExp(pref[key].url, 'i')
						: pref[key].url
				});
			}

			if (grants.length) {
				prefs_.grants = grants;
			}
		}

		if ( sentPrefs.sieve ) {
			itemsToStore.sieve = typeof sentPrefs.sieve === 'string'
				? JSON.parse(sentPrefs.sieve)
				: sentPrefs.sieve;
			cacheSieve(itemsToStore.sieve);
		}

		cfg.set(itemsToStore, function() {
			if ( !sentPrefs.sieve ) {
				cfg.get('sieve', function(prefs) {
					if ( prefs.sieve ) {
						cacheSieve(prefs.sieve);
					} else {
						updateSieve(true);
					}
				});
			}

			if ( typeof callback === 'function' ) {
				callback();
			}
		});
	};

	defPrefs = new XMLHttpRequest;
	defPrefs.overrideMimeType('application/json;charset=utf-8');
	defPrefs.open('GET', withBaseURI(document.baseURI, 'defaults.jsn'), true);
	defPrefs.onload = function() {
		this.onload = null;
		defPrefs = JSON.parse(defPrefs.responseText);
		cfg.get(Object.keys(defPrefs), onStoredPrefsReady);
	};
	defPrefs.send(null);
};

// URL Selection and Validation Functions

// Heuristic scoring for URL quality assessment
function calculateUrlHeuristicScore(url) {
	let score = 0;
	
	// Media file extensions (high priority)
	if (/\.(jpg|jpeg|png|gif|webp|mp4|webm|avi|mov)$/i.test(url)) {
		score += 50;
	}
	
	// Dimension indicators in URL
	const dimensionMatch = url.match(/(\d{3,4})[x×](\d{3,4})/);
	if (dimensionMatch) {
		const width = parseInt(dimensionMatch[1]);
		const height = parseInt(dimensionMatch[2]);
		score += Math.min(width * height / 10000, 30); // Cap at +30
	}
	
	// Quality indicators
	if (/(?:original|full|large|master|raw|hd|high)/i.test(url)) {
		score += 20;
	}
	if (/(?:thumb|small|preview|mini|tiny)/i.test(url)) {
		score -= 20;
	}
	
	// Protocol preference
	if (url.startsWith('https://')) {
		score += 5;
	}
	
	// Clean URLs (no query params often indicate direct files)
	if (!url.includes('?')) {
		score += 10;
	}
	
	// Penalize script-like URLs
	if (/\.(php|asp|jsp|cgi|do)/.test(url)) {
		score -= 15;
	}
	
	return score;
}

// Validate single URL using current version's proven approach
async function validateSingleUrlContent(url, referer, timeout = 3000) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);
	
	try {
		// Use same approach as current filtering: full fetch
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { 'Referer': referer }
		});
		
		clearTimeout(timeoutId);
		
		if (!response.ok) {
			return { 
				url, 
				isValid: false, 
				reason: `HTTP ${response.status}`,
				contentType: '',
				contentLength: 0
			};
		}
		
		const contentType = response.headers.get('Content-Type') || '';
		const contentLength = parseInt(response.headers.get('Content-Length')) || 0;
		
		// Check for HTML error pages (same as current version)
		if (contentType.startsWith('text/html')) {
			return { 
				url, 
				isValid: false, 
				reason: 'HTML page',
				contentType,
				contentLength
			};
		}
		
		// Validate media content
		const isValidMedia = contentType.startsWith('image/') || 
						   contentType.startsWith('video/') || 
						   contentType.startsWith('audio/');
		
		// For unknown types, check content size
		if (!isValidMedia && contentLength < 1024) {
			return { 
				url, 
				isValid: false, 
				reason: 'too small',
				contentType,
				contentLength
			};
		}
		
		return {
			url,
			isValid: isValidMedia || contentLength > 1024,
			contentType,
			contentLength,
			reason: 'valid'
		};
		
	} catch (error) {
		clearTimeout(timeoutId);
		return { 
			url, 
			isValid: false, 
			reason: error.name === 'AbortError' ? 'timeout' : 'network-error',
			contentType: '',
			contentLength: 0
		};
	}
}

// Find best URL from array using hybrid approach
async function findBestUrlWithValidation(urlArray, referer) {
    if (!urlArray || urlArray.length === 0) {
        return null;
    }

    // Filter out invalid entries and create a clean array of URLs
    const cleanUrlArray = urlArray.filter(url => typeof url === 'string' && url);
    if (cleanUrlArray.length === 0) {
        return null;
    }

	// Check circuit breaker
	const recentFailureRate = urlValidationStats.recentFailures.length / 10;
	if (urlValidationStats.circuitBreakerOpen || recentFailureRate > 0.7) {
		console.warn('[URL Selection] Circuit breaker open, using heuristic only');
		// Fall back to heuristic selection
		const scored = cleanUrlArray.map(url => ({
			url,
			score: calculateUrlHeuristicScore(url)
		})).sort((a, b) => b.score - a.score);
		
		return scored.length > 0 ? scored[0].url : null;
	}
	
	// Pre-filter with heuristics
	const scoredUrls = cleanUrlArray.map(url => ({
		url: url,
		score: calculateUrlHeuristicScore(url)
	})).sort((a, b) => b.score - a.score);
	
	// Limit validation to top candidates
	const candidatesToValidate = scoredUrls.slice(0, Math.min(5, scoredUrls.length));
	
	try {
		// Validate in parallel with timeout protection
		const validationPromises = candidatesToValidate.map(({ url }) => 
			validateSingleUrlContent(url, referer, 1500)
		);
		
		const results = await Promise.allSettled(validationPromises);
		
		// Process results
		const validUrls = results
			.filter(r => r.status === 'fulfilled' && r.value.isValid)
			.map(r => r.value)
			.sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0));
		
		// Update statistics
		urlValidationStats.totalValidations++;
		if (validUrls.length > 0) {
			urlValidationStats.successfulValidations++;
			// Clear recent failures on success
			urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-5);
			urlValidationStats.circuitBreakerOpen = false;
			
			return validUrls[0].url;
		}
		
		// No valid URLs found, record failure and use heuristic fallback
		urlValidationStats.recentFailures.push(Date.now());
		urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-10);
		
		console.warn('[URL Selection] No valid URLs found, using heuristic fallback');
		return scoredUrls.length > 0 ? scoredUrls[0].url : null;
		
	} catch (error) {
		// Record failure
		urlValidationStats.recentFailures.push(Date.now());
		urlValidationStats.recentFailures = urlValidationStats.recentFailures.slice(-10);
		
		// Open circuit breaker if too many recent failures
		if (urlValidationStats.recentFailures.length >= 8) {
			urlValidationStats.circuitBreakerOpen = true;
			setTimeout(() => {
				urlValidationStats.circuitBreakerOpen = false;
			}, 30000); // 30 second circuit breaker
		}
		
		console.warn('[URL Selection] Validation failed, using heuristic fallback:', error);
		return scoredUrls.length > 0 ? scoredUrls[0].url : null;
	}
}

// Main group processing function
async function processUrlGroupsWithValidation(groups, referer) {
	let processedGroups = 0;
	let foundUrls = 0;
	
	for (const group of groups) {
		try {
			const bestUrl = await findBestUrlWithValidation(group.urls, referer);
			
			if (bestUrl) {
				if (!globalProcessedUrls.has(bestUrl) && !downloadProgress[bestUrl]) {
					globalProcessedUrls.add(bestUrl);
					foundUrls++;
					
					// Create task using same structure as single URLs
					const task = {
						url: bestUrl,
						referer: referer,
						priorityExt: (bestUrl.match(/#([\da-z]{3,4})$/) || [])[1],
						ext: {
							img: 'jpg',
							video: 'mp4',
							audio: 'mp3'
						}[((/.(?:m(?:4[abprv]|p[34])|og[agv]|webm)/.test(bestUrl)) ? 'video' : 'img')],
						isFromArray: true,
						originalArraySize: group.urls.length
					};
					
					// Use existing filtering pipeline
					filterQueue.push(task);
					processFilterQueue();
				}
			}
		} catch (error) {
			console.warn('[URL Group Processing] Error processing group:', error);
			// Continue with next group
		}
		
		processedGroups++;
		
		// Send progress updates
		if (downloadProgressTabId) {
			chrome.tabs.sendMessage(downloadProgressTabId, {
				cmd: 'updateStatus',
				status: `Analyzing complex items: ${processedGroups}/${groups.length}...`,
				done: false
			}, function(response) {
				if (chrome.runtime.lastError) {
					downloadProgressTabId = null;
				}
			});
		}
		
		// Rate limiting to prevent server overload
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	
	// Signal completion back to content script
	chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
		if (tabs[0]) {
			chrome.tabs.sendMessage(tabs[0].id, {
				cmd: 'groupAnalysisComplete',
				processedCount: foundUrls,
				totalGroups: processedGroups
			}, function(response) {
				if (chrome.runtime.lastError) {
					console.log('Content script may have been unloaded');
				}
			});
		}
	});
}

var onMessage = function(ev, origin, postMessage) {
	var msg, e;

	if (origin === null) {
		msg = ev;
	} else {
		e = Port.parse_msg(ev, origin, postMessage);
		msg = e.msg;
	}

	if (!msg.cmd) {
		return;
	}

	switch (msg.cmd) {
		case 'hello':
			var i, l, grants,
				blockaccess = false,
				sitePrefs = {
					hz: prefs_.hz,
					sieve: prefs_.sieve,
					tls: prefs_.tls,
					keys: prefs_.keys,
					da: prefs_.da
				};

			if (prefs_.grants) {
				grants = prefs_.grants;

				for (i = 0, l = grants.length; i < l; ++i) {
					if (grants[i].url === '*' 
						|| (grants[i].op[1] && grants[i].url.test(e.origin))
						|| e.origin.indexOf(grants[i].url) > -1) {
						blockaccess = grants[i].op[0] === '!' ? true : false;
					}
				}
			}

			e.postMessage({
				cmd: 'hello',
				prefs: blockaccess ? null : sitePrefs
			});
			break;

		case 'cfg_get':
			if (!Array.isArray(msg.keys)) {
				msg.keys = [msg.keys];
			}

			cfg.get(msg.keys, function(items) {
				e.postMessage({cfg: items});
			});
			break;

		case 'cfg_del':
			if (!Array.isArray(msg.keys)) {
				msg.keys = [msg.keys];
			}
			cfg.remove(msg.keys);
			break;

		case 'getLocaleList':
			var lxhr = new XMLHttpRequest;
			lxhr.overrideMimeType('application/json;charset=utf-8');
			lxhr.open('GET', withBaseURI(document.baseURI, 'locales.jsn'), true);
			lxhr.onload = function() {
				this.onload = null;
				e.postMessage(this.responseText);
			};
			lxhr.send(null);
			break;

		case 'savePrefs':
			updatePrefs(msg.prefs);
			break;

		case 'update_sieve':
			updateSieve(false, function(newSieve) {
				if (newSieve) {
					e.postMessage({updated_sieve: newSieve});
				} else {
					// If online update fails, try local update
					updateSieve(true, function(newSieve) {
						e.postMessage({updated_sieve: newSieve});
					});
				}
			});
			break;

		        case 'downloadMass':
			if (globalProcessedUrls.has(msg.url)) {
				break;
			}
			globalProcessedUrls.add(msg.url);
			filterQueue.push({
				url: msg.url,
				referer: msg.referer,
				priorityExt: msg.priorityExt,
				ext: msg.ext,
				isPrivate: e.isPrivate
			});
			processFilterQueue();
			break;
		
		case 'updateFilterStats':
			downloadStats.found = msg.found;
			downloadStats.filtered = msg.filtered;
			if (downloadProgressTabId) {
				chrome.tabs.sendMessage(downloadProgressTabId, { cmd: 'updateStats', stats: downloadStats });
			}
			break;
		
		case 'downloadProgressUpdate':
			updateDownloadProgress(msg.data.url, msg.data.status, msg.data.progress);
			break;

		case 'history':
			if (typeof to_fromHistory === 'function' && !e.isPrivate) {
				to_fromHistory(msg.url, msg.manual);
			}
			break;

		case 'open':
			if (!Array.isArray(msg.url)) {
				msg.url = [msg.url];
			}

			msg.url.forEach(function(url) {
				if ( !url || typeof url !== 'string' ) {
					return;
				}

				var params = {
					url: url,
					active: !msg.nf
				};

				if ( origin && origin.tab && origin.tab.id ) {
					params.openerTabId = origin.tab.id;
				}

				try {
					Tabs.create(params);
				} catch ( ex ) {
					delete params.openerTabId;
					Tabs.create(params);
				}
			});
			break;

		case 'updateStatus':
			chrome.runtime.sendMessage(msg);
			break;

		case 'resolveAndDownloadGroups':
			// Process URL groups asynchronously
			processUrlGroupsWithValidation(msg.groups, msg.referer);
			break;

		case 'resolve':
			var data = {
				cmd: 'resolved',
				id: msg.id,
				m: null,
				params: msg.params
			};

			var rule = prefs_.sieve[data.params.rule.id];

			if (data.params.rule.req_res) {
				data.params.rule.req_res = sieveResLocal[data.params.rule.id];
			}

			if (data.params.rule.skip_resolve) {
				data.params.url = [''];
				e.postMessage(data);
				return;
			}

			var post_params = /([^\s]+)(?: +:(.+))?/.exec(msg.url);
			msg.url = post_params[1];

			if (!post_params[2]) {
				post_params[2] = null;
			}

			if (rule.res === 1) {
				data.m = true;
				data.params._ = '';
				data.params.url = [post_params[1], post_params[2]];
			}

			post_params = post_params[2];

			var xhr = new XMLHttpRequest;
			xhr.onloadend = function() {
				this.onloadend = null;
				var base_url, match;
				if (/^(image|video|audio)\//i.test(this.getResponseHeader('Content-Type'))) {
					data.m = msg.url;
					data.noloop = true;
					console.warn(app.name + ': rule ' + data.params.rule.id + ' matched against an image file');
					e.postMessage(data);
					return;
				}
				base_url = this.responseXML && this.responseXML.baseURI;
				if (!base_url) {
					base_url = this.responseText.slice(0, 4096);
					if (base_url = /<base\s+href\s*=\s*("[^"]+"|\'[^\']+\')/.exec(base_url)) {
						base_url = withBaseURI(msg.url, base_url[1].slice(1, -1).replace(/&amp;/g, '&'), true);
					}
					else {
						base_url = msg.url;
					}
				}
				if (rule.res === 1) {
					data.params._ = this.responseText;
					data.params.base = base_url.replace(/(\/)[^\/]*(?:[?#].*)*$/, '$1');
					e.postMessage(data);
					return;
				}
				var _match = sieveResLocal[data.params.rule.id];
				_match = (Array.isArray(_match) ? _match : [_match]).map(function(el) {
					var sel = el.source || el;
					if (sel.indexOf('$') === -1) {
						return el;
					}
					var group = data.params.length;
					group = Array.apply(null, Array(group)).map(function(_, i) { return i; }).join('|');
					group = RegExp('([^\\]?)\
$(' + group + ')', 'g');
					group = !group.test(sel) ? el : sel.replace(group, function(m, prefix, id) {
						return id < data.params.length && prefix !== '\\' ? prefix + (data.params[id] ? RegExp.escape(data.params[id]) : '') : m;
					});
					return typeof el === 'string' ? group : RegExp(group);
				});
				match = _match[0].exec(this.responseText);
				if (match) {
					var match_param = data.params.rule.loop_param;
					if (rule.dc && (match_param === 'link' && rule.dc !== 2
						|| match_param === 'img' && rule.dc > 1)) {
						match[1] = decodeURIComponent(decodeURIComponent(match[1]));
					}
					data.m = withBaseURI(base_url, match[1].replace(/&amp;/g, '&'));
					if (match[2] && (match = match.slice(1))
						|| _match[1] && (match = _match[1].exec(this.responseText))) {
						data.m = [
							data.m,
							match.filter(function(el, idx) {
								return idx && el ? true : false;
							}).join(' - ')
						];
					}
				}
				else {
					console.info(app.name + ': no match for ' + data.params.rule.id);
				}
				e.postMessage(data);
			};
			xhr.open(post_params ? 'POST' : 'GET', msg.url);
			if ( e.isPrivate && typeof Components === 'object' ) {
				try {
					xhr.channel
						.QueryInterface(Ci.nsIPrivateBrowsingChannel)
						.setPrivate(true);
				} catch ( ex ) {
				}
			}
			if (post_params) {
				xhr.setRequestHeader(
					'Content-Type',
					'application/x-www-form-urlencoded'
				);
			}
			xhr.send(post_params);
			break;
		
		case 'getDownloadStatus':
			e.postMessage({
				items: downloadProgress,
				stats: downloadStats
			});
			break;
		
		case 'downloadSingle':
			downloadQueue.push({
				url: msg.url,
				referer: msg.referer,
				priorityExt: msg.priorityExt,
				ext: msg.ext,
				isPrivate: e.isPrivate
			});
			processDownloadQueue();
			break;

		        case 'retryDownload':
			const urlToRetry = msg.url;
			if (!urlToRetry) break;

			// Immediately update the status to 'pending' in the master list
			// and notify the UI. This prevents the race condition.
			updateDownloadProgress(urlToRetry, 'pending', 0);

			let taskToRetry = msg.task;
			if (!taskToRetry && downloadProgress[urlToRetry]) {
				taskToRetry = downloadProgress[urlToRetry].task;
			}
			if (!taskToRetry) {
				taskToRetry = { url: urlToRetry, referer: msg.referer };
			}

			if (taskToRetry) {
				downloadQueue.push(taskToRetry);
				processDownloadQueue();
			}
			break;
		
		case 'openDownloadProgress':
			scanInProgress = true; // Reset cancellation flag for a new run
			// Reset progress tracking for new session
			downloadProgress = {};
			globalProcessedUrls.clear(); // Clear deduplication set for new session
			downloadInitiatorTabId = origin.tab ? origin.tab.id : null;
			// Note: downloadStats will be updated when content script sends actual data
			openDownloadProgressTab(origin.tab);
			break;
		
		case 'clearCompletedDownloads':
			for (const url in downloadProgress) {
				if (downloadProgress[url].status === 'completed') {
					delete downloadProgress[url];
				}
			}
			downloadStats.downloaded = 0;
			break;

		case 'clearAllDownloads':
			downloadProgress = {};
			downloadStats = { found: 0, filtered: 0, downloaded: 0 };
			break;

		case 'cancelAllDownloads':
			scanInProgress = false; // Set cancellation flag
			filterQueue.length = 0;
			downloadQueue.length = 0;

			for (const url in downloadProgress) {
				const item = downloadProgress[url];
				if (item.status === 'downloading' || item.status === 'pending' || item.status === 'scanning') {
					if (item.downloadId) {
						chrome.downloads.cancel(item.downloadId);
					}
					updateDownloadProgress(url, 'canceled', 0, 'Canceled by user');
				}
			}

			activeDownloads = 0;
			activeFilters = 0;

			if (downloadInitiatorTabId) {
				chrome.tabs.sendMessage(downloadInitiatorTabId, { cmd: 'stopScanning' }, () => { 
					void chrome.runtime.lastError; 
				});
				downloadInitiatorTabId = null;
			}
			// Force completion after stopping all scans
			forceAllComplete();
			break;
	}

	// Chrome
	return true;
};

// Download progress tracking functions
function updateDownloadProgress(url, status, progress, error, downloadId, task) {
	if (typeof url !== 'string' || !url) {
		console.error('Invalid URL passed to updateDownloadProgress:', url);
		return;
	}
	if (!downloadProgress[url]) {
		downloadProgress[url] = {
			url: url,
			timestamp: Date.now(),
            task: task || null // Store the original task object
		};
	}
	
	downloadProgress[url].status = status;
	downloadProgress[url].progress = progress || downloadProgress[url].progress;
	downloadProgress[url].error = error || null;
    if (downloadId) {
        downloadProgress[url].downloadId = downloadId;
    }
	downloadProgress[url].timestamp = Date.now();
	
	// Notify progress page if it exists
	if (downloadProgressTabId) {
		chrome.tabs.sendMessage(downloadProgressTabId, {
			cmd: 'downloadProgress',
			data: downloadProgress[url]
		}, function(response) {
			if (chrome.runtime.lastError) {
				// Tab was closed, reset tab ID
				downloadProgressTabId = null;
			}
		});
	}
}

function openDownloadProgressTab(openerTab) {
	if (downloadProgressTabId) {
		// Tab already exists, check if it was closed
		chrome.tabs.get(downloadProgressTabId, (tab) => {
            if (chrome.runtime.lastError) {
                downloadProgressTabId = null;
                openDownloadProgressTab(openerTab); // It was closed, so recreate it
            }
        });
	} else {
		// Create new tab but do not make it active
		var progressUrl = chrome.runtime.getURL('download-progress.html');
		const createOptions = { 
			url: progressUrl,
            active: false
		};
		if (openerTab) {
			createOptions.index = openerTab.index + 1;
			createOptions.openerTabId = openerTab.id;
		}
		chrome.tabs.create(createOptions, function(tab) {
			downloadProgressTabId = tab.id;
		});
	}
}

function cleanupDownloadProgress() {
	// Remove completed downloads after some time
	var now = Date.now();
	var expiredThreshold = 5 * 60 * 1000; // 5 minutes
	
	for (var url in downloadProgress) {
		var item = downloadProgress[url];
		if (item.status === 'completed' && (now - item.timestamp) > expiredThreshold) {
			delete downloadProgress[url];
		}
	}
}

// Clean up progress data periodically
setInterval(cleanupDownloadProgress, 60000); // Every minute

Port.listen(onMessage);
document.title = ':: ' + app.name + ' ::';

cfg.migrateOldStorage(
	['version', 'hz', 'tls', 'keys', 'grants', 'sieve'],
	function() {
		// Сначала загружаем все настройки
		updatePrefs(null, function() {
			cfg.get('version', function(items) {
				var day = 24 * 3600 * 1000;
				var version = items.version || {};
				var lastCheck = version.lastCheck || 0;

				if ( version.current !== app.version ) {
					var oldVersion = version.current;
					version = {
						current: app.version,
						lastCheck: Date.now() + (Math.random() * 15 | 0) * day
					};
					console.info(
						app.name + ' has been '
							+ (oldVersion ? 'updated!' : 'installed!')
					);
					cfg.set({version: version}, function() {
						// Загружаем локальные фильтры sieve при первой установке или обновлении
						updateSieve(true);
					});
					return;
				}

			// Проверяем наличие настроек перед автообновлением
			if (!prefs_ || !prefs_.tls) {
				return;
			}

			// Проверяем настройки автообновления
			if (!prefs_.tls.sieveAutoUpdate) {
				return;
			}

			var sieveURL = (prefs_ && prefs_.sieveRepository)
				? prefs_.sieveRepository
				: withBaseURI(document.baseURI, 'info.json');

				if ( lastCheck && Date.now() - lastCheck < 15 * day && sieveURL.indexOf('info.json') > -1) {
					return;
				}

				var xhr = new XMLHttpRequest;
				xhr.onload = function() {
					try {
						if (sieveURL.indexOf('info.json') > -1) {
							// {sieve_ver: timestamp}
							var check = JSON.parse(this.responseText);

							if (lastCheck < check.sieve_ver) {
								updateSieve(false);  // явно указываем онлайн-обновление
							}
						} else {
							updateSieve(false);  // явно указываем онлайн-обновление
						}
					} catch (ex) {
						console.warn(app.name + ': update check failed!', ex);
					}

					version.lastCheck = Date.now();
					cfg.set({version: version});
				};

				xhr.open('GET', sieveURL, true);
				xhr.send(null);
			});
		});
	}
);

chrome.webRequest.onBeforeSendHeaders.addListener(
    function(details) {
		const urlData = downloadReferers[details.url];
        if (urlData) {
			let refererHeaderFound = false;
			for (let i = 0; i < details.requestHeaders.length; ++i) {
				if (details.requestHeaders[i].name.toLowerCase() === 'referer') {
					details.requestHeaders[i].value = urlData.referer;
					refererHeaderFound = true;
					break;
				}
			}
			if (!refererHeaderFound) {
				details.requestHeaders.push({
					name: 'Referer',
					value: urlData.referer
				});
			}
            delete downloadReferers[details.url]; // Clean up
            return { requestHeaders: details.requestHeaders };
        }
    },
    { urls: ["<all_urls>"], types: ["xmlhttprequest", "other", "image", "media"] },
    ["blocking", "requestHeaders", "extraHeaders"]
);

// Cleanup stale referer entries every 5 minutes
setInterval(() => {
	const now = Date.now();
	for (const url in downloadReferers) {
		if (now - downloadReferers[url].timestamp > 300000) { // 5 minutes
			delete downloadReferers[url];
		}
	}
}, 300000);