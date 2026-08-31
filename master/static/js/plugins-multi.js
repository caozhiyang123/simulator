// ---------------------------------------------------------------------------
// Batch Upload File (multi-node)
// ---------------------------------------------------------------------------
function getBatchUpMultiSrcFiles() {
  var inputs = document.querySelectorAll('#batchUpMultiSrcFiles .batch-up-multi-src-file');
  var files = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) files.push(v); });
  return files;
}
function getBatchUpMultiTargetDirs() {
  var inputs = document.querySelectorAll('#batchUpMultiTargetDirs .batch-up-multi-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function getBatchUpMultiExcludeDirs() {
  var inputs = document.querySelectorAll('#batchUpMultiExcludeDirs .batch-up-multi-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchUpMultiSrcFile() {
  var container = document.getElementById('batchUpMultiSrcFiles');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-up-multi-src-file" placeholder="e.g. D:\\tools2\\path\\to\\file.jar" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchUpMultiTargetDir() {
  var container = document.getElementById('batchUpMultiTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-up-multi-target-dir" placeholder="e.g. simulator/B2BGameSimulator/lib" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchUpMultiExcludeDir() {
  var container = document.getElementById('batchUpMultiExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-up-multi-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

function showBatchUpMultiProgress() {
  var mask = document.getElementById('batchUpMultiProgressMask');
  var bar = document.getElementById('batchUpMultiProgressBar');
  var text = document.getElementById('batchUpMultiProgressText');
  bar.style.transition = 'none'; bar.style.width = '0%'; text.textContent = 'Uploading...';
  mask.style.display = 'block';
}
function hideBatchUpMultiProgress() {
  var mask = document.getElementById('batchUpMultiProgressMask');
  var bar = document.getElementById('batchUpMultiProgressBar');
  var text = document.getElementById('batchUpMultiProgressText');
  bar.style.transition = 'width 0.3s ease'; bar.style.width = '100%'; text.textContent = '100%';
  setTimeout(function() { mask.style.display = 'none'; bar.style.transition = 'none'; bar.style.width = '0%'; }, 800);
}

function renderBatchMultiResultByNode(results, actionLabel, listKeys) {
  // results: {addr: {copied|replaced|found: [...], errors: [...]} | {error: "..."}}
  var html = '';
  Object.keys(results).forEach(function(addr) {
    var r = results[addr] || {};
    html += '<div style="margin-bottom:12px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">🖥 ' + addr + '</div>';
    if (r.error) {
      html += '<div style="color:#e74c3c;">❌ ' + r.error + '</div>';
      html += '</div>';
      return;
    }
    var items = [];
    listKeys.forEach(function(k) { if (r[k]) items = items.concat(r[k]); });
    html += '<div style="color:#27ae60;">✅ ' + actionLabel + ' ' + items.length + ' item(s)</div>';
    if (items.length > 0) {
      html += '<div style="background:#1e1e2e;color:#a6e3a1;padding:10px;border-radius:6px;font-family:monospace;font-size:11px;max-height:200px;overflow-y:auto;margin-top:4px;">';
      items.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
    var errs = r.errors || [];
    if (errs.length > 0) {
      html += '<div style="color:#e74c3c;font-weight:600;margin-top:4px;">❌ Failed (' + errs.length + '):</div>';
      html += '<div style="background:#1e1e2e;color:#f38ba8;padding:10px;border-radius:6px;font-family:monospace;font-size:11px;max-height:150px;overflow-y:auto;">';
      errs.forEach(function(p) { html += '<div>' + p + '</div>'; });
      html += '</div>';
    }
    html += '</div>';
  });
  return html || '<div style="color:#888;">No results.</div>';
}

async function doBatchUpMultiCheck() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchUpMultiNodeCbs');
  var srcFiles = getBatchUpMultiSrcFiles();
  var dirs = getBatchUpMultiTargetDirs();
  var excludes = getBatchUpMultiExcludeDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!srcFiles.length) { showAlert('Please enter at least one source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchUpMultiResult');
  resultEl.innerHTML = '<div style="color:#888;">Checking ' + addrs.length + ' node(s)...</div>';

  var res = await fetch('/files/batch-multi-up-check', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({src_files: srcFiles, target_dirs: dirs, exclude_dirs: excludes, addrs: addrs})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  resultEl.innerHTML = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">🔍 Check results per node:</div>' +
    renderBatchMultiResultByNode(data.results || {}, 'Found', ['found']);
}

async function doBatchUpMultiUpload() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchUpMultiNodeCbs');
  var srcFiles = getBatchUpMultiSrcFiles();
  var dirs = getBatchUpMultiTargetDirs();
  var excludes = getBatchUpMultiExcludeDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!srcFiles.length) { showAlert('Please enter at least one source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }

  showBatchUpMultiProgress();
  var resultEl = document.getElementById('batchUpMultiResult');
  try {
    var res = await fetch('/files/batch-multi-up-upload', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({src_files: srcFiles, target_dirs: dirs, exclude_dirs: excludes, addrs: addrs})
    });
    var data = await res.json();
    hideBatchUpMultiProgress();
    if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
    resultEl.innerHTML = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">⬆️ Upload results per node:</div>' +
      renderBatchMultiResultByNode(data.results || {}, 'Uploaded', ['copied']);
  } catch (e) {
    hideBatchUpMultiProgress();
    resultEl.innerHTML = '<div style="color:#e74c3c;">❌ Upload failed: ' + e.message + '</div>';
  }
}

// ---------------------------------------------------------------------------
// Batch Override File (multi-node)
// ---------------------------------------------------------------------------
function getBatchOverrideMultiSrcFiles() {
  var inputs = document.querySelectorAll('#batchOverrideMultiSrcFiles .batch-override-multi-src');
  var files = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) files.push(v); });
  return files;
}
function getBatchOverrideMultiTargetDirs() {
  var inputs = document.querySelectorAll('#batchOverrideMultiTargetDirs .batch-override-multi-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function getBatchOverrideMultiExcludeDirs() {
  var inputs = document.querySelectorAll('#batchOverrideMultiExcludeDirs .batch-override-multi-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchOverrideMultiSrc() {
  var container = document.getElementById('batchOverrideMultiSrcFiles');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-override-multi-src" placeholder="e.g. D:\\path\\to\\file.jar" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchOverrideMultiTargetDir() {
  var container = document.getElementById('batchOverrideMultiTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-override-multi-target-dir" placeholder="e.g. E:/python/workSpace/temp/ShowBingoSim/SimC*/math/ManilaBingo/configuration" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchOverrideMultiExcludeDir() {
  var container = document.getElementById('batchOverrideMultiExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-override-multi-exclude-dir" placeholder="e.g. E:/python/workSpace/temp/ShowBingoSim/SimC1" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

async function doBatchOverrideMultiCheck() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchOverrideMultiNodeCbs');
  var sources = getBatchOverrideMultiSrcFiles();
  var dirs = getBatchOverrideMultiTargetDirs();
  var excludes = getBatchOverrideMultiExcludeDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!sources.length) { showAlert('Please enter at least one source file path'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchOverrideMultiResult');
  resultEl.innerHTML = '<div style="color:#888;">Checking ' + addrs.length + ' node(s)...</div>';

  var res = await fetch('/files/batch-multi-check', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sources: sources, target_dirs: dirs, exclude_dirs: excludes, addrs: addrs})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  resultEl.innerHTML = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">🔍 Check results per node:</div>' +
    renderBatchMultiResultByNode(data.results || {}, 'Found', ['found']);
}

async function doBatchOverrideMultiOverride() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchOverrideMultiNodeCbs');
  var sources = getBatchOverrideMultiSrcFiles();
  var dirs = getBatchOverrideMultiTargetDirs();
  var excludes = getBatchOverrideMultiExcludeDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!sources.length) { showAlert('Please enter at least one source file path'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchOverrideMultiResult');
  resultEl.innerHTML = '<div style="color:#888;">Overriding on ' + addrs.length + ' node(s)...</div>';

  var res = await fetch('/files/batch-multi-override', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sources: sources, target_dirs: dirs, exclude_dirs: excludes, addrs: addrs})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
  resultEl.innerHTML = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">📦 Override results per node:</div>' +
    renderBatchMultiResultByNode(data.results || {}, 'Overridden', ['replaced']);
}

// ---------------------------------------------------------------------------
// Batch Download File (multi-node, combined zip)
// ---------------------------------------------------------------------------
var _batchDlMultiFoundByNode = {}; // {addr: [filePath, ...]}

function getBatchDlMultiFileNames() {
  var inputs = document.querySelectorAll('#batchDlMultiFileNames .batch-dl-multi-filename');
  var names = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) names.push(v); });
  return names;
}
function addBatchDlMultiFileName() {
  var container = document.getElementById('batchDlMultiFileNames');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-dl-multi-filename" placeholder="e.g. CalacaBingo*.txt or config.json" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function getBatchDlMultiTargetDirs() {
  var inputs = document.querySelectorAll('#batchDlMultiTargetDirs .batch-dl-multi-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function getBatchDlMultiExcludeDirs() {
  var inputs = document.querySelectorAll('#batchDlMultiExcludeDirs .batch-dl-multi-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchDlMultiTargetDir() {
  var container = document.getElementById('batchDlMultiTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-dl-multi-target-dir" placeholder="e.g. E:/python/workSpace/temp/ShowBingoSim" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function addBatchDlMultiExcludeDir() {
  var container = document.getElementById('batchDlMultiExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-dl-multi-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

function showBatchDlMultiProgress() {
  var mask = document.getElementById('batchDlMultiProgressMask');
  var bar = document.getElementById('batchDlMultiProgressBar');
  var text = document.getElementById('batchDlMultiProgressText');
  bar.style.transition = 'none'; bar.style.width = '0%'; text.textContent = 'Preparing...';
  mask.style.display = 'block';
}
function hideBatchDlMultiProgress() {
  var mask = document.getElementById('batchDlMultiProgressMask');
  var bar = document.getElementById('batchDlMultiProgressBar');
  var text = document.getElementById('batchDlMultiProgressText');
  bar.style.transition = 'width 0.3s ease'; bar.style.width = '100%'; text.textContent = '100%';
  setTimeout(function() { mask.style.display = 'none'; bar.style.transition = 'none'; bar.style.width = '0%'; }, 800);
}

async function doBatchDlMultiCheck() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchDlMultiNodeCbs');
  var filenames = getBatchDlMultiFileNames();
  var dirs = getBatchDlMultiTargetDirs();
  var excludes = getBatchDlMultiExcludeDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!filenames.length) { showAlert('Please enter at least one source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchDlMultiResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching ' + addrs.length + ' node(s) for ' + filenames.length + ' pattern(s)...</div>';

  // Check each filename pattern separately and merge results per node
  _batchDlMultiFoundByNode = {};
  var allResults = {};
  for (var i = 0; i < filenames.length; i++) {
    var res = await fetch('/files/batch-multi-dl-check', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: filenames[i], target_dirs: dirs, exclude_dirs: excludes, addrs: addrs})
    });
    var data = await res.json();
    if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
    var results = data.results || {};
    Object.keys(results).forEach(function(addr) {
      if (!allResults[addr]) allResults[addr] = {found: [], count: 0};
      var nodeFound = (results[addr] && results[addr].found) || [];
      allResults[addr].found = allResults[addr].found.concat(nodeFound);
      allResults[addr].count = allResults[addr].found.length;
    });
  }
  // Deduplicate per node
  Object.keys(allResults).forEach(function(addr) {
    allResults[addr].found = Array.from(new Set(allResults[addr].found));
    allResults[addr].count = allResults[addr].found.length;
    _batchDlMultiFoundByNode[addr] = allResults[addr].found;
  });
  resultEl.innerHTML = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">🔍 Search results per node (all found files will be included in the combined download):</div>' +
    renderBatchMultiResultByNode(allResults, 'Found', ['found']);
}

async function doBatchDlMultiDownload() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchDlMultiNodeCbs');
  var dirs = getBatchDlMultiTargetDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var hasFiles = addrs.some(function(a) { return (_batchDlMultiFoundByNode[a] || []).length > 0; });
  if (!hasFiles) { showAlert('No files found yet. Please run Check All Files first.'); return; }

  showBatchDlMultiProgress();
  var resultEl = document.getElementById('batchDlMultiResult');
  var perNodeFiles = {};
  addrs.forEach(function(a) { perNodeFiles[a] = _batchDlMultiFoundByNode[a] || []; });

  try {
    var res = await fetch('/files/batch-multi-dl-download', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({addrs: addrs, target_dirs: dirs, per_node_files: perNodeFiles})
    });
    if (!res.ok) {
      var errData = await res.json();
      hideBatchDlMultiProgress();
      resultEl.innerHTML = '<div style="color:#e74c3c;">❌ Download failed: ' + (errData.error || 'Unknown error') + '</div>';
      return;
    }
    var blob = await res.blob();
    hideBatchDlMultiProgress();
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'batch_multi_download.zip';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    resultEl.innerHTML = '<div style="color:#27ae60;">✅ Combined zip downloaded (one subfolder per node).</div>';
  } catch (e) {
    hideBatchDlMultiProgress();
    resultEl.innerHTML = '<div style="color:#e74c3c;">❌ Download failed: ' + e.message + '</div>';
  }
}

// ---------------------------------------------------------------------------
// Batch Delete File (multi-node)
// ---------------------------------------------------------------------------
var _batchDelMultiFoundByNode = {}; // {addr: [filePath, ...]}

function getBatchDelMultiPatterns() {
  var inputs = document.querySelectorAll('#batchDelMultiPatterns .batch-del-multi-pattern');
  var patterns = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) patterns.push(v); });
  return patterns;
}
function addBatchDelMultiPattern() {
  var container = document.getElementById('batchDelMultiPatterns');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-del-multi-pattern" placeholder="e.g. CalacaBingo*.txt" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function getBatchDelMultiTargetDirs() {
  var inputs = document.querySelectorAll('#batchDelMultiTargetDirs .batch-del-multi-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchDelMultiTargetDir() {
  var container = document.getElementById('batchDelMultiTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-del-multi-target-dir" placeholder="e.g. E:/python/workSpace/temp/ShowBingoSim/SimC*/math" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function getBatchDelMultiExcludeDirs() {
  var inputs = document.querySelectorAll('#batchDelMultiExcludeDirs .batch-del-multi-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addBatchDelMultiExcludeDir() {
  var container = document.getElementById('batchDelMultiExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="batch-del-multi-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

async function doBatchDelMultiCheck() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchDelMultiNodeCbs');
  var patterns = getBatchDelMultiPatterns();
  var dirs = getBatchDelMultiTargetDirs();
  var excludes = getBatchDelMultiExcludeDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!patterns.length) { showAlert('Please enter at least one file pattern'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('batchDelMultiResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching ' + addrs.length + ' node(s) for ' + patterns.length + ' pattern(s)...</div>';

  // Search each pattern and merge results per node
  _batchDelMultiFoundByNode = {};
  var allResults = {};
  for (var i = 0; i < patterns.length; i++) {
    var res = await fetch('/files/batch-multi-dl-check', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: patterns[i], target_dirs: dirs, exclude_dirs: excludes, addrs: addrs})
    });
    var data = await res.json();
    if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
    var results = data.results || {};
    Object.keys(results).forEach(function(addr) {
      if (!allResults[addr]) allResults[addr] = {found: [], count: 0};
      var nodeFound = (results[addr] && results[addr].found) || [];
      allResults[addr].found = allResults[addr].found.concat(nodeFound);
      allResults[addr].count = allResults[addr].found.length;
    });
  }
  // Deduplicate per node
  Object.keys(allResults).forEach(function(addr) {
    allResults[addr].found = Array.from(new Set(allResults[addr].found));
    allResults[addr].count = allResults[addr].found.length;
    _batchDelMultiFoundByNode[addr] = allResults[addr].found;
  });
  resultEl.innerHTML = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">🔍 Search results per node (all found files will be deleted):</div>' +
    renderBatchMultiResultByNode(allResults, 'Found', ['found']);
}

async function doBatchDelMultiDelete() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('batchDelMultiNodeCbs');
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  var hasFiles = addrs.some(function(a) { return (_batchDelMultiFoundByNode[a] || []).length > 0; });
  if (!hasFiles) { showAlert('No files found yet. Please run Check All Files first.'); return; }

  var totalCount = 0;
  addrs.forEach(function(a) { totalCount += (_batchDelMultiFoundByNode[a] || []).length; });
  if (!confirm('⚠️ Are you sure you want to DELETE ' + totalCount + ' file(s) across ' + addrs.length + ' node(s)?\n\nThis operation cannot be undone!')) return;

  var resultEl = document.getElementById('batchDelMultiResult');
  resultEl.innerHTML = '<div style="color:#888;">Deleting files on ' + addrs.length + ' node(s)...</div>';

  // Delete sequentially per node using the existing single-node endpoint
  var allNodeResults = {};
  for (var i = 0; i < addrs.length; i++) {
    var addr = addrs[i];
    var files = _batchDelMultiFoundByNode[addr] || [];
    if (!files.length) continue;
    try {
      var res = await fetch('/files/batch-delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({files: files, addr: addr})
      });
      var data = await res.json();
      allNodeResults[addr] = data;
    } catch (e) {
      allNodeResults[addr] = {error: e.message};
    }
  }
  resultEl.innerHTML = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">🗑️ Delete results per node:</div>' +
    renderBatchMultiResultByNode(allNodeResults, 'Deleted', ['deleted']);
}

// ---------------------------------------------------------------------------
// Bingo Machine Statistic Analysis (multi-node)
// ---------------------------------------------------------------------------
var _saFoundByNode = {}; // {addr: [filePath, ...]}
var _saLastMergeText = ''; // for download

function getSaFileNames() {
  var inputs = document.querySelectorAll('#saFileNames .sa-filename');
  var names = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) names.push(v); });
  return names;
}
function addSaFileName() {
  var container = document.getElementById('saFileNames');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="sa-filename" placeholder="e.g. MegaJackpot_94_medium_vi*.txt" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function getSaTargetDirs() {
  var inputs = document.querySelectorAll('#saTargetDirs .sa-target-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addSaTargetDir() {
  var container = document.getElementById('saTargetDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="sa-target-dir" placeholder="e.g. E:/path/to/dir" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}
function getSaExcludeDirs() {
  var inputs = document.querySelectorAll('#saExcludeDirs .sa-exclude-dir');
  var dirs = [];
  inputs.forEach(function(el) { var v = el.value.trim(); if (v) dirs.push(v); });
  return dirs;
}
function addSaExcludeDir() {
  var container = document.getElementById('saExcludeDirs');
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
  row.innerHTML = '<input type="text" class="sa-exclude-dir" placeholder="e.g. E:/path/to/exclude" style="flex:1;margin-bottom:0;"><button class="btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remove" style="width:28px;height:28px;padding:0;font-size:14px;">−</button>';
  container.appendChild(row);
}

async function doSaCheck() {
  _saveAllBatchInputHistory();
  var addrs = getBatchMultiNodeAddrs('saMultiNodeCbs');
  var filenames = getSaFileNames();
  var dirs = getSaTargetDirs();
  var excludes = getSaExcludeDirs();
  if (!addrs.length) { showAlert('Please select at least one node'); return; }
  if (!filenames.length) { showAlert('Please enter at least one source file name'); return; }
  if (!dirs.length) { showAlert('Please enter at least one target directory'); return; }
  var resultEl = document.getElementById('saResult');
  resultEl.innerHTML = '<div style="color:#888;">Searching ' + addrs.length + ' node(s) for ' + filenames.length + ' pattern(s)...</div>';

  _saFoundByNode = {};
  var allResults = {};
  for (var i = 0; i < filenames.length; i++) {
    var res = await fetch('/files/batch-multi-dl-check', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: filenames[i], target_dirs: dirs, exclude_dirs: excludes, addrs: addrs})
    });
    var data = await res.json();
    if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }
    var results = data.results || {};
    Object.keys(results).forEach(function(addr) {
      if (!allResults[addr]) allResults[addr] = {found: [], count: 0};
      var nodeFound = (results[addr] && results[addr].found) || [];
      allResults[addr].found = allResults[addr].found.concat(nodeFound);
    });
  }
  // Deduplicate per node
  Object.keys(allResults).forEach(function(addr) {
    allResults[addr].found = Array.from(new Set(allResults[addr].found));
    allResults[addr].count = allResults[addr].found.length;
    _saFoundByNode[addr] = allResults[addr].found;
  });

  // Render with per-file checkboxes
  var html = '<div style="font-weight:600;color:#4a90d9;margin-bottom:8px;">🔍 Found files per node:</div>';
  html += '<div style="margin-bottom:8px;">';
  html += '<button class="btn-primary btn-sm" onclick="saSelectAll()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select All</button>';
  html += '<button class="btn-primary btn-sm" onclick="saSelectNone()" style="margin-right:4px;font-size:11px;padding:3px 8px;">Select None</button>';
  html += '<button class="btn-primary btn-sm" onclick="saSelectInverse()" style="font-size:11px;padding:3px 8px;">Inverse</button>';
  html += '</div>';

  Object.keys(allResults).forEach(function(addr) {
    var files = allResults[addr].found || [];
    html += '<div style="margin-bottom:12px;">';
    html += '<div style="font-weight:600;margin-bottom:4px;">🖥 ' + addr + ' (' + files.length + ' files)</div>';
    if (files.length > 0) {
      html += '<div style="background:#1e1e2e;color:#cdd6f4;padding:10px;border-radius:6px;font-family:monospace;font-size:11px;max-height:200px;overflow-y:auto;">';
      files.forEach(function(fp) {
        html += '<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;">';
        html += '<input type="checkbox" class="sa-file-cb" data-addr="' + addr + '" data-path="' + fp.replace(/"/g, '&quot;') + '" checked>';
        html += '<span>' + fp + '</span></label>';
      });
      html += '</div>';
    } else {
      html += '<div style="color:#888;">No matching files.</div>';
    }
    html += '</div>';
  });
  resultEl.innerHTML = html;
}

function saSelectAll() { document.querySelectorAll('.sa-file-cb').forEach(function(cb) { cb.checked = true; }); }
function saSelectNone() { document.querySelectorAll('.sa-file-cb').forEach(function(cb) { cb.checked = false; }); }
function saSelectInverse() { document.querySelectorAll('.sa-file-cb').forEach(function(cb) { cb.checked = !cb.checked; }); }

function getSelectedSaFiles() {
  // Returns {addr: [filePath, ...]}
  var result = {};
  document.querySelectorAll('.sa-file-cb:checked').forEach(function(cb) {
    var addr = cb.dataset.addr;
    var path = cb.dataset.path;
    if (!result[addr]) result[addr] = [];
    result[addr].push(path);
  });
  return result;
}

async function doSaMerge() {
  _saveAllBatchInputHistory();
  var gameType = document.getElementById('saGameType').value;
  if (!gameType) { showAlert('Please select a game type (Bingo or Slot)'); return; }
  var perNodeFiles = getSelectedSaFiles();
  var addrs = Object.keys(perNodeFiles);
  if (!addrs.length) { showAlert('No files selected. Please run Check All Files first and select files.'); return; }

  var resultEl = document.getElementById('saResult');
  resultEl.innerHTML = '<div style="color:#888;">Analyzing statistics...</div>';

  var res = await fetch('/statistic-analysis/merge', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({game_type: gameType, per_node_files: perNodeFiles, addrs: addrs})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }

  var results = data.results || [];
  var fields = data.fields || [];
  var errors = data.errors || [];
  var includePatternCount = data.include_pattern_count || false;

  var textOutput = '=== Statistic Analysis: ' + gameType.toUpperCase() + ' ===\n';
  textOutput += 'Generated: ' + new Date().toLocaleString() + '\n\n';

  var html = '<div style="font-weight:600;color:#4a90d9;margin-bottom:12px;">📊 Merged Results (' + results.length + ' group(s))';
  html += ' <span onclick="saCopyResult()" style="cursor:pointer;font-size:16px;margin-left:8px;" title="Copy all results">📋</span>';
  html += '</div>';

  if (errors.length > 0) {
    html += '<div style="color:#e74c3c;margin-bottom:12px;">⚠️ Warnings (' + errors.length + '):<br>';
    errors.forEach(function(e) { html += '<span style="font-size:11px;">' + e + '</span><br>'; });
    html += '</div>';
    textOutput += 'WARNINGS:\n' + errors.join('\n') + '\n\n';
  }

  results.forEach(function(group) {
    html += '<div class="card" style="margin-bottom:12px;padding:12px;">';
    html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">📁 ' + group.group + ' <span style="color:#888;font-size:11px;">(' + group.file_count + ' file(s) merged)</span></div>';

    // Merged data table
    html += '<table class="result-table" style="margin-bottom:8px;"><tr><th>Field</th><th>Value</th></tr>';
    textOutput += '--- ' + group.group + ' (' + group.file_count + ' files merged) ---\n';
    fields.forEach(function(field) {
      var val = group.merged[field];
      var display = val !== null && val !== undefined ? val.toLocaleString() : 'N/A';
      html += '<tr><td>' + field + '</td><td>' + display + '</td></tr>';
      textOutput += field + ': ' + (val !== null && val !== undefined ? val : 'N/A') + '\n';
    });
    html += '</table>';

    // Pattern count table (when configured via pattern_count: true)
    if (includePatternCount && group.pattern_count && group.pattern_count.length > 0) {
      html += '<div style="margin-top:8px;margin-bottom:8px;">';
      html += '<div style="font-weight:600;font-size:12px;margin-bottom:4px;">pattern   count</div>';
      html += '<table class="result-table"><tr><th>Pattern</th><th>Count</th></tr>';
      textOutput += '\npattern   count\n';
      group.pattern_count.forEach(function(pc) {
        html += '<tr><td>' + pc.pattern + '</td><td>' + pc.count.toLocaleString() + '</td></tr>';
        textOutput += pc.pattern + ',      ' + pc.count + ',\n';
      });
      html += '</table></div>';
    }

    textOutput += '\nSource files:\n';

    // Source files
    html += '<details><summary style="cursor:pointer;font-size:11px;color:#4a90d9;">Source files (' + group.sources.length + ')</summary>';
    html += '<div style="font-size:11px;color:#888;margin-top:4px;">';
    group.sources.forEach(function(s) {
      html += '<div>' + s.addr + ': ' + s.file + '</div>';
      textOutput += '  ' + s.addr + ': ' + s.file + '\n';
    });
    html += '</div></details>';
    html += '</div>';
    textOutput += '\n';
  });

  _saLastMergeText = textOutput;
  resultEl.innerHTML = html;
}

function saCopyResult() {
  if (!_saLastMergeText) { showAlert('No results to copy'); return; }
  navigator.clipboard.writeText(_saLastMergeText).then(function() {
    showAlert('Results copied to clipboard!');
  });
}

function doSaDownload() {
  if (!_saLastMergeText) { showAlert('No results to download. Run Statistic Analysis first.'); return; }
  var blob = new Blob([_saLastMergeText], {type: 'text/plain'});
  var url = window.URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'statistic_analysis_' + new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19) + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
