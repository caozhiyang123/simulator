// ---------------------------------------------------------------------------
// Version Management
// Simulation / Java version scanning (SHA1 + SHA256) and saved-version records.
// Depends on globals from main.js: api(), log(), showAlert(), escapeDynamicHtml().
// Loaded via a <script> tag in index.html before main.js.
// ---------------------------------------------------------------------------

// Latest scan results, reused when saving a version (avoids a re-scan).
var versionScanData = { simulation: [], java: [] };
// Sort direction per scan table for the File (full path) column ('asc' | 'desc').
var versionSortDir = { simulation: 'asc', java: 'asc' };

function versionInit() {
  versionScan();
  loadVersionRecords();
}

// Extract the file name (basename) from a full path, ignoring the directory.
function versionFileName(f) {
  if (f && f.name) return f.name;
  var p = (f && f.path) || '';
  var parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

// Sort scanned files by file name (basename) using locale-aware (dictionary)
// comparison, so files with the same name group together regardless of their
// absolute directory. Full path is used as a tiebreaker for stable ordering.
function versionSortFilesByPath(files, dir) {
  var opts = { numeric: true, sensitivity: 'base' };
  var sorted = (files || []).slice();
  sorted.sort(function(a, b) {
    var cmp = versionFileName(a).localeCompare(versionFileName(b), undefined, opts);
    if (cmp === 0) {
      cmp = (a.path || '').localeCompare((b.path || ''), undefined, opts);
    }
    return dir === 'desc' ? -cmp : cmp;
  });
  return sorted;
}

// Toggle the File (full path) sort direction for a scan table and re-render.
function versionToggleSort(type) {
  versionSortDir[type] = (versionSortDir[type] === 'asc') ? 'desc' : 'asc';
  var elId = (type === 'simulation') ? 'simVersionScan' : 'javaVersionScan';
  var el = document.getElementById(elId);
  if (el) el.innerHTML = versionScanTableHtml(versionScanData[type], type);
}

// Scan production_dir on the master and render both jar tables.
async function versionScan() {
  var simEl = document.getElementById('simVersionScan');
  var javaEl = document.getElementById('javaVersionScan');
  if (simEl) simEl.innerHTML = '<span style="color:#999;">Scanning...</span>';
  if (javaEl) javaEl.innerHTML = '<span style="color:#999;">Scanning...</span>';

  var r = await api('/version/scan?_=' + Date.now(), 'GET');
  if (!r.ok) {
    var msg = (r.data && r.data.error) ? r.data.error : 'Scan failed';
    if (simEl) simEl.innerHTML = '<span style="color:#e74c3c;">' + escapeDynamicHtml(msg) + '</span>';
    if (javaEl) javaEl.innerHTML = '<span style="color:#e74c3c;">' + escapeDynamicHtml(msg) + '</span>';
    return;
  }

  var prodEl = document.getElementById('versionProdDir');
  if (prodEl) prodEl.textContent = 'production_dir: ' + (r.data.production_dir || '');

  versionScanData.simulation = r.data.simulation || [];
  versionScanData.java = r.data.java || [];

  if (simEl) simEl.innerHTML = versionScanTableHtml(versionScanData.simulation, 'simulation');
  if (javaEl) javaEl.innerHTML = versionScanTableHtml(versionScanData.java, 'java');
}

// Identify file names that appear multiple times but with differing SHA1 or
// SHA256 hashes. Returns a Set-like object {name: true} of mismatched names,
// so all rows sharing such a name can be highlighted for the user.
function versionMismatchedNames(files) {
  var byName = {};
  (files || []).forEach(function(f) {
    var name = versionFileName(f);
    if (!byName[name]) byName[name] = { sha1: {}, sha256: {} };
    byName[name].sha1[(f.sha1 || '').toUpperCase()] = true;
    byName[name].sha256[(f.sha256 || '').toUpperCase()] = true;
  });
  var mismatched = {};
  Object.keys(byName).forEach(function(name) {
    var g = byName[name];
    // More than one distinct SHA1 OR SHA256 value for the same file name.
    if (Object.keys(g.sha1).length > 1 || Object.keys(g.sha256).length > 1) {
      mismatched[name] = true;
    }
  });
  return mismatched;
}

// Build a jar hash table: full path (sortable), SHA1, SHA256.
// The File (full path) header is clickable to sort dictionary asc/desc.
// Rows whose file name appears with differing SHA1/SHA256 are highlighted.
function versionScanTableHtml(files, type) {
  if (!files || !files.length) {
    return '<span style="color:#999;">No matching jar files found.</span>';
  }
  var dir = versionSortDir[type] || 'asc';
  var arrow = dir === 'desc' ? ' ▼' : ' ▲';
  var sorted = versionSortFilesByPath(files, dir);
  var mismatched = versionMismatchedNames(files);
  var hasMismatch = Object.keys(mismatched).length > 0;

  var html = '';
  if (hasMismatch) {
    html += '<div style="color:#e74c3c;font-size:12px;font-weight:600;margin-bottom:6px;">' +
      '⚠️ Same file name with different SHA1/SHA256 detected (highlighted below).</div>';
  }
  html += '<table class="result-table" style="font-size:11px;"><tr>' +
    '<th onclick="versionToggleSort(\'' + type + '\')" style="cursor:pointer;user-select:none;">File (full path)' + arrow + '</th>' +
    '<th>SHA1</th><th>SHA256</th></tr>';
  sorted.forEach(function(f) {
    var bad = mismatched[versionFileName(f)];
    var rowStyle = bad ? ' style="background:#fdecea;"' : '';
    var cellColor = bad ? 'color:#c0392b;font-weight:600;' : '';
    html += '<tr' + rowStyle + '>';
    html += '<td style="font-family:monospace;' + cellColor + '">' + escapeDynamicHtml(f.path) + '</td>';
    html += '<td style="font-family:monospace;word-break:break-all;' + cellColor + '">' + escapeDynamicHtml(f.sha1 || '-') + '</td>';
    html += '<td style="font-family:monospace;word-break:break-all;' + cellColor + '">' + escapeDynamicHtml(f.sha256 || '-') + '</td>';
    html += '</tr>';
  });
  html += '</table>';
  return html;
}

// Save the currently-scanned files as a named version (simulation | java).
async function versionSave(type) {
  var nameEl = document.getElementById(type === 'simulation' ? 'simVersionName' : 'javaVersionName');
  var version = (nameEl && nameEl.value || '').trim();
  if (!version) { showAlert('Please enter a version name (e.g. v1.0)'); return; }

  var files = (type === 'simulation') ? versionScanData.simulation : versionScanData.java;
  if (!files || !files.length) {
    if (!confirm('No scanned files for this type. Save an empty version anyway?')) return;
  }

  var r = await api('/version/save', 'POST', {
    type: type,
    version: version,
    files: files || []
  });
  if (!r.ok) {
    showAlert('Save failed: ' + ((r.data && r.data.error) || 'unknown'));
    return;
  }
  if (nameEl) nameEl.value = '';
  log('✅ Saved ' + type + ' version ' + version);
  loadVersionRecords();
}

// Load and render saved version records, split by type.
async function loadVersionRecords() {
  var r = await api('/version/list?_=' + Date.now(), 'GET');
  var simEl = document.getElementById('simVersionSaved');
  var javaEl = document.getElementById('javaVersionSaved');
  if (!r.ok) {
    if (simEl) simEl.innerHTML = '';
    if (javaEl) javaEl.innerHTML = '';
    return;
  }
  var records = r.data.records || [];
  if (simEl) simEl.innerHTML = versionRecordsHtml(records.filter(function(x) { return x.type === 'simulation'; }));
  if (javaEl) javaEl.innerHTML = versionRecordsHtml(records.filter(function(x) { return x.type === 'java'; }));
}

function versionRecordsHtml(records) {
  if (!records || !records.length) {
    return '<span style="color:#999;">No saved versions</span>';
  }
  var html = '';
  records.forEach(function(rec) {
    html += '<div style="border:1px solid #eee;border-radius:6px;padding:8px;margin-bottom:8px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
    html += '<strong>' + escapeDynamicHtml(rec.type) + ' version ' + escapeDynamicHtml(rec.version) + '</strong>';
    html += '<button class="btn-danger btn-sm" onclick="versionDelete(\'' + escapeDynamicHtml(rec._filename) + '\')">🗑 Delete</button>';
    html += '</div>';
    html += '<table class="result-table" style="font-size:11px;margin-top:6px;"><tr>' +
      '<th>File</th><th>SHA1</th><th>SHA256</th></tr>';
    (rec.files || []).forEach(function(f) {
      html += '<tr>';
      html += '<td style="font-family:monospace;">' + escapeDynamicHtml(f.path || '-') + '</td>';
      html += '<td style="font-family:monospace;word-break:break-all;">' + escapeDynamicHtml(f.sha1 || '-') + '</td>';
      html += '<td style="font-family:monospace;word-break:break-all;">' + escapeDynamicHtml(f.sha256 || '-') + '</td>';
      html += '</tr>';
    });
    html += '</table></div>';
  });
  return html;
}

async function versionDelete(filename) {
  if (!confirm('Delete this version record?')) return;
  var r = await api('/version/delete', 'POST', { filename: filename });
  if (!r.ok) { showAlert('Delete failed: ' + ((r.data && r.data.error) || 'unknown')); return; }
  loadVersionRecords();
}

// Toggle the collapsible "Saved ... Versions" list (collapsed by default).
function versionToggleSaved(type) {
  var listId = (type === 'simulation') ? 'simVersionSaved' : 'javaVersionSaved';
  var caretId = (type === 'simulation') ? 'simVersionSavedCaret' : 'javaVersionSavedCaret';
  var listEl = document.getElementById(listId);
  var caretEl = document.getElementById(caretId);
  if (!listEl) return;
  var collapsed = listEl.style.display === 'none';
  listEl.style.display = collapsed ? '' : 'none';
  if (caretEl) caretEl.textContent = collapsed ? '▼' : '▶';
}
