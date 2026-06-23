// ---------------------------------------------------------------------------
// Play Module (Game Lobby)
// ---------------------------------------------------------------------------
var _playSessionToken = '';
var _playCurrentMachine = null;

function playLog(msg) {
  var panel = document.getElementById('playLogPanel');
  if (!panel) return;
  var ts = new Date().toLocaleTimeString();
  panel.textContent += '[' + ts + '] ' + msg + '\n';
  panel.scrollTop = panel.scrollHeight;
}

function playToggleLog() {
  var panel = document.getElementById('playLogPanel');
  var divider = document.getElementById('playDivider');
  if (panel.style.display === 'none') {
    panel.style.display = '';
    if (divider) divider.style.display = '';
  } else {
    panel.style.display = 'none';
    if (divider) divider.style.display = 'none';
  }
}

function playStartResize(e) {
  e.preventDefault();
  var panel = document.getElementById('playLogPanel');
  var startY = e.clientY;
  var startH = panel.offsetHeight;
  function onMove(ev) {
    var diff = startY - ev.clientY;
    var newH = Math.max(80, Math.min(600, startH + diff));
    panel.style.height = newH + 'px';
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function playShowLoading(msg) {
  // Create loading overlay on the play page area
  var existing = document.getElementById('playLoadingOverlay');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'playLoadingOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;';
  overlay.innerHTML = '<div style="text-align:center;">' +
    '<div style="width:48px;height:48px;border:4px solid #333;border-top-color:#4a90d9;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div>' +
    '<div style="color:#fff;font-size:14px;font-weight:500;">' + (msg || 'Loading...') + '</div>' +
    '<div style="margin-top:12px;width:200px;height:4px;background:#333;border-radius:2px;overflow:hidden;">' +
    '<div style="width:30%;height:100%;background:linear-gradient(90deg,#4a90d9,#27ae60);border-radius:2px;animation:playLoadingBar 1.5s ease-in-out infinite;"></div>' +
    '</div></div>';
  document.body.appendChild(overlay);
}

function playHideLoading() {
  var overlay = document.getElementById('playLoadingOverlay');
  if (overlay) overlay.remove();
}

async function playLoadMachines() {
  // Load current authorization token and currency
  try {
    var authRes = await fetch('/play/auth');
    var authData = await authRes.json();
    if (authData.authorization) {
      document.getElementById('playAuthInput').value = authData.authorization;
    }
    if (authData.currency) {
      document.getElementById('playCurrencyInput').value = authData.currency;
    }
  } catch(e) {}

  var res = await fetch('/play/machines');
  var data = await res.json();
  var machines = data.machines || [];
  var listEl = document.getElementById('playMachineList');

  var html = '';
  machines.forEach(function(m) {
    var opacity = m.enabled ? '1' : '0.5';
    var typeLabel = m.type === 'slot' ? '🎰' : '🎱';
    html += '<div style="text-align:center;cursor:pointer;opacity:' + opacity + ';" onclick="playSelectMachine(' + m.machine_id + ',' + m.enabled + ',\'' + (m.type||'bingo') + '\')">';
    html += '<div style="width:120px;height:120px;margin:0 auto;background:#2a2a4e;border:2px solid #444;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:#fff;transition:all 0.2s;" onmouseover="this.style.borderColor=\'#4a90d9\';this.style.transform=\'scale(1.05)\'" onmouseout="this.style.borderColor=\'#444\';this.style.transform=\'scale(1)\'">';
    html += '<span style="font-size:24px;">' + typeLabel + '</span>';
    html += '<span>' + m.name + '</span>';
    html += '</div>';
    html += '<div style="font-size:11px;color:#888;margin-top:4px;">' + (m.type||'bingo') + ' | ID: ' + m.machine_id + '</div>';
    html += '</div>';
  });
  listEl.innerHTML = html || '<div style="color:#888;text-align:center;">No machines configured</div>';

  // Reset state
  document.getElementById('playMachineList').style.display = 'grid';
  document.getElementById('playGameArea').style.display = 'none';
  document.getElementById('playBackBtn').style.display = 'none';
  document.getElementById('playBottomText').textContent = 'Select a machine to play';
}

async function playUpdateSettings() {
  var token = document.getElementById('playAuthInput').value.trim();
  var currency = document.getElementById('playCurrencyInput').value.trim();
  if (!token && !currency) { showAlert('Please enter authorization or currency'); return; }
  var res = await fetch('/play/auth', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({authorization: token, currency: currency})
  });
  var data = await res.json();
  if (data.error) { showAlert('Error: ' + data.error); return; }
  showAlert('✅ Settings updated');
}

var _playWs = null; // Browser WebSocket connection to Java server
var _playCurrency = 'coins';
var _playAuthToken = '';

async function playSelectMachine(machineId, enabled, machineType) {
  if (!enabled) { showAlert('Coming soon'); return; }
  // Show loading overlay to prevent double-click
  playShowLoading('Connecting to machine #' + machineId + '...');

  document.getElementById('playLogPanel').textContent = '';
  playLog('>>> [INIT] Loading machine config: machine_id=' + machineId);

  // Get machine config from master (HTTP)
  var res = await fetch('/play/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({machine_id: machineId})
  });
  var data = await res.json();
  if (data.error) { playLog('<<< [INIT] error: ' + data.error); playHideLoading(); showAlert(data.error); document.getElementById('playBottomText').textContent = 'Failed'; return; }

  var connUrl = data.connection_url;
  _playAuthToken = data.authorization || '';
  _playCurrency = data.currency || 'coins';
  var machineConfig = data.config || {};

  playLog('<<< [INIT] connection_url: ' + connUrl);
  playLog('<<< [INIT] machine_type: ' + data.machine_type + ', currency: ' + _playCurrency);

  // Connect WebSocket directly from browser to Java server
  playLog('>>> [WS CONNECT] ' + connUrl);
  try {
    _playWs = new WebSocket(connUrl);
  } catch(e) { playLog('<<< [WS CONNECT] error: ' + e.message); playHideLoading(); showAlert('WebSocket connection failed: ' + e.message); return; }

  _playWs.onopen = function() {
    playLog('<<< [WS CONNECT] connected');
    // Send login command
    var loginCmd = {
      cmd: 'iniciar',
      authorization_token: _playAuthToken,
      game_id: machineId,
      payload_data: "[{'key':'value'}]"
    };
    playLog('>>> [LOGIN] send: ' + JSON.stringify(loginCmd));
    _playWs.send(JSON.stringify(loginCmd));
  };

  _playWs.onmessage = function(event) {
    var resp;
    try { resp = JSON.parse(event.data); } catch(e) { playLog('<<< [WS] invalid JSON: ' + event.data); return; }

    if (resp.cmd === 'iniciar') {
      // Login response
      playLog('<<< [LOGIN] response: ' + JSON.stringify(resp));
      _playSessionToken = resp.session_token || '';
      _playCurrentMachine = {machine_id: machineId, response: resp, config: machineConfig, type: machineType || 'bingo'};

      // Hide loading overlay
      playHideLoading();

      // Switch to game view
      document.getElementById('playMachineList').style.display = 'none';
      document.getElementById('playGameArea').style.display = '';
      document.getElementById('playBackBtn').style.display = '';

      if (machineType === 'slot') {
        playRenderSlotGame(resp, machineConfig);
      } else {
        playRenderGame(resp, machineConfig);
      }
    } else if (resp.cmd === 'solicitajogada') {
      // Spin or Buy EB response
      playLog('<<< [SPIN/EB] response: ' + JSON.stringify(resp));
      playHandleSpinResponse(resp);
    } else if (resp.cmd === 'finalizajogada') {
      // Round over response
      playLog('<<< [ROUND OVER] response: ' + JSON.stringify(resp));
      playHandleRoundOverResponse(resp);
    } else if (resp.cmd === 'Jackpot_update') {
      // Async jackpot update
      playLog('<<< [JACKPOT UPDATE] ' + JSON.stringify(resp));
      playUpdateJackpotFromFeatures(resp.features);
    } else {
      playLog('<<< [WS] unknown cmd: ' + JSON.stringify(resp));
    }
  };

  _playWs.onerror = function(e) { playLog('<<< [WS ERROR] ' + (e.message || 'connection error')); playHideLoading(); };
  _playWs.onclose = function(e) { playLog('<<< [WS CLOSE] code=' + e.code + ', reason=' + e.reason); _playWs = null; playHideLoading(); };
}

function playRenderGame(resp, machineConfig) {
  var gameArea = document.getElementById('playGameArea');
  var betList = resp.bet_list || [];
  var balance = resp.balance || 0;
  var nickname = resp.nickname || 'Player';
  var gameId = resp.game_id || '';
  var currency = resp.display_currency_symbol || '';

  // Extract config info
  var mathModel = (machineConfig.math_model && machineConfig.math_model[0]) || {};
  var patterns = mathModel.pattern || [];
  var cardWidth = mathModel.card_width || 5;
  var cardHeight = mathModel.card_height || 5;
  var numPerCard = mathModel.numPerCard || (cardWidth * cardHeight);

  // Parse jackpot config
  var jackpotPool = 0, jackpotBaseUnit = 1, jackpotRates = [];
  var displayPrecision = resp.display_currency_precision || 2;
  try {
    var features = resp.features || [];
    if (features.length > 0) {
      var feat = JSON.parse(features[0]);
      if (feat.jackpot && feat.jackpot[0]) {
        var jp = feat.jackpot[0];
        jackpotRates = jp.jackpot_prize_rate_list || [];
        jackpotBaseUnit = jp.jackpot_base_unit_to_currency || 1;
        var poolItem = JSON.parse(jp.jackpot_pool_item || '{}');
        jackpotPool = parseFloat(poolItem.jackpotPool) || 0;
      }
    }
  } catch(e) {}

  // Store for jackpot calculation
  window._playJackpotPool = jackpotPool;
  window._playJackpotBaseUnit = jackpotBaseUnit;
  window._playJackpotRates = jackpotRates;
  window._playBetList = betList;
  window._playDisplayPrecision = displayPrecision;

  var html = '';
  // Top info bar with jackpot
  html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#333;border-radius:6px;margin-bottom:12px;color:#fff;font-size:12px;">';
  html += '<span>\uD83D\uDC64 ' + nickname + '</span>';
  html += '<span>\uD83D\uDCB0 ' + balance.toLocaleString() + ' ' + currency + '</span>';
  html += '<span id="playJackpotDisplay" style="color:#f39c12;font-weight:600;">\uD83C\uDFC6 JP: ' + playCalcJackpot(0).toFixed(displayPrecision) + '</span>';
  html += '<span>\uD83C\uDFAE #' + gameId + ' | ' + cardWidth + 'x' + cardHeight + '</span>';
  html += '</div>';

  // Pattern list (grouped by id, auto-cycle)
  if (patterns.length > 0) {
    html += '<div style="margin-bottom:12px;padding:8px;background:#252540;border-radius:6px;">';
    html += '<div style="font-size:11px;color:#888;margin-bottom:6px;">Patterns (' + patterns.length + ')</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    // Group by id
    var pGroups = [], pSeen = {};
    patterns.forEach(function(p) {
      var pid = String(p.id);
      if (!pSeen[pid]) { pSeen[pid] = []; pGroups.push({id:pid, patterns:pSeen[pid]}); }
      pSeen[pid].push(p);
    });
    pGroups.forEach(function(group, gIdx) {
      var first = group.patterns[0];
      var hasMulti = group.patterns.length > 1;
      var fmt = first.format || '';
      html += '<div style="text-align:center;">';
      html += '<div class="play-pat-grid" data-group="' + gIdx + '" data-idx="0" style="display:grid;grid-template-columns:repeat(' + cardWidth + ',12px);gap:1px;border:1px solid #555;border-radius:2px;padding:1px;background:#555;cursor:' + (hasMulti?'pointer':'default') + ';">';
      for (var i = 0; i < numPerCard; i++) {
        var isReq = i < fmt.length && fmt[i] === '1';
        html += '<div style="width:12px;height:12px;background:' + (isReq ? '#e6e600' : '#2a2a4e') + ';"></div>';
      }
      html += '</div>';
      html += '<div style="font-size:8px;color:#888;margin-top:1px;">x' + (first.value||0) + (hasMulti?' ('+group.patterns.length+')':'') + '</div>';
      html += '</div>';
    });
    html += '</div></div>';
    // Store for cycling
    window._playPatGroups = pGroups.map(function(g){return g.patterns.map(function(p){return {format:p.format,alias:p.alias};});});
    window._playPatWidth = cardWidth;
    window._playPatTotal = numPerCard;
    // Start auto-cycle
    if (window._playPatCycleTimer) clearInterval(window._playPatCycleTimer);
    window._playPatCycleTimer = setInterval(function() {
      if (!window._playPatGroups) return;
      _playPatGroups.forEach(function(group, idx) {
        if (group.length <= 1) return;
        var gridEl = document.querySelectorAll('.play-pat-grid[data-group="' + idx + '"]')[0];
        if (!gridEl) return;
        var cur = (parseInt(gridEl.getAttribute('data-idx'))||0);
        var next = (cur + 1) % group.length;
        gridEl.setAttribute('data-idx', next);
        var fmt = group[next].format || '';
        var cells = gridEl.querySelectorAll('div');
        for (var i = 0; i < cells.length; i++) {
          cells[i].style.background = (i < fmt.length && fmt[i] === '1') ? '#e6e600' : '#2a2a4e';
        }
      });
    }, 1500);
  }

  // Cards area - render from numeros
  var numeros = resp.numeros || [];
  var qtd = resp.qtd || 4;
  html += '<div id="playCardsArea" style="background:#222;border-radius:8px;padding:12px;margin-bottom:12px;overflow-x:auto;">';
  if (numeros.length > 0) {
    if (qtd > 8) {
      // Perimeter layout: arrange cards around a rectangle border
      // Calculate grid: perimeter = 2*(cols + rows) - 4 corners overlap
      // For 20 cards: top=8, right side=2, bottom=8, left side=2 => 8+2+8+2=20
      var perimCols = Math.ceil(qtd / 4) + 1; // e.g. 20 -> 6, but we want wider
      var perimRows = 4;
      // Better: top row = ceil(qtd * 2 / 5), but let's use a clean formula
      // top + bottom = roughly 2/3 of cards, sides = 1/3
      var topCount = Math.ceil(qtd / 3);
      var bottomCount = topCount;
      var sideCount = Math.ceil((qtd - topCount - bottomCount) / 2);
      // Adjust to fit exactly qtd
      while (topCount + bottomCount + sideCount * 2 > qtd) { if (sideCount > 0) sideCount--; else bottomCount--; }
      while (topCount + bottomCount + sideCount * 2 < qtd) topCount++;
      var cellSize = 20; // smaller cells for many cards
      var fontSize = 9;
      var cardGap = 4;

      // Build card positions: top (left to right), right (top to bottom), bottom (right to left), left (bottom to top)
      var cardOrder = [];
      var topStart = 0;
      for (var i = 0; i < topCount; i++) cardOrder.push(i);
      var rightStart = topCount;
      for (var i = 0; i < sideCount; i++) cardOrder.push(rightStart + i);
      var bottomStart = topCount + sideCount;
      for (var i = 0; i < bottomCount; i++) cardOrder.push(bottomStart + i);
      var leftStart = topCount + sideCount + bottomCount;
      for (var i = 0; i < sideCount; i++) cardOrder.push(leftStart + i);

      // Render using CSS grid perimeter approach
      var totalCols = topCount;
      var totalRows = sideCount + 2; // top row + side rows + bottom row
      html += '<div style="position:relative;display:grid;grid-template-columns:repeat(' + totalCols + ',1fr);grid-template-rows:repeat(' + totalRows + ',auto);gap:' + cardGap + 'px;">';

      // Helper to render a mini card
      function renderMiniCard(c, cw, ch, npc, nums, cs, fs) {
        var s = '<div style="text-align:center;cursor:pointer;" onclick="playShowCardPreview(' + c + ')">';
        s += '<div style="font-size:8px;color:#888;margin-bottom:1px;" id="playCardLabel' + c + '">C' + (c+1) + '</div>';
        s += '<table style="border-collapse:collapse;margin:0 auto;">';
        for (var r = 0; r < ch; r++) {
          s += '<tr>';
          for (var col = 0; col < cw; col++) {
            var idx = c * npc + r * cw + col;
            var num = idx < nums.length ? nums[idx] : '-';
            var isFree = (num === 0);
            s += '<td class="play-card-cell" data-card="' + c + '" data-idx="' + (r*cw+col) + '" data-num="' + num + '" style="width:' + cs + 'px;height:' + cs + 'px;border:1px solid #444;text-align:center;font-size:' + fs + 'px;font-weight:700;background:' + (isFree ? '#333' : '#f0f0f0') + ';color:' + (isFree ? '#fff' : '#333') + ';">';
            s += isFree ? '\u2605' : (num < 10 ? '0' + num : num);
            s += '</td>';
          }
          s += '</tr>';
        }
        s += '</table></div>';
        return s;
      }

      // Top row
      var cardIdx = 0;
      for (var i = 0; i < topCount; i++) {
        html += '<div style="grid-column:' + (i+1) + ';grid-row:1;">';
        html += renderMiniCard(cardIdx, cardWidth, cardHeight, numPerCard, numeros, cellSize, fontSize);
        html += '</div>';
        cardIdx++;
      }
      // Right side
      for (var i = 0; i < sideCount; i++) {
        html += '<div style="grid-column:' + totalCols + ';grid-row:' + (i+2) + ';">';
        html += renderMiniCard(cardIdx, cardWidth, cardHeight, numPerCard, numeros, cellSize, fontSize);
        html += '</div>';
        cardIdx++;
      }
      // Bottom row (right to left order visually, but we render left to right)
      for (var i = bottomCount - 1; i >= 0; i--) {
        html += '<div style="grid-column:' + (i+1) + ';grid-row:' + totalRows + ';">';
        html += renderMiniCard(cardIdx, cardWidth, cardHeight, numPerCard, numeros, cellSize, fontSize);
        html += '</div>';
        cardIdx++;
      }
      // Left side (bottom to top order)
      for (var i = sideCount - 1; i >= 0; i--) {
        html += '<div style="grid-column:1;grid-row:' + (i+2) + ';">';
        html += renderMiniCard(cardIdx, cardWidth, cardHeight, numPerCard, numeros, cellSize, fontSize);
        html += '</div>';
        cardIdx++;
      }

      // Center preview area
      var centerColStart = 2;
      var centerColEnd = totalCols;
      var centerRowStart = 2;
      var centerRowEnd = totalRows;
      html += '<div id="playCardPreview" style="grid-column:' + centerColStart + '/' + centerColEnd + ';grid-row:' + centerRowStart + '/' + centerRowEnd + ';display:flex;align-items:center;justify-content:center;background:#1a1a2e;border-radius:8px;padding:8px;min-height:120px;">';
      // Default: show first card enlarged
      html += playRenderPreviewCard(0, cardWidth, cardHeight, numPerCard, numeros);
      html += '</div>';

      html += '</div>';
    } else {
      // Standard grid layout for <= 8 cards
      var gridCols = qtd <= 2 ? qtd : 2;
      html += '<div style="display:grid;grid-template-columns:repeat(' + gridCols + ',auto);gap:12px;justify-content:center;">';
      for (var c = 0; c < qtd; c++) {
        html += '<div style="text-align:center;">';
        html += '<div style="font-size:10px;color:#888;margin-bottom:4px;" id="playCardLabel' + c + '">Card ' + (c+1) + '</div>';
        html += '<table style="border-collapse:collapse;">';
        for (var row = 0; row < cardHeight; row++) {
          html += '<tr>';
          for (var col = 0; col < cardWidth; col++) {
            var idx = c * numPerCard + row * cardWidth + col;
            var num = idx < numeros.length ? numeros[idx] : '-';
            var isFree = (num === 0);
            html += '<td class="play-card-cell" data-card="' + c + '" data-idx="' + (row*cardWidth+col) + '" data-num="' + num + '" style="width:36px;height:36px;border:1px solid #444;text-align:center;font-size:13px;font-weight:700;background:' + (isFree ? '#333' : '#f0f0f0') + ';color:' + (isFree ? '#fff' : '#333') + ';">';
            html += isFree ? '\u2605' : (num < 10 ? '0' + num : num);
            html += '</td>';
          }
          html += '</tr>';
        }
        html += '</table></div>';
      }
      html += '</div>';
    }
  } else {
    html += '<div style="color:#666;text-align:center;">No cards received</div>';
  }
  html += '</div>';

  // Ball area - fixed height for 4 rows of balls (prevents bottom controls from jumping)
  html += '<div id="playBallArea" style="min-height:136px;padding:8px;display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start;background:#1a1a2e;border-radius:6px;margin-bottom:12px;"></div>';

  // Bottom controls: Bet left, WIN centered, Spin right
  html += '<div style="display:flex;align-items:center;padding:12px;background:#333;border-radius:6px;">';
  // Bet selector (left)
  html += '<div style="flex:1;display:flex;align-items:center;gap:8px;">';
  html += '<span style="color:#aaa;font-size:12px;">Bet:</span>';
  var activeCards = qtd || 4;
  html += '<select id="playBetSelect" onchange="playUpdateJackpot()" style="width:80px;padding:6px 8px;border-radius:8px;border:1px solid #555;background:#222;color:#fff;font-size:12px;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;background-image:url(\'data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;10&quot; height=&quot;6&quot;><polyline points=&quot;0,0 5,6 10,0&quot; fill=&quot;%23888&quot;/></svg>\');background-repeat:no-repeat;background-position:right 8px center;">';
  betList.forEach(function(b) { html += '<option value="' + b + '">' + (b * activeCards).toFixed(2) + '</option>'; });
  html += '</select>';
  html += '</div>';
  // Win display (center)
  html += '<div style="flex:1;text-align:center;color:#27ae60;font-size:14px;font-weight:600;" id="playWinDisplay">WIN: 0.00</div>';
  // Spin button (right)
  html += '<div style="flex:1;display:flex;justify-content:flex-end;"><button onclick="playSpin()" style="padding:10px 24px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">SPIN</button></div>';
  html += '</div>';

  gameArea.innerHTML = html;
  document.getElementById('playBottomText').textContent = 'Connected | Balance: ' + balance.toLocaleString() + ' ' + currency;
}

function playCalcJackpot(betIndex) {
  var pool = window._playJackpotPool || 0;
  var baseUnit = window._playJackpotBaseUnit || 1;
  var rates = window._playJackpotRates || [];
  var idx = Math.min(betIndex, rates.length - 1);
  if (idx < 0 || rates.length === 0) return 0;
  return pool * baseUnit * (rates[idx] || 0);
}

function playUpdateJackpot() {
  var sel = document.getElementById('playBetSelect');
  var betIndex = sel.selectedIndex || 0;
  var jp = playCalcJackpot(betIndex);
  var precision = window._playDisplayPrecision || 2;
  var jpEl = document.getElementById('playJackpotDisplay');
  if (jpEl) {
    if (jp <= 0) {
      jpEl.innerHTML = '<span style="position:relative;color:#888;">\uD83D\uDD12 JP: ' + jp.toFixed(precision) + '<span style="position:absolute;top:-2px;right:-14px;font-size:9px;color:#e74c3c;" title="Current bet does not trigger jackpot">\u26D4</span></span>';
    } else {
      jpEl.innerHTML = '\uD83C\uDFC6 JP: ' + jp.toFixed(precision);
      jpEl.style.color = '#f39c12';
    }
  }
}

function playRenderPreviewCard(cardIdx, cw, ch, npc, numeros) {
  var s = '<div style="text-align:center;">';
  s += '<div style="font-size:11px;color:#aaa;margin-bottom:4px;">Card ' + (cardIdx+1) + '</div>';
  s += '<table style="border-collapse:collapse;margin:0 auto;">';
  for (var r = 0; r < ch; r++) {
    s += '<tr>';
    for (var col = 0; col < cw; col++) {
      var idx = cardIdx * npc + r * cw + col;
      var num = idx < numeros.length ? numeros[idx] : '-';
      var isFree = (num === 0);
      s += '<td class="play-preview-cell" data-card="' + cardIdx + '" data-idx="' + (r*cw+col) + '" data-num="' + num + '" style="width:32px;height:32px;border:1px solid #555;text-align:center;font-size:12px;font-weight:700;background:' + (isFree ? '#333' : '#e8e8e8') + ';color:' + (isFree ? '#fff' : '#333') + ';">';
      s += isFree ? '\u2605' : (num < 10 ? '0' + num : num);
      s += '</td>';
    }
    s += '</tr>';
  }
  s += '</table></div>';
  return s;
}

function playShowCardPreview(cardIdx) {
  var preview = document.getElementById('playCardPreview');
  if (!preview || !_playCurrentMachine) return;
  var resp = _playCurrentMachine.response;
  var config = _playCurrentMachine.config;
  var mathModel = (config.math_model && config.math_model[0]) || {};
  var cw = mathModel.card_width || 5;
  var ch = mathModel.card_height || 5;
  var npc = mathModel.numPerCard || (cw * ch);
  var numeros = resp.numeros || [];
  preview.innerHTML = playRenderPreviewCard(cardIdx, cw, ch, npc, numeros);

  // Re-apply ball markings on the preview card
  var ballArea = document.getElementById('playBallArea');
  if (ballArea) {
    var ballDivs = ballArea.querySelectorAll('div');
    var hitBalls = new Set();
    ballDivs.forEach(function(d) { var n = parseInt(d.textContent); if (!isNaN(n)) hitBalls.add(n); });
    // Also add from last spin
    if (_playSpinResponse && _playSpinResponse.balls) {
      _playSpinResponse.balls.forEach(function(b) { hitBalls.add(b); });
    }
    var previewCells = preview.querySelectorAll('.play-preview-cell[data-card="' + cardIdx + '"]');
    previewCells.forEach(function(cell) {
      var num = parseInt(cell.getAttribute('data-num'));
      if (num === 0 || hitBalls.has(num)) {
        if (num !== 0) { cell.style.background = '#222'; cell.style.color = '#fff'; }
      }
    });
  }
}

function playRenderSlotGame(resp, machineConfig) {
  var gameArea = document.getElementById('playGameArea');
  var betList = resp.bet_list || [];
  var balance = resp.balance || 0;
  var nickname = resp.nickname || 'Player';
  var gameId = resp.game_id || '';
  var currency = resp.display_currency_symbol || '';
  var displayPrecision = resp.display_currency_precision || 2;
  var targetCode = resp.target_code || [];

  // Parse jackpot
  var jackpotPool = 0, jackpotBaseUnit = 1, jackpotRates = [];
  try {
    var features = resp.features || [];
    if (features.length > 0) {
      var feat = JSON.parse(features[0]);
      if (feat.jackpot && feat.jackpot[0]) {
        var jp = feat.jackpot[0];
        jackpotRates = jp.jackpot_prize_rate_list || [];
        jackpotBaseUnit = jp.jackpot_base_unit_to_currency || 1;
        var poolItem = JSON.parse(jp.jackpot_pool_item || '{}');
        jackpotPool = parseFloat(poolItem.jackpotPool) || 0;
      }
    }
  } catch(e) {}
  window._playJackpotPool = jackpotPool;
  window._playJackpotBaseUnit = jackpotBaseUnit;
  window._playJackpotRates = jackpotRates;
  window._playBetList = betList;
  window._playDisplayPrecision = displayPrecision;

  var html = '';
  // Top info bar
  html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#333;border-radius:6px;margin-bottom:12px;color:#fff;font-size:12px;">';
  html += '<span>\uD83D\uDC64 ' + nickname + '</span>';
  html += '<span>\uD83D\uDCB0 ' + balance.toLocaleString() + ' ' + currency + '</span>';
  html += '<span id="playJackpotDisplay" style="color:#f39c12;font-weight:600;">\uD83C\uDFC6 JP: ' + playCalcJackpot(0).toFixed(displayPrecision) + '</span>';
  html += '<span>\uD83C\uDFB0 #' + gameId + ' (Slot)</span>';
  html += '</div>';

  // Target codes / Paytable info
  if (targetCode.length > 0) {
    html += '<div style="margin-bottom:12px;padding:8px;background:#252540;border-radius:6px;">';
    html += '<div style="font-size:11px;color:#888;margin-bottom:6px;">Target Codes</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    targetCode.forEach(function(tc) {
      html += '<span style="padding:3px 8px;background:#333;border:1px solid #555;border-radius:4px;font-size:11px;color:#e6e600;">' + tc + '</span>';
    });
    html += '</div></div>';
  }

  // Reels area (placeholder for slot)
  html += '<div id="playReelsArea" style="background:#222;border-radius:8px;padding:40px;min-height:250px;display:flex;align-items:center;justify-content:center;color:#666;font-size:16px;margin-bottom:12px;">';
  html += '<div style="text-align:center;"><div style="font-size:48px;margin-bottom:12px;">\uD83C\uDFB0</div>Ready to spin</div>';
  html += '</div>';

  // Bottom controls
  html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:#333;border-radius:6px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;">';
  html += '<span style="color:#aaa;font-size:12px;">Bet:</span>';
  html += '<select id="playBetSelect" onchange="playUpdateJackpot()" style="padding:4px 8px;border-radius:4px;border:1px solid #555;background:#222;color:#fff;font-size:13px;">';
  betList.forEach(function(b) { html += '<option value="' + b + '">' + b + '</option>'; });
  html += '</select>';
  html += '</div>';
  html += '<div style="color:#27ae60;font-size:14px;font-weight:600;" id="playWinDisplay">WIN: 0.00</div>';
  html += '<button onclick="playSpin()" style="padding:10px 24px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">SPIN</button>';
  html += '</div>';

  gameArea.innerHTML = html;
  document.getElementById('playBottomText').textContent = 'Connected | Balance: ' + balance.toLocaleString() + ' ' + currency;
}

var _playBallsQueue = [];
var _playBallTimer = null;
var _playStopRequested = false;
var _playSpinState = 'idle'; // idle, spinning, eb_available, waiting_roundover
var _playCardIdx = [];
var _playSpinResponse = null;

async function playSpin() {
  if (!_playSessionToken || !_playCurrentMachine) { showAlert('Not connected'); return; }
  var machineType = _playCurrentMachine.type || 'bingo';

  if (machineType === 'slot') {
    // Slot: use generic send
    await playSlotSpin();
    return;
  }

  // Bingo spin
  if (_playSpinState !== 'idle') return;
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { showAlert('WebSocket not connected'); return; }
  var bet = parseFloat(document.getElementById('playBetSelect').value) || 0.01;
  var resp = _playCurrentMachine.response;
  var qtd = resp.qtd || 4;

  // Build card_idx (1-based, all active cards)
  if (!_playCardIdx.length) {
    _playCardIdx = [];
    for (var i = 1; i <= qtd; i++) _playCardIdx.push(i);
  }

  _playSpinState = 'spinning';
  _playStopRequested = false;
  var spinBtn = document.querySelector('#playGameArea button[onclick="playSpin()"]');
  if (spinBtn) { spinBtn.textContent = 'STOP'; spinBtn.onclick = function() { _playStopRequested = true; }; }
  document.getElementById('playWinDisplay').textContent = 'SPINNING...';

  var spinCmd = {
    cmd: 'solicitajogada',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    aposta: bet,
    card_idx: _playCardIdx,
    bonus_unique_id: '',
    is_bonus: false,
    target_pattern_ids: [],
    target_feature_ids: [],
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [SPIN] send: ' + JSON.stringify(spinCmd));
  _playWs.send(JSON.stringify(spinCmd));
  // Response handled in _playWs.onmessage -> playHandleSpinResponse
}

function playHandleSpinResponse(spinResp) {
  // Check if this is a buy-EB response (has 'extra' field)
  if (spinResp.extra !== undefined) {
    playHandleBuyEbResponse(spinResp);
    return;
  }

  _playSpinResponse = spinResp;
  playUpdateBalance(spinResp.balance);
  playUpdateJackpotFromFeatures(spinResp.features);

  // Reset cards before showing new balls
  playResetCards();

  // Clear ball area (already exists in DOM with fixed height)
  var ballArea = document.getElementById('playBallArea');
  if (ballArea) ballArea.innerHTML = '';

  // Start ball animation
  _playBallsQueue = (spinResp.balls || []).slice();
  playAnimateBalls(function() {
    document.getElementById('playWinDisplay').textContent = 'WIN: ' + (spinResp.total_won || 0).toFixed(2);

    // Check pattern matches and "miss one" after all balls displayed
    playCheckPatterns(spinResp.balls || []);

    if (spinResp.finalizou === true) {
      _playSpinState = 'waiting_roundover';
      playResetSpinBtn();
      var btn = document.querySelector('#playGameArea button[onclick="playSpin()"]');
      if (btn) btn.disabled = true;
      playRoundOver();
    } else {
      _playSpinState = 'eb_available';
      playShowEbButtons(spinResp.eb_price || 0);
    }
  });
}

function playResetCards() {
  // Reset all card cells to original state
  var cells = document.querySelectorAll('.play-card-cell');
  cells.forEach(function(cell) {
    var num = parseInt(cell.getAttribute('data-num'));
    var isFree = (num === 0);
    cell.style.background = isFree ? '#333' : '#f0f0f0';
    cell.style.color = isFree ? '#fff' : '#333';
    cell.style.textDecoration = '';
    cell.innerHTML = isFree ? '\u2605' : (num < 10 ? '0' + num : num);
  });
  // Reset card labels
  var qtd = (_playCurrentMachine && _playCurrentMachine.response) ? (_playCurrentMachine.response.qtd || 4) : 4;
  var isPerimeter = qtd > 8;
  for (var c = 0; c < qtd; c++) {
    var label = document.getElementById('playCardLabel' + c);
    if (label) label.innerHTML = isPerimeter ? ('C' + (c+1)) : ('Card ' + (c+1));
  }
}

function playCheckPatterns(ballList) {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return;
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var patterns = mathModel.pattern || [];
  var numPerCard = mathModel.numPerCard || 25;
  var qtd = (_playCurrentMachine.response && _playCurrentMachine.response.qtd) || 4;
  var numeros = (_playCurrentMachine.response && _playCurrentMachine.response.numeros) || [];
  var ballSet = new Set(ballList);
  var bet = parseFloat((document.getElementById('playBetSelect') || {}).value) || 0.01;

  // Track hits per card for label display and preview priority
  var cardHitsInfo = {}; // cardIdx -> [{alias, value}]
  var firstWinCard = -1;

  for (var c = 0; c < qtd; c++) {
    var cardOffset = c * numPerCard;
    // Determine hits for this card
    var cardHits = [];
    for (var i = 0; i < numPerCard; i++) {
      var num = numeros[cardOffset + i];
      cardHits.push(num === 0 || ballSet.has(num));
    }

    // Check each pattern
    patterns.forEach(function(p) {
      var fmt = p.format || '';
      if (fmt.length !== numPerCard) return;
      var missCount = 0, missIdx = -1;
      for (var i = 0; i < numPerCard; i++) {
        if (fmt[i] === '1' && !cardHits[i]) { missCount++; missIdx = i; if (missCount > 1) break; }
      }

      if (missCount === 0) {
        // Full match - red line through matched cells
        for (var i = 0; i < numPerCard; i++) {
          if (fmt[i] === '1') {
            var cell = document.querySelector('.play-card-cell[data-card="' + c + '"][data-idx="' + i + '"]');
            if (cell) {
              cell.style.textDecoration = 'line-through';
              cell.style.textDecorationColor = '#e74c3c';
              cell.style.textDecorationThickness = '2px';
            }
          }
        }
        // Record hit info
        if (!cardHitsInfo[c]) cardHitsInfo[c] = [];
        cardHitsInfo[c].push({alias: p.alias || p.name, value: (bet * (p.value || 0)).toFixed(2)});
        if (firstWinCard < 0) firstWinCard = c;
      } else if (missCount === 1) {
        // Miss one - show expected win on the missing cell
        var cell = document.querySelector('.play-card-cell[data-card="' + c + '"][data-idx="' + missIdx + '"]');
        if (cell) {
          var origNum = numeros[cardOffset + missIdx];
          cell.style.background = '#ffe600';
          cell.style.color = '#333';
          cell.innerHTML = '<span style="font-size:8px;color:#666;display:block;line-height:1;">' + (origNum < 10 ? '0'+origNum : origNum) + '</span><span style="font-size:12px;font-weight:700;color:#333;display:block;line-height:1.1;">x' + p.value + '</span>';
        }
      }
    });
  }

  // Update card labels with hit pattern info
  for (var c in cardHitsInfo) {
    var label = document.getElementById('playCardLabel' + c);
    if (label) {
      var infoStr = cardHitsInfo[c].map(function(h) { return h.alias + ':' + h.value; }).join(' ');
      label.innerHTML = '<span style="color:#e74c3c;font-weight:600;">\u2605 ' + infoStr + '</span>';
    }
  }

  // If perimeter layout, show first winning card in center preview
  if (firstWinCard >= 0 && document.getElementById('playCardPreview')) {
    playShowCardPreview(firstWinCard);
  }
}

function playHandleRoundOverResponse(roResp) {
  playUpdateBalance(roResp.balance);
  if (roResp.total_won !== undefined) {
    document.getElementById('playWinDisplay').textContent = 'WIN: ' + roResp.total_won.toFixed(2);
  }
  _playSpinState = 'idle';
  playResetSpinBtn();
}

function playHandleBuyEbResponse(ebResp) {
  playLog('<<< [BUY EB] handling: extra=' + ebResp.extra + ', won=' + ebResp.total_won + ', has_eb=' + ebResp.has_extra_ball + ', eb_price=' + ebResp.eb_price);
  document.getElementById('playWinDisplay').textContent = 'WIN: ' + (ebResp.total_won || 0).toFixed(2);
  playUpdateBalance(ebResp.balance);
  playUpdateJackpotFromFeatures(ebResp.features);

  // Show the extra ball
  if (ebResp.extra) {
    var ballArea = document.getElementById('playBallArea');
    if (ballArea) ballArea.innerHTML += '<div style="width:28px;height:28px;border-radius:50%;background:#e74c3c;border:2px solid #fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">' + ebResp.extra + '</div>';
    playMarkBallOnCards(ebResp.extra);
  }

  // Re-check patterns with updated ball list (original balls + all EBs so far)
  playRecheckPatternsAfterEb();

  // Check if more EBs available
  if (ebResp.has_extra_ball === true && ebResp.eb_price !== undefined) {
    // Update EB price button
    var ebBtn = document.getElementById('playEbPriceBtn');
    if (ebBtn) {
      ebBtn.textContent = 'EB ' + (ebResp.eb_price > 0 ? ebResp.eb_price.toFixed(2) : 'FREE');
    } else {
      playShowEbButtons(ebResp.eb_price);
    }
  } else {
    // No more EBs or finalizou, round over
    playRemoveEbButtons();
    _playSpinState = 'waiting_roundover';
    playRoundOver();
  }
}

function playAnimateBalls(onComplete) {
  var ballArea = document.getElementById('playBallArea');
  if (!ballArea) {
    // Fallback: create ball display area if not found
    var cardsArea = document.getElementById('playCardsArea');
    if (cardsArea) {
      ballArea = document.createElement('div');
      ballArea.id = 'playBallArea';
      ballArea.style.cssText = 'min-height:136px;padding:8px;display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start;background:#1a1a2e;border-radius:6px;margin-bottom:12px;';
      cardsArea.parentElement.insertBefore(ballArea, cardsArea.nextSibling);
    }
  }
  if (ballArea) ballArea.innerHTML = '';

  var idx = 0;
  var ballColors = ['#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6','#1abc9c','#e91e63','#ff9800'];

  function showNext() {
    if (idx >= _playBallsQueue.length || _playStopRequested) {
      // Show all remaining at once
      while (idx < _playBallsQueue.length) {
        var b = _playBallsQueue[idx];
        if (ballArea) ballArea.innerHTML += '<div style="width:28px;height:28px;border-radius:50%;background:' + ballColors[idx%ballColors.length] + ';display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">' + b + '</div>';
        playMarkBallOnCards(b);
        idx++;
      }
      _playBallTimer = null;
      if (onComplete) onComplete();
      return;
    }
    var b = _playBallsQueue[idx];
    if (ballArea) ballArea.innerHTML += '<div style="width:28px;height:28px;border-radius:50%;background:' + ballColors[idx%ballColors.length] + ';display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">' + b + '</div>';
    playMarkBallOnCards(b);
    idx++;
    _playBallTimer = setTimeout(showNext, 200);
  }
  showNext();
}

function playRecheckPatternsAfterEb() {
  // Collect all displayed balls from ball area
  var ballArea = document.getElementById('playBallArea');
  if (!ballArea) return;
  var ballDivs = ballArea.querySelectorAll('div');
  var allBalls = [];
  ballDivs.forEach(function(d) { var n = parseInt(d.textContent); if (!isNaN(n)) allBalls.push(n); });
  // Also add original spin balls
  if (_playSpinResponse && _playSpinResponse.balls) {
    _playSpinResponse.balls.forEach(function(b) { if (allBalls.indexOf(b) < 0) allBalls.push(b); });
  }
  // Reset pattern decorations (keep hit markings) then re-check
  var cells = document.querySelectorAll('.play-card-cell');
  cells.forEach(function(cell) {
    var num = parseInt(cell.getAttribute('data-num'));
    var isFree = (num === 0);
    var ballSet = new Set(allBalls);
    var isHit = isFree || ballSet.has(num);
    // Reset decoration but keep hit state
    cell.style.textDecoration = '';
    if (isHit && !isFree) {
      cell.style.background = '#222';
      cell.style.color = '#fff';
      cell.innerHTML = num < 10 ? '0' + num : '' + num;
    }
  });
  playCheckPatterns(allBalls);
}

function playMarkBallOnCards(ballNum) {
  // Mark matching cells on cards as hit (black bg, white text)
  var cells = document.querySelectorAll('.play-card-cell');
  cells.forEach(function(cell) {
    if (parseInt(cell.getAttribute('data-num')) === ballNum) {
      cell.style.background = '#222';
      cell.style.color = '#fff';
    }
  });
}

function playShowEbButtons(ebPrice) {
  // Remove existing EB buttons
  var existingEb = document.getElementById('playEbBtns');
  if (existingEb) existingEb.remove();
  // Find the bottom controls div
  var controlsDiv = document.querySelector('#playGameArea > div:last-child');
  if (!controlsDiv) return;
  // Replace the spin button wrapper with EB buttons (collect + eb price), keep right-aligned
  var spinBtn = document.querySelector('#playGameArea button[onclick="playSpin()"]');
  var ebDiv = document.createElement('div');
  ebDiv.id = 'playEbBtns';
  ebDiv.style.cssText = 'flex:1;display:flex;gap:8px;align-items:center;justify-content:flex-end;';
  ebDiv.innerHTML = '<button onclick="playCollect()" style="padding:10px 16px;background:#f39c12;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">COLLECT</button>' +
    '<button id="playEbPriceBtn" onclick="playBuyEb()" style="padding:10px 16px;background:#e74c3c;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">EB ' + (ebPrice > 0 ? ebPrice.toFixed(2) : 'FREE') + '</button>';
  if (spinBtn) {
    spinBtn.parentElement.replaceWith(ebDiv);
  }
}

function playBuyEb() {
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { showAlert('Not connected'); return; }
  var resp = _playCurrentMachine.response;
  var ebCmd = {
    cmd: 'solicitajogada',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    bonus_unique_id: '',
    is_bonus: false,
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [BUY EB] send: ' + JSON.stringify(ebCmd));
  _playWs.send(JSON.stringify(ebCmd));
  // Response handled in onmessage -> playHandleSpinResponse -> playHandleBuyEbResponse
}

function playCollect() {
  playRemoveEbButtons();
  _playSpinState = 'waiting_roundover';
  playRoundOver();
}

function playRoundOver() {
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { _playSpinState = 'idle'; playResetSpinBtn(); return; }
  var resp = _playCurrentMachine.response;
  var roCmd = {
    cmd: 'finalizajogada',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    bonus_unique_id: '',
    is_bonus: false,
    finalizar: true,
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [ROUND OVER] send: ' + JSON.stringify(roCmd));
  _playWs.send(JSON.stringify(roCmd));
  // Response handled in onmessage -> playHandleRoundOverResponse
}

function playResetSpinBtn() {
  // Remove EB buttons if present
  playRemoveEbButtons();
  // Find or recreate spin button
  var gameArea = document.getElementById('playGameArea');
  if (!gameArea) return;
  var existingBtn = gameArea.querySelector('button[onclick="playSpin()"]');
  if (existingBtn) {
    existingBtn.textContent = 'SPIN';
    existingBtn.disabled = false;
    existingBtn.onclick = playSpin;
  }
}

function playRemoveEbButtons() {
  var ebDiv = document.getElementById('playEbBtns');
  if (ebDiv) {
    // Replace with spin button wrapped in right-aligned container
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'flex:1;display:flex;justify-content:flex-end;';
    wrapper.innerHTML = '<button onclick="playSpin()" style="padding:10px 24px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">SPIN</button>';
    ebDiv.replaceWith(wrapper);
  }
}

function playUpdateBalance(newBalance) {
  if (newBalance === undefined || newBalance === null) return;
  var currency = (_playCurrentMachine && _playCurrentMachine.response) ? (_playCurrentMachine.response.display_currency_symbol || '') : '';
  // Update top info bar balance
  var topBar = document.querySelector('#playGameArea > div:first-child');
  if (topBar) {
    var spans = topBar.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent.indexOf('\uD83D\uDCB0') >= 0) {
        spans[i].textContent = '\uD83D\uDCB0 ' + newBalance.toLocaleString() + ' ' + currency;
        break;
      }
    }
  }
  // Update bottom text
  document.getElementById('playBottomText').textContent = 'Balance: ' + newBalance.toLocaleString() + ' ' + currency;
}

function playUpdateJackpotFromFeatures(features) {
  if (!features || !features.length) return;
  try {
    var feat = JSON.parse(features[0]);
    if (feat.jackpot && feat.jackpot[0] && feat.jackpot[0].jackpot_pool_item) {
      var poolItem = JSON.parse(feat.jackpot[0].jackpot_pool_item);
      window._playJackpotPool = parseFloat(poolItem.jackpotPool) || 0;
      playUpdateJackpot();
    }
  } catch(e) {}
}

async function playSlotSpin() {
  var bet = parseFloat(document.getElementById('playBetSelect').value) || 0.01;
  document.getElementById('playWinDisplay').textContent = 'SPINNING...';
  var slotPayload = { session_token: _playSessionToken, cmd: {cmd: 'jogar', bet: bet, lines: 1} };
  playLog('>>> [SLOT SPIN] send: ' + JSON.stringify(slotPayload));
  var res = await fetch('/play/send', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(slotPayload)
  });
  var data = await res.json();
  if (data.error) { playLog('<<< [SLOT SPIN] error: ' + data.error); showAlert(data.error); document.getElementById('playWinDisplay').textContent = 'ERROR'; return; }
  var resp = data.response;
  document.getElementById('playWinDisplay').textContent = 'WIN: ' + (resp.total_won || 0).toFixed(2);
  playLog('<<< [SLOT SPIN] response: ' + JSON.stringify(resp));
  playUpdateBalance(resp.balance);
  playUpdateJackpotFromFeatures(resp.features);
}

function playBackToLobby() {
  // Stop pattern auto-cycle
  if (window._playPatCycleTimer) { clearInterval(window._playPatCycleTimer); window._playPatCycleTimer = null; }
  // Close browser WebSocket
  if (_playWs) { try { _playWs.close(); } catch(e) {} _playWs = null; }
  _playSessionToken = '';
  _playCurrentMachine = null;
  _playSpinState = 'idle';
  _playCardIdx = [];
  playLoadMachines();
}
