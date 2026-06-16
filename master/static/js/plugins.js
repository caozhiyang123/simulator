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


// ---------------------------------------------------------------------------
// Batch Override File
// ---------------------------------------------------------------------------
async function doBatchCheckFiles() {
  var src = document.getElementById('batchOverrideSrc').value.trim();
  var dirs = getBatchTargetDirs();
  var excludes = getBatchExcludeDirs();
  if (!src) { showAlert('Please enter the source file path'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchOverrideResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching for matching files...</div>';

  var res = await fetch('/files/batch-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({source: src, target_dirs: dirs, exclude_dirs: excludes})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">🔍 Found ' + found.length + ' matching file(s):</div>';
  if (found.length === 0) {
    html += '<div style="color:#888;">No matching files found in the target directories.</div>';
  } else {
    html += '<div style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;">';
    found.forEach(function(p) { html += p + '\n'; });
    html += '</div>';
  }
  resultEl.innerHTML = html;
}

async function doBatchOverride() {
  var src = document.getElementById('batchOverrideSrc').value.trim();
  var dirs = getBatchTargetDirs();
  var excludes = getBatchExcludeDirs();
  if (!src) { showAlert('Please enter the source file path'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchOverrideResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching and overriding...</div>';

  var res = await fetch('/files/batch-override', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({source: src, target_dirs: dirs, exclude_dirs: excludes})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var replaced = data.replaced || [];
  var errors = data.errors || [];
  var html = '<div style="color:#27ae60;font-weight:600;margin-bottom:8px;">✅ Overridden ' + replaced.length + ' file(s):</div>';
  if (replaced.length === 0 && errors.length === 0) {
    html += '<div style="color:#888;">No matching files found in the target directories.</div>';
  } else {
    if (replaced.length > 0) {
      html += '<div style="background:#1e1e2e;color:#a6e3a1;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;margin-bottom:8px;">';
      replaced.forEach(function(p) { html += p + '\n'; });
      html += '</div>';
    }
    if (errors.length > 0) {
      html += '<div style="color:#e74c3c;font-weight:600;margin-bottom:4px;">❌ Failed (' + errors.length + '):</div>';
      html += '<div style="background:#1e1e2e;color:#f38ba8;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:150px;overflow-y:auto;">';
      errors.forEach(function(p) { html += p + '\n'; });
      html += '</div>';
    }
  }
  resultEl.innerHTML = html;
}

function getBatchTargetDirs() {
  var inputs = document.querySelectorAll('#batchTargetDirs .batch-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}

function getBatchExcludeDirs() {
  var inputs = document.querySelectorAll('#batchExcludeDirs .batch-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}

function addBatchTargetDir() {
  var container = document.getElementById('batchTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-target-dir" placeholder="e.g. E:/path/to/dir" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

function addBatchExcludeDir() {
  var container = document.getElementById('batchExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

// Play module loaded from /static/js/play.js
init();

