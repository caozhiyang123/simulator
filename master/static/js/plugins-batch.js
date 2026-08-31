// ---------------------------------------------------------------------------
// Batch Delete File (glob/wildcard pattern matching)
// ---------------------------------------------------------------------------
var _batchDelFileFoundFiles = [];

function getBatchDelTargetDirs() {
  var inputs = document.querySelectorAll('#batchDelTargetDirs .batch-del-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}

function getBatchDelExcludeDirs() {
  var inputs = document.querySelectorAll('#batchDelExcludeDirs .batch-del-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}

function addBatchDelTargetDir() {
  var container = document.getElementById('batchDelTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-del-target-dir" placeholder="e.g. E:/path/to/dir" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

function addBatchDelExcludeDir() {
  var container = document.getElementById('batchDelExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-del-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

async function doBatchDelFileCheck() {
  _saveAllBatchInputHistory();
  var pattern = document.getElementById('batchDelFilePattern').value.trim();
  var dirs = getBatchDelTargetDirs();
  var excludes = getBatchDelExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchDelNodeSelect');
  if (!pattern) { showAlert('Please enter a file pattern (e.g. CalacaBingo*.txt)'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchDelFileResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching for matching files...</div>';

  var res = await fetch('/files/batch-delete-file-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({pattern: pattern, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  _batchDelFileFoundFiles = found;

  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">🔍 Found ' + found.length + ' matching file(s):</div>';
  if (found.length === 0) {
    html += '<div style="color:#888;">No matching files found in the target directories.</div>';
  } else {
    html += '<div style="margin-bottom:8px;">';
    html += '<button class="btn-primary btn-sm" onclick="batchDelFileSelectAll()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select All</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchDelFileSelectNone()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select None</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchDelFileSelectInverse()" style="font-size:11px;padding:3px 8px;">Inverse</button>';
    html += '</div>';
    html += '<div id="batchDelFileList" style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:350px;overflow-y:auto;">';
    found.forEach(function(p, idx) {
      html += '<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;">';
      html += '<input type="checkbox" class="batch-del-file-cb" value="' + idx + '" checked>';
      html += '<span>' + p + '</span></label>';
    });
    html += '</div>';
  }
  resultEl.innerHTML = html;
}

function batchDelFileSelectAll() {
  document.querySelectorAll('.batch-del-file-cb').forEach(function(cb) { cb.checked = true; });
}
function batchDelFileSelectNone() {
  document.querySelectorAll('.batch-del-file-cb').forEach(function(cb) { cb.checked = false; });
}
function batchDelFileSelectInverse() {
  document.querySelectorAll('.batch-del-file-cb').forEach(function(cb) { cb.checked = !cb.checked; });
}

function getSelectedBatchDelFiles() {
  var selected = [];
  document.querySelectorAll('.batch-del-file-cb').forEach(function(cb) {
    if (cb.checked) {
      var idx = parseInt(cb.value);
      if (_batchDelFileFoundFiles[idx]) selected.push(_batchDelFileFoundFiles[idx]);
    }
  });
  return selected;
}

async function doBatchDelFileDelete() {
  var selected = getSelectedBatchDelFiles();
  var addr = getBatchPluginNodeAddr('batchDelNodeSelect');
  if (!selected.length) { showAlert('No files selected for deletion. Please run Check All Files first.'); return; }
  if (!confirm('⚠️ Are you sure you want to DELETE ' + selected.length + ' file(s)?\n\nThis operation cannot be undone!')) return;

  var resultEl = document.getElementById('batchDelFileResult');
  resultEl.innerHTML = '<div style="color:#888;">Deleting selected files...</div>';

  var res = await fetch('/files/batch-delete', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({files: selected, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var deleted = data.deleted || [];
  var errors = data.errors || [];
  var html = '<div style="color:#27ae60;font-weight:600;margin-bottom:8px;">🗑️ Deleted ' + deleted.length + ' file(s):</div>';
  if (deleted.length > 0) {
    html += '<div style="background:#1e1e2e;color:#a6e3a1;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;margin-bottom:8px;">';
    deleted.forEach(function(p) { html += '<div>' + p + '</div>'; });
    html += '</div>';
  }
  if (errors.length > 0) {
    html += '<div style="color:#e74c3c;font-weight:600;margin-bottom:4px;">❌ Failed (' + errors.length + '):</div>';
    html += '<div style="background:#1e1e2e;color:#f38ba8;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:150px;overflow-y:auto;">';
    errors.forEach(function(p) { html += '<div>' + p + '</div>'; });
    html += '</div>';
  }
  if (deleted.length === 0 && errors.length === 0) {
    html += '<div style="color:#888;">No files were deleted.</div>';
  }
  resultEl.innerHTML = html;
}


// ---------------------------------------------------------------------------
// Batch Override File
// ---------------------------------------------------------------------------
var _batchOverrideFoundFiles = [];

function getBatchOverrideSrcFiles() {
  var inputs = document.querySelectorAll('#batchOverrideSrcFiles .batch-override-src');
  var files = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) files.push(v); });
  return files;
}

function addBatchOverrideSrc() {
  var container = document.getElementById('batchOverrideSrcFiles');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-override-src" placeholder="e.g. D:\\path\\to\\file.jar" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

async function doBatchCheckFiles() {
  _saveAllBatchInputHistory();
  var sources = getBatchOverrideSrcFiles();
  var dirs = getBatchTargetDirs();
  var excludes = getBatchExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchOverrideNodeSelect');
  if (!sources.length) { showAlert('Please enter at least one source file path'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchOverrideResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching for matching files...</div>';

  var res = await fetch('/files/batch-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sources: sources, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  _batchOverrideFoundFiles = found;

  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">🔍 Found ' + found.length + ' matching file(s):</div>';
  if (found.length === 0) {
    html += '<div style="color:#888;">No matching files found in the target directories.</div>';
  } else {
    html += '<div style="margin-bottom:8px;">';
    html += '<button class="btn-primary btn-sm" onclick="batchOverrideSelectAll()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select All</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchOverrideSelectNone()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select None</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchOverrideSelectInverse()" style="font-size:11px;padding:3px 8px;">Inverse</button>';
    html += '</div>';
    html += '<div id="batchOverrideFileList" style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:350px;overflow-y:auto;">';
    found.forEach(function(p, idx) {
      html += '<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;">';
      html += '<input type="checkbox" class="batch-override-file-cb" value="' + idx + '" checked>';
      html += '<span>' + p + '</span></label>';
    });
    html += '</div>';
  }
  resultEl.innerHTML = html;
}

function batchOverrideSelectAll() {
  document.querySelectorAll('.batch-override-file-cb').forEach(function(cb) { cb.checked = true; });
}
function batchOverrideSelectNone() {
  document.querySelectorAll('.batch-override-file-cb').forEach(function(cb) { cb.checked = false; });
}
function batchOverrideSelectInverse() {
  document.querySelectorAll('.batch-override-file-cb').forEach(function(cb) { cb.checked = !cb.checked; });
}

function getSelectedBatchOverrideFiles() {
  var selected = [];
  document.querySelectorAll('.batch-override-file-cb').forEach(function(cb) {
    if (cb.checked) {
      var idx = parseInt(cb.value);
      if (_batchOverrideFoundFiles[idx]) selected.push(_batchOverrideFoundFiles[idx]);
    }
  });
  return selected;
}

async function doBatchOverride() {
  _saveAllBatchInputHistory();
  var sources = getBatchOverrideSrcFiles();
  var dirs = getBatchTargetDirs();
  var excludes = getBatchExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchOverrideNodeSelect');
  if (!sources.length) { showAlert('Please enter at least one source file path'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchOverrideResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching and overriding...</div>';

  var res = await fetch('/files/batch-override', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sources: sources, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
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
      replaced.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
    if (errors.length > 0) {
      html += '<div style="color:#e74c3c;font-weight:600;margin-bottom:4px;">❌ Failed (' + errors.length + '):</div>';
      html += '<div style="background:#1e1e2e;color:#f38ba8;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:150px;overflow-y:auto;">';
      errors.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
  }
  resultEl.innerHTML = html;
}

async function doBatchDelete() {
  var selected = getSelectedBatchOverrideFiles();
  var addr = getBatchPluginNodeAddr('batchOverrideNodeSelect');
  if (!selected.length) { showAlert('No files selected for deletion. Please run Check All Files first.'); return; }
  if (!confirm('⚠️ Are you sure you want to DELETE ' + selected.length + ' file(s)?\n\nThis operation cannot be undone!')) return;

  var resultEl = document.getElementById('batchOverrideResult');
  resultEl.innerHTML = '<div style="color:#888;">Deleting selected files...</div>';

  var res = await fetch('/files/batch-delete', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({files: selected, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var deleted = data.deleted || [];
  var errors = data.errors || [];
  var html = '<div style="color:#27ae60;font-weight:600;margin-bottom:8px;">🗑️ Deleted ' + deleted.length + ' file(s):</div>';
  if (deleted.length > 0) {
    html += '<div style="background:#1e1e2e;color:#a6e3a1;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;margin-bottom:8px;">';
    deleted.forEach(function(p) { html += '<div>' + p + '</div>'; });
    html += '</div>';
  }
  if (errors.length > 0) {
    html += '<div style="color:#e74c3c;font-weight:600;margin-bottom:4px;">❌ Failed (' + errors.length + '):</div>';
    html += '<div style="background:#1e1e2e;color:#f38ba8;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:150px;overflow-y:auto;">';
    errors.forEach(function(p) { html += '<div>' + p + '</div>'; });
    html += '</div>';
  }
  if (deleted.length === 0 && errors.length === 0) {
    html += '<div style="color:#888;">No files were deleted.</div>';
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

// ---------------------------------------------------------------------------
// Batch Edit File
// ---------------------------------------------------------------------------
function getBatchEditContents() {
  var inputs = document.querySelectorAll('#batchEditContents .batch-edit-content');
  var items = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) items.push(v); });
  return items;
}
function getBatchEditTargetDirs() {
  var inputs = document.querySelectorAll('#batchEditTargetDirs .batch-edit-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function getBatchEditExcludeDirs() {
  var inputs = document.querySelectorAll('#batchEditExcludeDirs .batch-edit-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchEditContent() {
  var container = document.getElementById('batchEditContents');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-edit-content" placeholder="e.g. openCardAmount=1" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchEditTargetDir() {
  var container = document.getElementById('batchEditTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-edit-target-dir" placeholder="e.g. D:\\tools2" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchEditExcludeDir() {
  var container = document.getElementById('batchEditExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-edit-exclude-dir" placeholder="e.g. D:\\tools2\\archive" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

async function doBatchEditCheck() {
  _saveAllBatchInputHistory();
  var filename = document.getElementById('batchEditFileName').value.trim();
  var dirs = getBatchEditTargetDirs();
  var excludes = getBatchEditExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchEditNodeSelect');
  if (!filename) { showAlert('Please enter a source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchEditResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching for matching files...</div>';

  var res = await fetch('/files/batch-edit-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: filename, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">🔍 Found ' + found.length + ' matching file(s):</div>';
  if (found.length === 0) {
    html += '<div style="color:#888;">No matching files found in the target directories.</div>';
  } else {
    html += '<div style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;">';
    found.forEach(function(p) { html += '<div>' + p + '</div>'; });
    html += '</div>';
  }
  resultEl.innerHTML = html;
}

async function doBatchEditApply() {
  _saveAllBatchInputHistory();
  var filename = document.getElementById('batchEditFileName').value.trim();
  var contents = getBatchEditContents();
  var dirs = getBatchEditTargetDirs();
  var excludes = getBatchEditExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchEditNodeSelect');
  if (!filename) { showAlert('Please enter a source file name'); return; }
  if (!contents.length) { showAlert('Please enter at least one content entry (key=value)'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  if (!filename.endsWith('.properties')) { showAlert('Batch Edit currently only supports .properties files'); return; }
  var resultEl = document.getElementById('batchEditResult');
  resultEl.innerHTML = '<div style="color:#888;">Applying batch edit...</div>';

  var res = await fetch('/files/batch-edit-apply', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: filename, contents: contents, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var updated = data.updated || [];
  var errors = data.errors || [];
  var html = '<div style="color:#27ae60;font-weight:600;margin-bottom:8px;">✅ Updated ' + updated.length + ' file(s):</div>';
  if (updated.length === 0 && errors.length === 0) {
    html += '<div style="color:#888;">No matching files found in the target directories.</div>';
  } else {
    if (updated.length > 0) {
      html += '<div style="background:#1e1e2e;color:#a6e3a1;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;margin-bottom:8px;">';
      updated.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
    if (errors.length > 0) {
      html += '<div style="color:#e74c3c;font-weight:600;margin-bottom:4px;">❌ Failed (' + errors.length + '):</div>';
      html += '<div style="background:#1e1e2e;color:#f38ba8;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:150px;overflow-y:auto;">';
      errors.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
  }
  resultEl.innerHTML = html;
}

async function doBatchEditViewFiles() {
  _saveAllBatchInputHistory();
  var filename = document.getElementById('batchEditFileName').value.trim();
  var dirs = getBatchEditTargetDirs();
  var excludes = getBatchEditExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchEditNodeSelect');
  if (!filename) { showAlert('Please enter a source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchEditResult');
  resultEl.innerHTML = '<div style="color:#888;">Loading file previews...</div>';

  var res = await fetch('/files/batch-edit-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: filename, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  if (found.length === 0) {
    resultEl.innerHTML = '<div style="color:#888;">No matching files found in the target directories.</div>';
    return;
  }

  // Fetch preview content for each file
  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">👁️ Viewing ' + found.length + ' file(s):</div>';
  html += '<div id="batchEditFileCards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px;">';

  for (var i = 0; i < found.length; i++) {
    var fp = found[i];
    html += '<div class="batch-edit-file-card" style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:12px;position:relative;">';
    html += '<div style="font-size:11px;color:#888;margin-bottom:6px;word-break:break-all;" title="' + fp + '">' + fp + '</div>';
    html += '<pre id="batchEditPreview_' + i + '" style="background:#0d1117;color:#cdd6f4;padding:8px;border-radius:4px;font-size:11px;max-height:150px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;">Loading...</pre>';
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="btn-primary btn-sm" onclick="batchEditExpand(' + i + ',\'' + fp.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\',\'' + addr + '\')" style="font-size:11px;padding:3px 8px;">🔍 Expand & Edit</button>';
    html += '</div></div>';
  }
  html += '</div>';
  resultEl.innerHTML = html;

  // Load previews asynchronously
  for (var j = 0; j < found.length; j++) {
    (function(idx, filePath) {
      fetch('/files/batch-edit-read', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path: filePath, addr: addr})
      }).then(function(r) { return r.json(); }).then(function(d) {
        var el = document.getElementById('batchEditPreview_' + idx);
        if (el) {
          if (d.error) { el.textContent = 'Error: ' + d.error; }
          else {
            var content = d.content || '';
            // Show truncated preview (first 20 lines)
            var lines = content.split('\n');
            var preview = lines.slice(0, 20).join('\n');
            if (lines.length > 20) preview += '\n... (' + lines.length + ' lines total)';
            el.textContent = preview;
          }
        }
      });
    })(j, found[j]);
  }
}

function batchEditExpand(idx, filePath, addr) {
  // Create a modal for full editing
  var modal = document.createElement('div');
  modal.id = 'batchEditModal';
  modal.dataset.addr = addr || 'master';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = '<div style="background:#1e1e2e;border-radius:10px;padding:20px;width:80%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
    '<div style="font-size:12px;color:#888;word-break:break-all;flex:1;margin-right:12px;">' + filePath + '</div>' +
    '<button class="btn-danger btn-sm" onclick="document.getElementById(\'batchEditModal\').remove()" style="font-size:14px;padding:4px 10px;">✕</button>' +
    '</div>' +
    '<textarea id="batchEditModalContent" style="flex:1;background:#0d1117;color:#cdd6f4;border:1px solid #444;border-radius:6px;padding:12px;font-family:monospace;font-size:12px;resize:none;min-height:400px;"></textarea>' +
    '<div style="margin-top:12px;text-align:right;">' +
    '<button class="btn-primary" onclick="batchEditSaveFile(\'' + filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')" style="margin-right:8px;">💾 Save</button>' +
    '<button class="btn-danger btn-sm" onclick="document.getElementById(\'batchEditModal\').remove()" style="padding:6px 12px;">Cancel</button>' +
    '</div></div>';
  document.body.appendChild(modal);

  // Load full content
  fetch('/files/batch-edit-read', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({path: filePath, addr: addr})
  }).then(function(r) { return r.json(); }).then(function(d) {
    var ta = document.getElementById('batchEditModalContent');
    if (d.error) { ta.value = 'Error: ' + d.error; }
    else { ta.value = d.content || ''; }
  });
}

async function batchEditSaveFile(filePath) {
  var content = document.getElementById('batchEditModalContent').value;
  var modal = document.getElementById('batchEditModal');
  var addr = (modal && modal.dataset.addr) ? modal.dataset.addr : 'master';
  var res = await fetch('/files/batch-edit-save', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({path: filePath, content: content, addr: addr})
  });
  var data = await res.json();
  if (data.error) {
    showAlert('Save failed: ' + data.error);
  } else {
    showAlert('File saved successfully!');
    document.getElementById('batchEditModal').remove();
    // Refresh the view
    doBatchEditViewFiles();
  }
}

// Play module loaded from /static/js/play.js
init();


// ---------------------------------------------------------------------------
// Batch Upload File
// ---------------------------------------------------------------------------
function getBatchUpSrcFiles() {
  var inputs = document.querySelectorAll('#batchUpSrcFiles .batch-up-src-file');
  var files = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) files.push(v); });
  return files;
}
function getBatchUpTargetDirs() {
  var inputs = document.querySelectorAll('#batchUpTargetDirs .batch-up-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function getBatchUpExcludeDirs() {
  var inputs = document.querySelectorAll('#batchUpExcludeDirs .batch-up-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchUpSrcFile() {
  var container = document.getElementById('batchUpSrcFiles');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-up-src-file" placeholder="e.g. D:\\tools2\\path\\to\\file.jar" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchUpTargetDir() {
  var container = document.getElementById('batchUpTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-up-target-dir" placeholder="e.g. E:/path/*/lib" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchUpExcludeDir() {
  var container = document.getElementById('batchUpExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-up-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

var _batchUpFoundDirs = [];

async function doBatchUpCheck() {
  _saveAllBatchInputHistory();
  var srcFiles = getBatchUpSrcFiles();
  var dirs = getBatchUpTargetDirs();
  var excludes = getBatchUpExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchUpNodeSelect');
  if (!srcFiles.length) { showAlert('Please enter at least one source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchUpResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching for matching directories...</div>';

  var res = await fetch('/files/batch-up-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({src_files: srcFiles, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  _batchUpFoundDirs = found;

  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">🔍 Found ' + found.length + ' matching directory path(s):</div>';
  if (found.length === 0) {
    html += '<div style="color:#888;">No matching directories found.</div>';
  } else {
    html += '<div style="margin-bottom:8px;">';
    html += '<button class="btn-primary btn-sm" onclick="batchUpSelectAll()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select All</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchUpSelectNone()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select None</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchUpSelectInverse()" style="font-size:11px;padding:3px 8px;">Inverse</button>';
    html += '</div>';
    html += '<div id="batchUpDirList" style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:350px;overflow-y:auto;">';
    found.forEach(function(p, idx) {
      html += '<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;">';
      html += '<input type="checkbox" class="batch-up-dir-cb" value="' + idx + '" checked>';
      html += '<span>' + p + '</span></label>';
    });
    html += '</div>';
  }
  resultEl.innerHTML = html;
}

function batchUpSelectAll() {
  document.querySelectorAll('.batch-up-dir-cb').forEach(function(cb) { cb.checked = true; });
}
function batchUpSelectNone() {
  document.querySelectorAll('.batch-up-dir-cb').forEach(function(cb) { cb.checked = false; });
}
function batchUpSelectInverse() {
  document.querySelectorAll('.batch-up-dir-cb').forEach(function(cb) { cb.checked = !cb.checked; });
}

function getSelectedBatchUpDirs() {
  var selected = [];
  document.querySelectorAll('.batch-up-dir-cb').forEach(function(cb) {
    if (cb.checked) {
      var idx = parseInt(cb.value);
      if (_batchUpFoundDirs[idx]) selected.push(_batchUpFoundDirs[idx]);
    }
  });
  return selected;
}

// Progress bar helpers
var _batchUpProgressTimer = null;

function showBatchUpProgress() {
  var mask = document.getElementById('batchUpProgressMask');
  var bar = document.getElementById('batchUpProgressBar');
  var text = document.getElementById('batchUpProgressText');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  text.textContent = 'Uploading...';
  mask.style.display = 'block';
  var progress = 0;
  if (_batchUpProgressTimer) clearInterval(_batchUpProgressTimer);
  _batchUpProgressTimer = setInterval(function() {
    var remaining = 90 - progress;
    var step = Math.max(0.5, remaining * 0.08);
    progress = Math.min(90, progress + step);
    bar.style.transition = 'width 0.3s ease';
    bar.style.width = progress.toFixed(1) + '%';
    text.textContent = Math.round(progress) + '%';
    if (progress >= 89.9) {
      clearInterval(_batchUpProgressTimer);
      _batchUpProgressTimer = null;
    }
  }, 200);
}

function hideBatchUpProgress() {
  if (_batchUpProgressTimer) {
    clearInterval(_batchUpProgressTimer);
    _batchUpProgressTimer = null;
  }
  var mask = document.getElementById('batchUpProgressMask');
  var bar = document.getElementById('batchUpProgressBar');
  var text = document.getElementById('batchUpProgressText');
  bar.style.transition = 'width 0.3s ease';
  bar.style.width = '100%';
  text.textContent = '100%';
  setTimeout(function() {
    mask.style.display = 'none';
    bar.style.transition = 'none';
    bar.style.width = '0%';
  }, 800);
}

async function doBatchUpUpload() {
  _saveAllBatchInputHistory();
  var srcFiles = getBatchUpSrcFiles();
  var selectedDirs = getSelectedBatchUpDirs();
  var addr = getBatchPluginNodeAddr('batchUpNodeSelect');
  if (!srcFiles.length) { showAlert('Please enter at least one source file name'); return; }
  if (!selectedDirs.length) { showAlert('No directories selected for upload'); return; }

  showBatchUpProgress();
  var resultEl = document.getElementById('batchUpResult');

  try {
    var res = await fetch('/files/batch-up-upload', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({src_files: srcFiles, target_dirs: selectedDirs, addr: addr})
    });
    var data = await res.json();
    hideBatchUpProgress();
    if (data.error) {
      resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>';
      return;
    }
    var copied = data.copied || [];
    var errors = data.errors || [];
    var html = '<div style="color:#27ae60;font-weight:600;margin-bottom:8px;">✅ Uploaded ' + copied.length + ' file(s) successfully:</div>';
    if (copied.length > 0) {
      html += '<div style="background:#1e1e2e;color:#a6e3a1;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:300px;overflow-y:auto;margin-bottom:8px;">';
      copied.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
    if (errors.length > 0) {
      html += '<div style="color:#e74c3c;font-weight:600;margin-bottom:4px;">❌ Failed (' + errors.length + '):</div>';
      html += '<div style="background:#1e1e2e;color:#f38ba8;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:150px;overflow-y:auto;">';
      errors.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
    if (copied.length === 0 && errors.length === 0) {
      html += '<div style="color:#888;">No files were uploaded.</div>';
    }
    resultEl.innerHTML = html;
  } catch (e) {
    hideBatchUpProgress();
    resultEl.innerHTML = '<div style="color:#e74c3c;">❌ Upload failed: ' + e.message + '</div>';
  }
}


// ---------------------------------------------------------------------------
// Batch Download File
// ---------------------------------------------------------------------------
function getBatchDlTargetDirs() {
  var inputs = document.querySelectorAll('#batchDlTargetDirs .batch-dl-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function getBatchDlExcludeDirs() {
  var inputs = document.querySelectorAll('#batchDlExcludeDirs .batch-dl-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchDlTargetDir() {
  var container = document.getElementById('batchDlTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-dl-target-dir" placeholder="e.g. E:/path/to/dir" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchDlExcludeDir() {
  var container = document.getElementById('batchDlExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-dl-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

// Store found files for selection
var _batchDlFoundFiles = [];

async function doBatchDlCheck() {
  _saveAllBatchInputHistory();
  var filename = document.getElementById('batchDlFileName').value.trim();
  var dirs = getBatchDlTargetDirs();
  var excludes = getBatchDlExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchDlNodeSelect');
  if (!filename) { showAlert('Please enter a source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchDlResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching for matching files...</div>';

  var res = await fetch('/files/batch-dl-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: filename, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  _batchDlFoundFiles = found;

  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">🔍 Found ' + found.length + ' matching file(s):</div>';
  if (found.length === 0) {
    html += '<div style="color:#888;">No matching files found in the target directories.</div>';
  } else {
    // Selection controls
    html += '<div style="margin-bottom:8px;">';
    html += '<button class="btn-primary btn-sm" onclick="batchDlSelectAll()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select All</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchDlSelectNone()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select None</button>';
    html += '<button class="btn-primary btn-sm" onclick="batchDlSelectInverse()" style="font-size:11px;padding:3px 8px;">Inverse</button>';
    html += '</div>';
    html += '<div id="batchDlFileList" style="background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:350px;overflow-y:auto;">';
    found.forEach(function(p, idx) {
      html += '<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;">';
      html += '<input type="checkbox" class="batch-dl-file-cb" value="' + idx + '" checked>';
      html += '<span>' + p + '</span></label>';
    });
    html += '</div>';
  }
  resultEl.innerHTML = html;
}

function batchDlSelectAll() {
  document.querySelectorAll('.batch-dl-file-cb').forEach(function(cb) { cb.checked = true; });
}
function batchDlSelectNone() {
  document.querySelectorAll('.batch-dl-file-cb').forEach(function(cb) { cb.checked = false; });
}
function batchDlSelectInverse() {
  document.querySelectorAll('.batch-dl-file-cb').forEach(function(cb) { cb.checked = !cb.checked; });
}

function getSelectedBatchDlFiles() {
  var selected = [];
  document.querySelectorAll('.batch-dl-file-cb').forEach(function(cb) {
    if (cb.checked) {
      var idx = parseInt(cb.value);
      if (_batchDlFoundFiles[idx]) selected.push(_batchDlFoundFiles[idx]);
    }
  });
  return selected;
}

// Progress bar helpers (same pattern as File Sync)
var _batchDlProgressTimer = null;

function showBatchDlProgress() {
  var mask = document.getElementById('batchDlProgressMask');
  var bar = document.getElementById('batchDlProgressBar');
  var text = document.getElementById('batchDlProgressText');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  text.textContent = 'Preparing...';
  mask.style.display = 'block';
  var progress = 0;
  if (_batchDlProgressTimer) clearInterval(_batchDlProgressTimer);
  _batchDlProgressTimer = setInterval(function() {
    var remaining = 90 - progress;
    var step = Math.max(0.5, remaining * 0.08);
    progress = Math.min(90, progress + step);
    bar.style.transition = 'width 0.3s ease';
    bar.style.width = progress.toFixed(1) + '%';
    text.textContent = Math.round(progress) + '%';
    if (progress >= 89.9) {
      clearInterval(_batchDlProgressTimer);
      _batchDlProgressTimer = null;
    }
  }, 200);
}

function hideBatchDlProgress() {
  if (_batchDlProgressTimer) {
    clearInterval(_batchDlProgressTimer);
    _batchDlProgressTimer = null;
  }
  var mask = document.getElementById('batchDlProgressMask');
  var bar = document.getElementById('batchDlProgressBar');
  var text = document.getElementById('batchDlProgressText');
  bar.style.transition = 'width 0.3s ease';
  bar.style.width = '100%';
  text.textContent = '100%';
  setTimeout(function() {
    mask.style.display = 'none';
    bar.style.transition = 'none';
    bar.style.width = '0%';
  }, 800);
}

async function doBatchDlDownload() {
  _saveAllBatchInputHistory();
  var selected = getSelectedBatchDlFiles();
  var dirs = getBatchDlTargetDirs();
  var addr = getBatchPluginNodeAddr('batchDlNodeSelect');
  if (!selected.length) { showAlert('No files selected for download'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }

  showBatchDlProgress();

  try {
    var res = await fetch('/files/batch-dl-download', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({files: selected, target_dirs: dirs, addr: addr})
    });
    if (!res.ok) {
      var errData = await res.json();
      hideBatchDlProgress();
      showAlert('Download failed: ' + (errData.error || 'Unknown error'));
      return;
    }
    // Download the zip file
    var blob = await res.blob();
    hideBatchDlProgress();
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'temp.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (e) {
    hideBatchDlProgress();
    showAlert('Download failed: ' + e.message);
  }
}

async function doBatchDlView() {
  _saveAllBatchInputHistory();
  var filename = document.getElementById('batchDlFileName').value.trim();
  var dirs = getBatchDlTargetDirs();
  var excludes = getBatchDlExcludeDirs();
  var addr = getBatchPluginNodeAddr('batchDlNodeSelect');
  if (!filename) { showAlert('Please enter a source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchDlResult');
  resultEl.innerHTML = '<div style="color:#888;">Loading file previews...</div>';

  var res = await fetch('/files/batch-dl-check', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: filename, target_dirs: dirs, exclude_dirs: excludes, addr: addr})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  var found = data.found || [];
  if (found.length === 0) {
    resultEl.innerHTML = '<div style="color:#888;">No matching files found in the target directories.</div>';
    return;
  }

  var html = '<div style="color:#4a90d9;font-weight:600;margin-bottom:8px;">👁️ Viewing ' + found.length + ' file(s):</div>';
  html += '<div id="batchDlFileCards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px;">';

  for (var i = 0; i < found.length; i++) {
    var fp = found[i];
    html += '<div style="background:#1e1e2e;border:1px solid #333;border-radius:8px;padding:12px;position:relative;">';
    html += '<div style="font-size:11px;color:#888;margin-bottom:6px;word-break:break-all;" title="' + fp + '">' + fp + '</div>';
    html += '<pre id="batchDlPreview_' + i + '" style="background:#0d1117;color:#cdd6f4;padding:8px;border-radius:4px;font-size:11px;max-height:150px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;">Loading...</pre>';
    html += '<div style="margin-top:8px;text-align:right;">';
    html += '<button class="btn-primary btn-sm" onclick="batchDlExpand(\'' + fp.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\',\'' + addr + '\')" style="font-size:11px;padding:3px 8px;">🔍 Expand</button>';
    html += '</div></div>';
  }
  html += '</div>';
  resultEl.innerHTML = html;

  // Load previews asynchronously
  for (var j = 0; j < found.length; j++) {
    (function(idx, filePath) {
      fetch('/files/batch-edit-read', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path: filePath, addr: addr})
      }).then(function(r) { return r.json(); }).then(function(d) {
        var el = document.getElementById('batchDlPreview_' + idx);
        if (el) {
          if (d.error) { el.textContent = 'Error: ' + d.error; }
          else {
            var content = d.content || '';
            var lines = content.split('\n');
            var preview = lines.slice(0, 20).join('\n');
            if (lines.length > 20) preview += '\n... (' + lines.length + ' lines total)';
            el.textContent = preview;
          }
        }
      });
    })(j, found[j]);
  }
}

function batchDlExpand(filePath, addr) {
  // Create a read-only modal for viewing
  var modal = document.createElement('div');
  modal.id = 'batchDlModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = '<div style="background:#1e1e2e;border-radius:10px;padding:20px;width:80%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
    '<div style="font-size:12px;color:#888;word-break:break-all;flex:1;margin-right:12px;">' + filePath + '</div>' +
    '<button class="btn-danger btn-sm" onclick="document.getElementById(\'batchDlModal\').remove()" style="font-size:14px;padding:4px 10px;">✕</button>' +
    '</div>' +
    '<pre id="batchDlModalContent" style="flex:1;background:#0d1117;color:#cdd6f4;border:1px solid #444;border-radius:6px;padding:12px;font-family:monospace;font-size:12px;overflow:auto;min-height:400px;white-space:pre-wrap;word-break:break-all;margin:0;">Loading...</pre>' +
    '<div style="margin-top:12px;text-align:right;">' +
    '<button class="btn-danger btn-sm" onclick="document.getElementById(\'batchDlModal\').remove()" style="padding:6px 12px;">Close</button>' +
    '</div></div>';
  document.body.appendChild(modal);

  // Load full content
  fetch('/files/batch-edit-read', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({path: filePath, addr: addr})
  }).then(function(r) { return r.json(); }).then(function(d) {
    var el = document.getElementById('batchDlModalContent');
    if (d.error) { el.textContent = 'Error: ' + d.error; }
    else { el.textContent = d.content || ''; }
  });
}



// ---------------------------------------------------------------------------
// Repeat Number Position Calculation
// ---------------------------------------------------------------------------
function rnpCalculate() {
  var input = document.getElementById('rnpCardsInput').value.trim();
  var resultEl = document.getElementById('rnpResult');
  if (!input) { resultEl.textContent = 'Please enter cards data'; return; }

  var cards;
  try { cards = JSON.parse(input); } catch(e) { resultEl.textContent = 'Invalid JSON: ' + e.message; return; }
  if (!Array.isArray(cards) || cards.length === 0) { resultEl.textContent = 'Input must be a non-empty array'; return; }

  // Group indices by number value
  var groups = {};
  for (var i = 0; i < cards.length; i++) {
    var num = cards[i];
    if (!groups[num]) groups[num] = [];
    groups[num].push(i);
  }

  // Filter groups with more than 1 occurrence (repeat numbers)
  var result = [];
  var keys = Object.keys(groups);
  for (var k = 0; k < keys.length; k++) {
    if (groups[keys[k]].length > 1) {
      result.push(groups[keys[k]]);
    }
  }

  // Sort by group size descending, then by first index ascending
  result.sort(function(a, b) {
    if (b.length !== a.length) return b.length - a.length;
    return a[0] - b[0];
  });

  // Display result — one group per line with copy button
  if (result.length === 0) {
    resultEl.innerHTML = 'No repeat numbers found';
  } else {
    var lines = result.map(function(g) { return JSON.stringify(g); });
    var text = '[' + lines.join(',\n') + ']';
    resultEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span style="font-size:12px;color:#666;">Result (' + result.length + ' groups)</span><span onclick="rnpCopyResult()" style="cursor:pointer;font-size:16px;" title="Copy">📋</span></div><pre id="rnpResultText" style="margin:0;white-space:pre-wrap;word-break:break-all;">' + text + '</pre>';
  }
}

function rnpCopyResult() {
  var text = document.getElementById('rnpResultText');
  if (!text) return;
  navigator.clipboard.writeText(text.textContent).then(function() {
    var btn = text.parentElement.querySelector('span[onclick]');
    if (btn) { btn.textContent = '✅'; setTimeout(function() { btn.textContent = '📋'; }, 2000); }
  });
}

