// ---------------------------------------------------------------------------
// Bingo Card Generation
// ---------------------------------------------------------------------------
async function doGenerateCards() {
  var width = parseInt(document.getElementById('cgWidth').value);
  var height = parseInt(document.getElementById('cgHeight').value);
  var numPerCard = parseInt(document.getElementById('cgNumPerCard').value);
  var maxCards = parseInt(document.getElementById('cgMaxCards').value);
  var cardSize = parseInt(document.getElementById('cgCardSize').value);
  var minNum = parseInt(document.getElementById('cgMinNum').value);
  var maxNum = parseInt(document.getElementById('cgMaxNum').value);

  // Client-side validation
  if (!width || width < 1) { showAlert('Width must be a positive integer'); return; }
  if (!height || height < 1) { showAlert('Height must be a positive integer'); return; }
  if (!numPerCard || numPerCard < 1) { showAlert('Numbers per card must be a positive integer'); return; }
  if (!maxCards || maxCards < 1) { showAlert('Max cards must be a positive integer'); return; }
  if (!cardSize || cardSize < 1 || cardSize > 10000) { showAlert('Card size must be between 1 and 10000'); return; }
  if (isNaN(minNum) || minNum < 0) { showAlert('Min card number must be 0 or greater'); return; }
  if (!maxNum || maxNum < 1) { showAlert('Max card number must be a positive integer'); return; }
  if (minNum >= maxNum) { showAlert('Min card number must be less than max card number'); return; }
  if (numPerCard !== width * height) { showAlert('Numbers per card (' + numPerCard + ') must equal width × height (' + width + '×' + height + '=' + (width*height) + ')'); return; }

  var equalPosStr = document.getElementById('cgEqualPos').value.trim();
  var equalPosition = [];
  if (equalPosStr) {
    try { equalPosition = JSON.parse(equalPosStr); }
    catch(e) { showAlert('Invalid equal_position JSON: ' + e.message); return; }
    if (!Array.isArray(equalPosition)) { showAlert('equal_position must be an array of arrays'); return; }
    // Validate each group is an array of non-negative integers
    var totalPos = numPerCard * maxCards;
    for (var g = 0; g < equalPosition.length; g++) {
      if (!Array.isArray(equalPosition[g])) { showAlert('equal_position[' + g + '] must be an array'); return; }
      for (var p = 0; p < equalPosition[g].length; p++) {
        var val = equalPosition[g][p];
        if (!Number.isInteger(val) || val < 0 || val >= totalPos) {
          showAlert('equal_position[' + g + '][' + p + '] = ' + val + ' is out of range [0, ' + (totalPos-1) + ']');
          return;
        }
      }
    }
  }

  var resultEl = document.getElementById('cgResult');
  resultEl.innerHTML = '<div style="color:#888;">Generating ' + cardSize + ' card sets...</div>';

  var res = await fetch('/bingo/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      num_per_card: numPerCard,
      max_cards: maxCards,
      card_size: cardSize,
      min_card_number: minNum,
      max_card_number: maxNum,
      equal_position: equalPosition
    })
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }

  var cards = data.cards || [];
  var totalPos = data.positions_per_set || 0;

  // Preview: show first set as card grid
  var html = '<div style="color:#27ae60;font-weight:600;margin-bottom:8px;">✅ Generated ' + cards.length + ' sets (' + totalPos + ' positions per set)</div>';

  // Preview first set as visual cards
  if (cards.length > 0) {
    var width = parseInt(document.getElementById('cgWidth').value) || 5;
    var height = parseInt(document.getElementById('cgHeight').value) || 3;
    html += '<div style="margin-bottom:12px;font-size:12px;color:#666;">Preview: Set #1 <span style="color:#aaa;">(click a cell to highlight same numbers)</span></div>';
    html += '<div id="cgPreviewCards" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;">';
    for (var c = 0; c < maxCards && c * numPerCard < cards[0].length; c++) {
      html += '<div style="border:1px solid #ddd;border-radius:4px;padding:4px;">';
      html += '<div style="font-size:10px;color:#888;text-align:center;margin-bottom:4px;">Card ' + (c+1) + '</div>';
      html += '<table style="border-collapse:collapse;">';
      for (var row = 0; row < height; row++) {
        html += '<tr>';
        for (var col = 0; col < width; col++) {
          var idx = c * numPerCard + row * width + col;
          var val = idx < cards[0].length ? cards[0][idx] : '-';
          html += '<td class="cg-cell" data-val="' + val + '" onclick="cgHighlightNumber(' + val + ')" style="border:1px solid #ccc;width:36px;height:36px;text-align:center;font-size:11px;font-weight:600;cursor:pointer;position:relative;vertical-align:middle;">' + val + '<span style="position:absolute;bottom:1px;right:2px;font-size:7px;color:#bbb;font-weight:normal;">' + idx + '</span></td>';
        }
        html += '</tr>';
      }
      html += '</table></div>';
    }
    html += '</div>';
  }

  // Full data output with copy - format as one array per line
  var fullData = '[' + cards.map(function(c) { return JSON.stringify(c); }).join(',\n') + ']';
  html += '<div style="position:relative;">';
  html += '<div style="font-size:12px;color:#666;margin-bottom:4px;">Full data (' + fullData.length + ' chars):</div>';
  html += '<div style="background:#1e1e2e;padding:12px 44px 12px 12px;border-radius:6px;font-family:monospace;font-size:11px;max-height:200px;overflow:auto;position:relative;">';
  html += '<span id="cgOutputValue" style="color:#a6e3a1;word-break:break-all;">' + fullData.substring(0, 5000) + (fullData.length > 5000 ? '...' : '') + '</span>';
  html += '<span onclick="copyCgResult()" title="Copy" style="position:absolute;right:12px;top:12px;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;" onmouseover="this.style.background=\'rgba(255,255,255,0.1)\'" onmouseout="this.style.background=\'transparent\'">';
  html += '<svg id="cgCopyIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  html += '<svg id="cgCheckIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  html += '</span></div></div>';

  resultEl.innerHTML = html;
  // Store full data for copy
  resultEl._fullData = fullData;
}

function copyCgResult() {
  var resultEl = document.getElementById('cgResult');
  var text = resultEl._fullData || '';
  if (!text) return;
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
  var copyIcon = document.getElementById('cgCopyIcon');
  var checkIcon = document.getElementById('cgCheckIcon');
  if (copyIcon) copyIcon.style.display = 'none';
  if (checkIcon) checkIcon.style.display = '';
  setTimeout(function() { if (copyIcon) copyIcon.style.display = ''; if (checkIcon) checkIcon.style.display = 'none'; }, 2000);
}

function cgHighlightNumber(num) {
  var cells = document.querySelectorAll('.cg-cell');
  cells.forEach(function(cell) {
    if (parseInt(cell.getAttribute('data-val')) === num) {
      cell.style.background = '#ffeaa7';
      cell.style.color = '#d63031';
    } else {
      cell.style.background = '';
      cell.style.color = '';
    }
  });
}


// ---------------------------------------------------------------------------
// Pattern Combination
// ---------------------------------------------------------------------------
async function doPatternCombination() {
  var inputStr = document.getElementById('pcPayableInput').value.trim();
  var resultEl = document.getElementById('pcResult');
  if (!inputStr) { showAlert('Please enter a payable list'); return; }

  var payables;
  try { payables = JSON.parse(inputStr); }
  catch(e) { showAlert('Invalid JSON: ' + e.message); return; }
  if (!Array.isArray(payables) || !payables.length) { showAlert('Payable must be a non-empty array'); return; }

  resultEl.innerHTML = '<div style="color:#888;">Generating combinations... This may take a moment.</div>';

  var res = await fetch('/bingo/pattern-combination', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({payables: payables})
  });
  var data = await res.json();
  if (data.error) { resultEl.innerHTML = '<div style="color:#e74c3c;">❌ ' + data.error + '</div>'; return; }

  var combos = data.combinations && data.combinations['default'] ? data.combinations['default'] : [];
  var html = '<div style="color:#27ae60;font-weight:600;margin-bottom:8px;">✅ Generated ' + combos.length + ' combinations</div>';

  // Output as JSON with copy button - custom key order
  var outputLines = combos.map(function(c) {
    return '{"id":' + c.id + ',"name":"' + c.name + '", "alias":"' + c.alias + '", "format":"' + c.format + '", "required":"' + c.required + '", "value":' + c.value + ', "weight":' + (c.weight || 0).toFixed(2) + '}';
  });
  var outputJson = '{"default":[\n' + outputLines.join(',\n') + '\n]}';
  html += '<div style="position:relative;">';
  html += '<div style="font-size:12px;color:#666;margin-bottom:4px;">Output (' + combos.length + ' combinations):</div>';
  html += '<div style="background:#1e1e2e;padding:12px 44px 12px 12px;border-radius:6px;font-family:monospace;font-size:11px;max-height:400px;overflow:auto;position:relative;">';
  html += '<pre id="pcOutputValue" style="color:#a6e3a1;margin:0;white-space:pre-wrap;word-break:break-all;">' + outputJson.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>';
  html += '<span onclick="copyPcResult()" title="Copy" style="position:absolute;right:12px;top:12px;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;" onmouseover="this.style.background=\'rgba(255,255,255,0.1)\'" onmouseout="this.style.background=\'transparent\'">';
  html += '<svg id="pcCopyIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  html += '<svg id="pcCheckIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  html += '</span></div></div>';

  resultEl.innerHTML = html;
  resultEl._fullData = outputJson;
}

function copyPcResult() {
  var resultEl = document.getElementById('pcResult');
  var text = resultEl._fullData || '';
  if (!text) return;
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
  var copyIcon = document.getElementById('pcCopyIcon');
  var checkIcon = document.getElementById('pcCheckIcon');
  if (copyIcon) copyIcon.style.display = 'none';
  if (checkIcon) checkIcon.style.display = '';
  setTimeout(function() { if (copyIcon) copyIcon.style.display = ''; if (checkIcon) checkIcon.style.display = 'none'; }, 2000);
}


// ---------------------------------------------------------------------------
// Pattern Calculation
// ---------------------------------------------------------------------------
function pcalcUpdateNumPerCard() {
  var w = parseInt(document.getElementById('pcalcWidth').value) || 0;
  var h = parseInt(document.getElementById('pcalcHeight').value) || 0;
  document.getElementById('pcalcNumPerCard').value = w * h;
}

function pcalcShowAddMachine() {
  document.getElementById('pcalcAddMachinePanel').style.display = '';
}

async function pcalcLoadMachines() {
  var res = await fetch('/bingo/machines');
  var data = await res.json();
  var sel = document.getElementById('pcalcMachineSelect');
  var html = '<option value="">-- Select Machine --</option>';
  (data.machines || []).forEach(function(m) {
    html += '<option value="' + m.machine_id + '">' + m.machine_id + ' - ' + m.name + '</option>';
  });
  sel.innerHTML = html;
  sel._machines = data.machines || [];
}

function pcalcLoadMachinePattern() {
  var sel = document.getElementById('pcalcMachineSelect');
  var machineId = parseInt(sel.value);
  if (!machineId) { document.getElementById('pcalcPatterns').value = ''; pcalcUpdateSpecialSelect(null); return; }
  var machines = sel._machines || [];
  var machine = machines.find(function(m) { return m.machine_id === machineId; });
  if (machine && machine.pattern) {
    document.getElementById('pcalcPatterns').value = JSON.stringify(machine.pattern);
  }
  pcalcUpdateSpecialSelect(machine);
}

function pcalcUpdateSpecialSelect(machine) {
  var sel = document.getElementById('pcalcSpecialSelect');
  var html = '<option value="">-- None (base only) --</option>';
  if (machine) {
    Object.keys(machine).forEach(function(key) {
      if (key.startsWith('special_pattern') && Array.isArray(machine[key])) {
        html += '<option value="' + key + '">' + key + ' (' + machine[key].length + ' patterns)</option>';
      }
    });
  }
  sel.innerHTML = html;
}

function pcalcLoadSpecialPattern() {
  var machineSel = document.getElementById('pcalcMachineSelect');
  var specialSel = document.getElementById('pcalcSpecialSelect');
  var machineId = parseInt(machineSel.value);
  var specialKey = specialSel.value;
  if (!machineId) return;
  var machines = machineSel._machines || [];
  var machine = machines.find(function(m) { return m.machine_id === machineId; });
  if (!machine) return;

  var basePatterns = machine.pattern || [];

  if (!specialKey || !machine[specialKey]) {
    // No special selected, just base
    document.getElementById('pcalcPatterns').value = JSON.stringify(basePatterns);
    document.getElementById('pcalcSpecialCheckboxes') && (document.getElementById('pcalcSpecialCheckboxes').innerHTML = '');
    return;
  }

  // Show checkboxes for individual special patterns
  var specialPatterns = machine[specialKey];
  var cbContainer = document.getElementById('pcalcSpecialCheckboxes');
  if (!cbContainer) {
    // Create container after special select
    var parent = specialSel.parentElement;
    cbContainer = document.createElement('div');
    cbContainer.id = 'pcalcSpecialCheckboxes';
    cbContainer.style.cssText = 'margin-bottom:8px;border:1px solid #eee;border-radius:4px;padding:8px;max-height:150px;overflow-y:auto;';
    parent.parentElement.insertBefore(cbContainer, parent.nextElementSibling);
  }
  var html = '<div style="font-size:11px;color:#666;margin-bottom:4px;">Select patterns to merge with base:</div>';
  specialPatterns.forEach(function(sp, idx) {
    html += '<label style="display:block;font-size:12px;margin-bottom:3px;cursor:pointer;"><input type="checkbox" class="pcalc-special-cb" data-idx="' + idx + '" onchange="pcalcMergeSelectedSpecial()"> ' + (sp.alias||'SP'+idx) + ' - ' + (sp.name||'') + ' (x' + (sp.value||0) + ')</label>';
  });
  cbContainer.innerHTML = html;

  // Initially just base
  document.getElementById('pcalcPatterns').value = JSON.stringify(basePatterns);
}

function pcalcMergeSelectedSpecial() {
  var machineSel = document.getElementById('pcalcMachineSelect');
  var specialSel = document.getElementById('pcalcSpecialSelect');
  var machineId = parseInt(machineSel.value);
  var specialKey = specialSel.value;
  if (!machineId || !specialKey) return;
  var machines = machineSel._machines || [];
  var machine = machines.find(function(m) { return m.machine_id === machineId; });
  if (!machine || !machine[specialKey]) return;

  var basePatterns = machine.pattern || [];
  var specialPatterns = machine[specialKey];
  var merged = basePatterns.slice();

  // Add only checked special patterns
  var cbs = document.querySelectorAll('.pcalc-special-cb:checked');
  cbs.forEach(function(cb) {
    var idx = parseInt(cb.getAttribute('data-idx'));
    if (specialPatterns[idx]) merged.push(specialPatterns[idx]);
  });

  document.getElementById('pcalcPatterns').value = JSON.stringify(merged);
}

function pcalcShowAddSpecial() {
  var machineId = parseInt(document.getElementById('pcalcMachineSelect').value);
  if (!machineId) { showAlert('Please select a machine first'); return; }
  document.getElementById('pcalcAddSpecialPanel').style.display = '';
}

async function pcalcRemoveMachine() {
  var machineId = parseInt(document.getElementById('pcalcMachineSelect').value);
  if (!machineId) { showAlert('Please select a machine to remove'); return; }
  if (!confirm('Delete this machine and all its patterns?')) return;
  var res = await fetch('/bingo/machines/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({machine_id:machineId}) });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  showAlert('Machine removed');
  document.getElementById('pcalcPatterns').value = '';
  var cbEl = document.getElementById('pcalcSpecialCheckboxes');
  if (cbEl) cbEl.innerHTML = '';
  await pcalcLoadMachines();
}

async function pcalcRemoveSpecial() {
  var machineId = parseInt(document.getElementById('pcalcMachineSelect').value);
  var specialKey = document.getElementById('pcalcSpecialSelect').value;
  if (!machineId) { showAlert('Please select a machine first'); return; }
  if (!specialKey) { showAlert('Please select a special pattern to remove'); return; }
  if (!confirm('Delete special pattern "' + specialKey + '"?')) return;
  var res = await fetch('/bingo/machines/special/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({machine_id:machineId,special_name:specialKey}) });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  showAlert('Special pattern removed');
  var cbEl = document.getElementById('pcalcSpecialCheckboxes');
  if (cbEl) cbEl.innerHTML = '';
  await pcalcLoadMachines();
  document.getElementById('pcalcMachineSelect').value = machineId;
  pcalcLoadMachinePattern();
}

async function pcalcSaveSpecial() {
  var machineId = parseInt(document.getElementById('pcalcMachineSelect').value);
  if (!machineId) { showAlert('Please select a machine first'); return; }
  var name = document.getElementById('pcalcNewSpecialName').value.trim();
  var patternsStr = document.getElementById('pcalcNewSpecialPatterns').value.trim();
  if (!name) { showAlert('Special pattern name is required'); return; }
  if (!name.startsWith('special_pattern')) { name = 'special_pattern_' + name; }
  var patterns = [];
  if (patternsStr) {
    try { patterns = JSON.parse(patternsStr); } catch(e) { showAlert('Invalid JSON: ' + e.message); return; }
  }
  var res = await fetch('/bingo/machines/special', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({machine_id: machineId, special_name: name, special_pattern: patterns})
  });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  showAlert('Special pattern saved!');
  document.getElementById('pcalcAddSpecialPanel').style.display = 'none';
  // Reload machines and re-select to refresh special list
  await pcalcLoadMachines();
  document.getElementById('pcalcMachineSelect').value = machineId;
  pcalcLoadMachinePattern();
}

async function pcalcSaveMachine() {
  var id = parseInt(document.getElementById('pcalcNewMachineId').value);
  var name = document.getElementById('pcalcNewMachineName').value.trim();
  var patternsStr = document.getElementById('pcalcNewMachinePatterns').value.trim();
  if (!id || !name) { showAlert('Machine ID and Name are required'); return; }
  var pattern = [];
  if (patternsStr) {
    try { pattern = JSON.parse(patternsStr); } catch(e) { showAlert('Invalid pattern JSON: ' + e.message); return; }
  }
  var res = await fetch('/bingo/machines', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({machine_id:id,name:name,pattern:pattern}) });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  showAlert('Machine saved!');
  document.getElementById('pcalcAddMachinePanel').style.display = 'none';
  pcalcLoadMachines();
}

function pcalcCyclePattern(groupIdx) {
  if (!window._pcalcPatternGroups || !_pcalcPatternGroups[groupIdx]) return;
  var group = _pcalcPatternGroups[groupIdx];
  if (group.length <= 1) return;
  var gridEl = document.querySelector('.pcalc-pat-grid[data-group="' + groupIdx + '"]');
  if (!gridEl) return;
  var currentIdx = parseInt(gridEl.getAttribute('data-idx')) || 0;
  var nextIdx = (currentIdx + 1) % group.length;
  gridEl.setAttribute('data-idx', nextIdx);
  var fmt = group[nextIdx].format || '';
  var cells = gridEl.querySelectorAll('div');
  var width = _pcalcWidth || 5;
  var totalPos = _pcalcTotalPos || 25;
  for (var i = 0; i < cells.length && i < totalPos; i++) {
    var isReq = i < fmt.length && fmt[i] === '1';
    cells[i].style.background = isReq ? '#e6e600' : '#fff';
  }
  var aliasEl = document.getElementById('pcalcPatAlias' + groupIdx);
  if (aliasEl) aliasEl.textContent = group[nextIdx].alias;
}

// Auto-cycle patterns with same id
var _pcalcAutoCycleTimer = null;
function pcalcStartAutoCycle() {
  if (_pcalcAutoCycleTimer) return;
  _pcalcAutoCycleTimer = setInterval(function() {
    if (!window._pcalcPatternGroups) return;
    _pcalcPatternGroups.forEach(function(group, idx) {
      if (group.length > 1) pcalcCyclePattern(idx);
    });
  }, 1500);
}
function pcalcStopAutoCycle() {
  if (_pcalcAutoCycleTimer) { clearInterval(_pcalcAutoCycleTimer); _pcalcAutoCycleTimer = null; }
}

function pcalcRenderPatternGrid(patterns, width, totalPos, matchedPatterns) {
  // Group patterns by id
  var patternGroups = [];
  var seenIds = {};
  patterns.forEach(function(p) {
    var pid = String(p.id !== undefined ? p.id : p.alias);
    if (!seenIds[pid]) { seenIds[pid] = []; patternGroups.push({id: pid, patterns: seenIds[pid]}); }
    seenIds[pid].push(p);
  });

  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">';
  var groupsData = [];
  patternGroups.forEach(function(group, gIdx) {
    var first = group.patterns[0];
    var isMatched = matchedPatterns.some(function(m) { return group.patterns.some(function(gp){return gp.alias===m.alias;}); });
    var hasMultiple = group.patterns.length > 1;
    html += '<div style="text-align:center;">';
    html += '<div class="pcalc-pat-grid" data-group="' + gIdx + '" data-idx="0" style="display:grid;grid-template-columns:repeat(' + width + ',18px);gap:1px;border:2px solid ' + (isMatched ? '#27ae60' : '#333') + ';border-radius:3px;padding:2px;background:#333;cursor:' + (hasMultiple?'pointer':'default') + ';" ' + (hasMultiple ? 'onclick="pcalcCyclePattern(' + gIdx + ')"' : '') + '>';
    var fmt = first.format || '';
    for (var i = 0; i < totalPos; i++) {
      var isRequired = i < fmt.length && fmt[i] === '1';
      var bgColor = isRequired ? (isMatched ? '#27ae60' : '#e6e600') : '#fff';
      html += '<div style="width:18px;height:18px;background:' + bgColor + ';border-radius:2px;"></div>';
    }
    html += '</div>';
    html += '<div style="font-size:10px;color:#666;margin-top:2px;">x' + (first.value||0) + (hasMultiple ? ' <span style="color:#4a90d9;">(' + group.patterns.length + ')</span>' : '') + '</div>';
    html += '<div style="font-size:9px;color:#999;" id="pcalcPatAlias' + gIdx + '">' + first.alias + '</div>';
    html += '</div>';
    groupsData.push(group.patterns.map(function(p){return {format:p.format,alias:p.alias};}));
  });
  html += '</div>';
  // Store data globally (not via script tag since innerHTML won't execute scripts)
  window._pcalcPatternGroups = groupsData;
  window._pcalcWidth = width;
  window._pcalcTotalPos = totalPos;
  return html;
}

function doPatternCalcPreview() {
  var width = parseInt(document.getElementById('pcalcWidth').value);
  var height = parseInt(document.getElementById('pcalcHeight').value);
  if (!width || width < 1 || !height || height < 1) { showAlert('Card Width and Height must be positive integers'); return; }
  var totalPos = width * height;
  var resultEl = document.getElementById('pcalcResult');
  var html = '';
  var hasContent = false;

  // Preview patterns if available
  var patternsStr = document.getElementById('pcalcPatterns').value.trim();
  if (patternsStr) {
    var patterns;
    try { patterns = JSON.parse(patternsStr); } catch(e) { showAlert('Invalid patterns JSON'); return; }
    html += '<h3 style="margin:16px 0 8px;">Patterns Preview</h3>';
    html += pcalcRenderPatternGrid(patterns, width, totalPos, []);
    hasContent = true;
  }

  // Preview card if available
  var cardStr = document.getElementById('pcalcCard').value.trim();
  if (cardStr) {
    var card;
    try { card = JSON.parse(cardStr); } catch(e) { showAlert('Invalid card JSON'); return; }
    var numCards = Math.floor(card.length / totalPos);
    html += '<h3 style="margin:16px 0 8px;">Cards Preview (' + numCards + ')</h3>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;">';
    for (var c = 0; c < numCards; c++) {
      html += '<div><div style="font-size:11px;color:#666;margin-bottom:4px;text-align:center;">Card ' + (c+1) + '</div>';
      html += '<table style="border-collapse:collapse;">';
      for (var row = 0; row < height; row++) {
        html += '<tr>';
        for (var col = 0; col < width; col++) {
          var idx = c * totalPos + row * width + col;
          var num = idx < card.length ? card[idx] : '-';
          var isFree = num === 0;
          html += '<td style="width:40px;height:40px;border:1px solid #999;text-align:center;font-size:14px;font-weight:700;background:' + (isFree ? '#333' : '#f0f0f0') + ';color:' + (isFree ? '#fff' : '#333') + ';">' + (isFree ? '\u2605' : num) + '</td>';
        }
        html += '</tr>';
      }
      html += '</table></div>';
    }
    html += '</div>';
    hasContent = true;
  }

  // Preview balls if available
  var ballsStr = document.getElementById('pcalcBalls').value.trim();
  if (ballsStr) {
    var balls;
    try { balls = JSON.parse(ballsStr); } catch(e) { showAlert('Invalid balls JSON'); return; }
    var ballColors = ['#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6','#1abc9c','#e91e63','#ff9800','#607d8b','#795548'];
    html += '<h3 style="margin:16px 0 8px;">Ball List Preview (' + balls.length + ')</h3>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:600px;">';
    balls.forEach(function(b, idx) {
      html += '<div style="width:32px;height:32px;border-radius:50%;background:' + ballColors[idx%ballColors.length] + ';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;border:2px solid rgba(0,0,0,0.2);">' + b + '</div>';
    });
    html += '</div>';
    hasContent = true;
  }

  if (!hasContent) { showAlert('Please fill in at least one field to preview'); return; }
  resultEl.innerHTML = html;
  pcalcStopAutoCycle();
  pcalcStartAutoCycle();
}

function doPatternCalc() {
  var width = parseInt(document.getElementById('pcalcWidth').value);
  var height = parseInt(document.getElementById('pcalcHeight').value);
  var numPerCard = parseInt(document.getElementById('pcalcNumPerCard').value);
  var patternsStr = document.getElementById('pcalcPatterns').value.trim();
  var cardStr = document.getElementById('pcalcCard').value.trim();
  var ballsStr = document.getElementById('pcalcBalls').value.trim();
  var resultEl = document.getElementById('pcalcResult');

  // Validation
  if (!width || width < 1) { showAlert('Card Width must be a positive integer'); return; }
  if (!height || height < 1) { showAlert('Card Height must be a positive integer'); return; }
  if (!numPerCard || numPerCard < 1) { showAlert('Number per card must be a positive integer'); return; }
  if (numPerCard > width * height) { showAlert('Number per card cannot exceed width × height (' + (width*height) + ')'); return; }
  if (!patternsStr || !cardStr || !ballsStr) { showAlert('Please fill in all fields'); return; }

  var patterns, card, balls;
  try { patterns = JSON.parse(patternsStr); } catch(e) { showAlert('Invalid patterns JSON: ' + e.message); return; }
  try { card = JSON.parse(cardStr); } catch(e) { showAlert('Invalid card JSON: ' + e.message); return; }
  try { balls = JSON.parse(ballsStr); } catch(e) { showAlert('Invalid balls JSON: ' + e.message); return; }

  var totalPos = numPerCard;
  if (card.length < totalPos) { showAlert('Card has fewer numbers (' + card.length + ') than number_per_card (' + totalPos + ')'); return; }

  // Determine which card positions are hit by the ball list
  var ballSet = new Set(balls);
  var hitPositions = [];
  for (var i = 0; i < totalPos; i++) {
    hitPositions.push(card[i] === 0 || ballSet.has(card[i]));
  }

  // Check each pattern for full match
  var matchedPatterns = [];
  patterns.forEach(function(p) {
    var fmt = p.format || '';
    if (fmt.length !== totalPos) return;
    var fullMatch = true;
    for (var i = 0; i < totalPos; i++) {
      if (fmt[i] === '1' && !hitPositions[i]) { fullMatch = false; break; }
    }
    if (fullMatch) matchedPatterns.push(p);
  });

  var html = '';

  // 1. Render Patterns grid (group by id, auto-cycle same id)
  html += '<h3 style="margin:16px 0 8px;">Patterns</h3>';
  html += pcalcRenderPatternGrid(patterns, width, totalPos, matchedPatterns);

  // 2. Render all Cards with hit markers
  var numCards = Math.floor(card.length / totalPos);
  html += '<h3 style="margin:16px 0 8px;">Cards (' + numCards + ')</h3>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;">';
  for (var c = 0; c < numCards; c++) {
    var cardOffset = c * totalPos;
    // Determine hits for this card
    var cardHits = [];
    for (var i = 0; i < totalPos; i++) { cardHits.push(card[cardOffset + i] === 0 || ballSet.has(card[cardOffset + i])); }
    // Check patterns for this card
    var cardMatchedPatterns = [];
    var almostPatterns = []; // patterns missing exactly 1 position
    patterns.forEach(function(p) {
      var fmt = p.format || '';
      if (fmt.length !== totalPos) return;
      var missCount = 0, missIdx = -1;
      for (var i = 0; i < totalPos; i++) {
        if (fmt[i] === '1' && !cardHits[i]) { missCount++; missIdx = i; if (missCount > 1) break; }
      }
      if (missCount === 0) cardMatchedPatterns.push(p);
      else if (missCount === 1) almostPatterns.push({pattern: p, missIdx: missIdx});
    });

    // Build per-position "almost" info: which positions are 1 away from which patterns
    var posAlmost = {}; // {idx: [{value, alias},...]}
    almostPatterns.forEach(function(ap) {
      var idx = ap.missIdx;
      if (!posAlmost[idx]) posAlmost[idx] = [];
      posAlmost[idx].push({value: ap.pattern.value, alias: ap.pattern.alias});
    });

    html += '<div>';
    html += '<div style="font-size:11px;color:#666;margin-bottom:4px;text-align:center;">Card ' + (c+1) + '</div>';
    html += '<div style="display:inline-block;border:2px solid #666;border-radius:4px;overflow:hidden;">';
    html += '<table style="border-collapse:collapse;">';
    for (var row = 0; row < height; row++) {
      html += '<tr>';
      for (var col = 0; col < width; col++) {
        var idx = row * width + col;
        if (idx >= totalPos) break;
        var num = card[cardOffset + idx];
        var isHit = cardHits[idx];
        var isFree = (num === 0);
        var inMatchedPattern = false;
        cardMatchedPatterns.forEach(function(p) { if (p.format && p.format[idx] === '1') inMatchedPattern = true; });
        var almostInfo = posAlmost[idx];

        var bgColor, textColor, textDecor = '', cellContent = '';
        if (isFree) { bgColor = '#333'; textColor = '#fff'; cellContent = '\u2605'; }
        else if (almostInfo && almostInfo.length > 0 && !isHit) {
          // Almost matched: yellow bg, show original number small on top, x{value} larger below
          bgColor = '#ffe600';
          textColor = '#333';
          var bestAlmost = almostInfo.sort(function(a,b){return b.value - a.value;})[0];
          cellContent = '<span style="font-size:9px;color:#666;display:block;line-height:1;">' + (num < 10 ? '0'+num : num) + '</span><span style="font-size:13px;font-weight:700;color:#333;display:block;line-height:1.2;">x' + bestAlmost.value + '</span>';
        } else if (isHit) {
          bgColor = '#222'; textColor = '#fff';
          if (inMatchedPattern && !isFree) { textDecor = 'text-decoration:line-through;text-decoration-color:#e74c3c;text-decoration-thickness:2px;'; }
          cellContent = (num < 10 ? '0' + num : num);
        } else {
          bgColor = '#f0f0f0'; textColor = '#333';
          cellContent = (num < 10 ? '0' + num : num);
        }
        html += '<td style="width:40px;height:40px;border:1px solid #999;text-align:center;font-size:14px;font-weight:700;background:' + bgColor + ';color:' + textColor + ';vertical-align:middle;' + textDecor + '">';
        html += cellContent;
        html += '</td>';
      }
      html += '</tr>';
    }
    html += '</table></div>';
    if (cardMatchedPatterns.length > 0) {
      html += '<div style="font-size:10px;color:#27ae60;margin-top:4px;max-width:' + (width*42) + 'px;">\u2705 ' + cardMatchedPatterns.map(function(p){return p.alias;}).join(',') + '</div>';
    }
    if (almostPatterns.length > 0) {
      html += '<div style="font-size:10px;color:#b8860b;margin-top:2px;max-width:' + (width*42) + 'px;">\u26A0 Almost: ' + almostPatterns.map(function(ap){return ap.pattern.alias+'(x'+ap.pattern.value+')';}).join(',') + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // Show overall matched patterns info
  // Collect all matched across all cards
  var allMatched = [];
  for (var c = 0; c < numCards; c++) {
    var cardOffset = c * totalPos;
    var cardHits = [];
    for (var i = 0; i < totalPos; i++) { cardHits.push(card[cardOffset + i] === 0 || ballSet.has(card[cardOffset + i])); }
    patterns.forEach(function(p) {
      var fmt = p.format || '';
      if (fmt.length !== totalPos) return;
      var fullMatch = true;
      for (var i = 0; i < totalPos; i++) { if (fmt[i] === '1' && !cardHits[i]) { fullMatch = false; break; } }
      if (fullMatch) allMatched.push({card: c+1, pattern: p});
    });
  }
  if (allMatched.length > 0) {
    html += '<div style="margin-top:8px;font-size:12px;color:#27ae60;font-weight:600;">\u2705 Matched: ';
    html += allMatched.map(function(m) { return 'Card' + m.card + ':' + m.pattern.name + '(' + m.pattern.alias + ') x' + m.pattern.value; }).join(', ');
    html += '</div>';
  } else {
    html += '<div style="margin-top:8px;font-size:12px;color:#888;">No pattern fully matched on any card.</div>';
  }

  // 3. Render Ball List
  html += '<h3 style="margin:16px 0 8px;">Ball List (' + balls.length + ' balls)</h3>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:600px;">';
  var ballColors = ['#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6','#1abc9c','#e91e63','#ff9800','#607d8b','#795548'];
  balls.forEach(function(b, idx) {
    var color = ballColors[idx % ballColors.length];
    var isOnCard = card.indexOf(b) >= 0;
    html += '<div style="width:32px;height:32px;border-radius:50%;background:' + (isOnCard ? color : '#ccc') + ';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;border:2px solid rgba(0,0,0,0.2);">' + b + '</div>';
  });
  html += '</div>';

  resultEl.innerHTML = html;
  // Start auto-cycling patterns with same id
  pcalcStopAutoCycle();
  pcalcStartAutoCycle();
}

