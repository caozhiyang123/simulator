// ---------------------------------------------------------------------------
// Input History Autocomplete (localStorage-based)
// ---------------------------------------------------------------------------
var _inputHistoryMax = 20;
var _activeHistoryDropdown = null;
var _historyBlurTimeout = null;

function _getInputHistoryKey(inputEl) {
  // Use a combination of class name and placeholder to generate a unique key
  var cls = inputEl.className || '';
  var placeholder = inputEl.getAttribute('placeholder') || '';
  var id = inputEl.id || '';
  var key = 'inputHistory_' + (id || cls + '_' + placeholder).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80);
  return key;
}

function _getInputHistory(key) {
  try {
    var data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (e) { return []; }
}

function _saveInputHistory(key, value) {
  if (!value || !value.trim()) return;
  value = value.trim();
  var history = _getInputHistory(key);
  // Remove duplicates
  history = history.filter(function(h) { return h !== value; });
  // Add to front
  history.unshift(value);
  // Keep only max items
  if (history.length > _inputHistoryMax) history = history.slice(0, _inputHistoryMax);
  try { localStorage.setItem(key, JSON.stringify(history)); } catch (e) {}
}

function _showHistoryDropdown(inputEl) {
  _hideHistoryDropdown();
  // Cancel any pending blur timeout so it doesn't hide the dropdown we're about to show
  if (_historyBlurTimeout) {
    clearTimeout(_historyBlurTimeout);
    _historyBlurTimeout = null;
  }
  var key = _getInputHistoryKey(inputEl);
  var history = _getInputHistory(key);
  if (!history.length) return;

  var rect = inputEl.getBoundingClientRect();
  var dropdown = document.createElement('div');
  dropdown.className = 'input-history-dropdown';
  dropdown.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + (rect.bottom + 2) + 'px;width:' + rect.width + 'px;max-height:200px;overflow-y:auto;background:#1e1e2e;border:1px solid #444;border-radius:6px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

  // Prevent any mousedown on dropdown from triggering input blur
  dropdown.addEventListener('mousedown', function(e) {
    e.preventDefault();
  });

  history.forEach(function(item) {
    var opt = document.createElement('div');
    opt.style.cssText = 'padding:6px 10px;font-size:12px;color:#cdd6f4;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    opt.textContent = item;
    opt.title = item;
    opt.onmouseover = function() { this.style.background = '#2a2a4e'; };
    opt.onmouseout = function() { this.style.background = ''; };
    opt.onclick = function(e) {
      e.stopPropagation();
      inputEl.value = item;
      _hideHistoryDropdown();
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    };
    dropdown.appendChild(opt);
  });

  document.body.appendChild(dropdown);
  _activeHistoryDropdown = dropdown;
}

function _hideHistoryDropdown() {
  if (_activeHistoryDropdown) {
    _activeHistoryDropdown.remove();
    _activeHistoryDropdown = null;
  }
}

function _initInputHistoryForEl(inputEl) {
  if (inputEl._historyInitialized) return;
  inputEl._historyInitialized = true;

  inputEl.addEventListener('focus', function() {
    _showHistoryDropdown(inputEl);
  });
  inputEl.addEventListener('blur', function() {
    // Delay to allow user to click on dropdown item; tracked so it can be cancelled on re-focus
    if (_historyBlurTimeout) clearTimeout(_historyBlurTimeout);
    _historyBlurTimeout = setTimeout(function() {
      _historyBlurTimeout = null;
      _hideHistoryDropdown();
    }, 300);
  });
  inputEl.addEventListener('change', function() {
    var key = _getInputHistoryKey(inputEl);
    _saveInputHistory(key, inputEl.value);
  });
}

// Batch input classes that need history tracking
var _batchInputHistoryClasses = [
  'batch-override-src', 'batch-target-dir', 'batch-exclude-dir',
  'batch-edit-content', 'batch-edit-target-dir', 'batch-edit-exclude-dir',
  'batch-up-src-file', 'batch-up-target-dir', 'batch-up-exclude-dir',
  'batch-dl-target-dir', 'batch-dl-exclude-dir',
  'batch-del-pattern', 'batch-del-target-dir', 'batch-del-exclude-dir',
  'batch-up-multi-src-file', 'batch-up-multi-target-dir', 'batch-up-multi-exclude-dir',
  'batch-override-multi-src', 'batch-override-multi-target-dir', 'batch-override-multi-exclude-dir',
  'batch-dl-multi-target-dir', 'batch-dl-multi-exclude-dir', 'batch-dl-multi-filename',
  'batch-del-multi-pattern', 'batch-del-multi-target-dir', 'batch-del-multi-exclude-dir',
  'sa-filename', 'sa-target-dir', 'sa-exclude-dir'
];
var _batchInputHistoryIds = [
  'batchEditFileName', 'batchDlFileName', 'batchDelFilePattern'
];

function _initAllInputHistory() {
  // Init for class-based inputs
  _batchInputHistoryClasses.forEach(function(cls) {
    document.querySelectorAll('.' + cls).forEach(function(el) {
      _initInputHistoryForEl(el);
    });
  });
  // Init for id-based inputs
  _batchInputHistoryIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) _initInputHistoryForEl(el);
  });
}

// Re-init history on dynamically added inputs (MutationObserver)
var _historyObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(node) {
      if (node.nodeType !== 1) return;
      // Check if the node itself is an input
      if (node.tagName === 'INPUT') {
        _batchInputHistoryClasses.forEach(function(cls) {
          if (node.classList.contains(cls)) _initInputHistoryForEl(node);
        });
      }
      // Check children
      _batchInputHistoryClasses.forEach(function(cls) {
        var inputs = node.querySelectorAll ? node.querySelectorAll('.' + cls) : [];
        inputs.forEach(function(el) { _initInputHistoryForEl(el); });
      });
    });
  });
});

// Also save history when user clicks action buttons (captures values before submit)
function _saveAllBatchInputHistory() {
  _batchInputHistoryClasses.forEach(function(cls) {
    document.querySelectorAll('.' + cls).forEach(function(el) {
      if (el.value.trim()) {
        var key = _getInputHistoryKey(el);
        _saveInputHistory(key, el.value);
      }
    });
  });
  _batchInputHistoryIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el && el.value.trim()) {
      var key = _getInputHistoryKey(el);
      _saveInputHistory(key, el.value);
    }
  });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  _initAllInputHistory();
  // Observe for dynamically added inputs
  var mainContent = document.querySelector('.main-content') || document.body;
  _historyObserver.observe(mainContent, { childList: true, subtree: true });
});

// Also init after a short delay (in case DOMContentLoaded already fired)
setTimeout(function() { _initAllInputHistory(); }, 500);


// ---------------------------------------------------------------------------
// Format Time
// ---------------------------------------------------------------------------
function doFormatTime() {
  var input = document.getElementById('formatTimeInput').value.trim();
  var resultEl = document.getElementById('formatTimeResult');
  if (!input) { resultEl.innerHTML = '<span style="color:#888;">Please enter a value</span>'; return; }

  // Check if input is a number (timestamp in ms)
  if (/^\d+$/.test(input)) {
    var ts = parseInt(input);
    var date = new Date(ts);
    if (isNaN(date.getTime())) { resultEl.innerHTML = '<span style="color:#e74c3c;">Invalid timestamp</span>'; return; }
    var y = date.getUTCFullYear();
    var m = String(date.getUTCMonth() + 1).padStart(2, '0');
    var d = String(date.getUTCDate()).padStart(2, '0');
    var hh = String(date.getUTCHours()).padStart(2, '0');
    var mm = String(date.getUTCMinutes()).padStart(2, '0');
    var ss = String(date.getUTCSeconds()).padStart(2, '0');
    var ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    var formatted = y + '-' + m + '-' + d + ' ' + hh + ':' + mm + ':' + ss + '.' + ms + '000 UTC';
    resultEl.innerHTML = '<div style="background:#1e1e2e;padding:12px 44px 12px 12px;border-radius:6px;font-family:monospace;font-size:14px;position:relative;"><span id="formatTimeValue" style="color:#a6e3a1;">' + formatted + '</span><span id="formatTimeCopyBtn" onclick="copyFormatTimeResult()" title="Copy" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.1)\'" onmouseout="this.style.background=\'transparent\'"><svg id="formatTimeCopyIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><svg id="formatTimeCheckIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><polyline points="20 6 9 17 4 12"></polyline></svg></span></div>';
  } else {
    // Try to parse as date string
    var cleaned = input.replace(' UTC', 'Z').replace(' ', 'T');
    // Handle microseconds (remove extra precision beyond ms)
    var dotMatch = cleaned.match(/\.(\d+)/);
    if (dotMatch && dotMatch[1].length > 3) {
      cleaned = cleaned.replace('.' + dotMatch[1], '.' + dotMatch[1].substring(0, 3));
    }
    var date = new Date(cleaned);
    if (isNaN(date.getTime())) {
      // Try direct parsing with manual split
      var parts = input.replace(' UTC', '').split(/[- :.]/);
      if (parts.length >= 6) {
        var ms2 = parts[6] ? parseInt(parts[6].substring(0, 3)) : 0;
        date = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]), parseInt(parts[5]), ms2));
      }
    }
    if (isNaN(date.getTime())) { resultEl.innerHTML = '<span style="color:#e74c3c;">Invalid date format. Expected: YYYY-MM-DD HH:MM:SS.ffffff UTC</span>'; return; }
    var timestamp = date.getTime();
    resultEl.innerHTML = '<div style="background:#1e1e2e;padding:12px 44px 12px 12px;border-radius:6px;font-family:monospace;font-size:14px;position:relative;"><span id="formatTimeValue" style="color:#a6e3a1;">' + timestamp + '</span><span id="formatTimeCopyBtn" onclick="copyFormatTimeResult()" title="Copy" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.1)\'" onmouseout="this.style.background=\'transparent\'"><svg id="formatTimeCopyIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><svg id="formatTimeCheckIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><polyline points="20 6 9 17 4 12"></polyline></svg></span></div>';
  }
}

function copyFormatTimeResult() {
  var text = document.getElementById('formatTimeValue').textContent;
  if (!text) return;
  var copyIcon = document.getElementById('formatTimeCopyIcon');
  var checkIcon = document.getElementById('formatTimeCheckIcon');
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
  copyIcon.style.display = 'none';
  checkIcon.style.display = '';
  setTimeout(function() { copyIcon.style.display = ''; checkIcon.style.display = 'none'; }, 2000);
}


