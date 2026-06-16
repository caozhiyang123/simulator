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

async function playLoadMachines() {
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

var _playWs = null; // Browser WebSocket connection to Java server
var _playCurrency = 'coins';
var _playAuthToken = '';

async function playSelectMachine(machineId, enabled, machineType) {
  if (!enabled) { showAlert('Coming soon'); return; }

  document.getElementById('playBottomText').textContent = 'Connecting to server...';
  document.getElementById('playLogPanel').textContent = '';
  playLog('>>> [INIT] Loading machine config: machine_id=' + machineId);

  // Get machine config from master (HTTP)
  var res = await fetch('/play/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({machine_id: machineId})
  });
  var data = await res.json();
  if (data.error) { playLog('<<< [INIT] error: ' + data.error); showAlert(data.error); document.getElementById('playBottomText').textContent = 'Failed'; return; }

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
  } catch(e) { playLog('<<< [WS CONNECT] error: ' + e.message); showAlert('WebSocket connection failed: ' + e.message); return; }

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

  _playWs.onerror = function(e) { playLog('<<< [WS ERROR] ' + (e.message || 'connection error')); };
  _playWs.onclose = function(e) { playLog('<<< [WS CLOSE] code=' + e.code + ', reason=' + e.reason); _playWs = null; };
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
    var gridCols = qtd <= 2 ? qtd : 2;
    html += '<div style="display:grid;grid-template-columns:repeat(' + gridCols + ',auto);gap:12px;justify-content:center;">';
    for (var c = 0; c < qtd; c++) {
      html += '<div style="text-align:center;">';
      html += '<div style="font-size:10px;color:#888;margin-bottom:4px;">Card ' + (c+1) + '</div>';
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
  } else {
    html += '<div style="color:#666;text-align:center;">No cards received</div>';
  }
  html += '</div>';

  // Bottom controls: Bet left, WIN centered, Spin right
  html += '<div style="display:flex;align-items:center;padding:12px;background:#333;border-radius:6px;">';
  // Bet selector (left)
  html += '<div style="flex:1;display:flex;align-items:center;gap:8px;">';
  html += '<span style="color:#aaa;font-size:12px;">Bet:</span>';
  html += '<select id="playBetSelect" onchange="playUpdateJackpot()" style="padding:4px 8px;border-radius:4px;border:1px solid #555;background:#222;color:#fff;font-size:13px;">';
  betList.forEach(function(b) { html += '<option value="' + b + '">' + b + '</option>'; });
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

  // Start ball animation
  _playBallsQueue = (spinResp.balls || []).slice();
  playAnimateBalls(function() {
    document.getElementById('playWinDisplay').textContent = 'WIN: ' + (spinResp.total_won || 0).toFixed(2);

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
    // Create ball display area
    var cardsArea = document.getElementById('playCardsArea');
    if (cardsArea) {
      ballArea = document.createElement('div');
      ballArea.id = 'playBallArea';
      ballArea.style.cssText = 'padding:8px;display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;';
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
  // Replace the spin button with EB buttons (collect + eb price), keep win centered
  var spinBtn = document.querySelector('#playGameArea button[onclick="playSpin()"]');
  var ebDiv = document.createElement('div');
  ebDiv.id = 'playEbBtns';
  ebDiv.style.cssText = 'display:flex;gap:8px;align-items:center;';
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
    // Replace with spin button
    var newDiv = document.createElement('div');
    newDiv.innerHTML = '<button onclick="playSpin()" style="padding:10px 24px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">SPIN</button>';
    ebDiv.replaceWith(newDiv.firstChild);
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
  playLoadMachines();
}
