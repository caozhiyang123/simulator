// ---------------------------------------------------------------------------
// Slot Game Module
// ---------------------------------------------------------------------------
var SLOT_LINE_COLORS = [
  '#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6',
  '#1abc9c','#e91e63','#ff9800','#00bcd4','#8bc34a',
  '#ff5722','#607d8b','#cddc39','#795548','#009688',
  '#673ab7','#2196f3','#4caf50','#ffc107','#f44336'
];
var SLOT_LEFT_LINES = [4,6,2,8,1,10,9,3,7,5];

var _slotState = {
  ws: null, sessionToken: '', machineId: 0, machineName: '',
  config: null, loginResp: null, icons: [], lines: [],
  betList: [], betIndex: 0, activeLines: 20, maxLines: 20,
  chooseQuantity: false, spinning: false, reelIcons: [],
  visibleLines: {}, currency: 'coins', displaySymbol: 'CC',
  displayPrecision: 2, rowCount: 3, colCount: 5
};

function slotRenderGame(resp, machineConfig, machineName) {
  var gameArea = document.getElementById('playGameArea');
  var st = _slotState;
  st.loginResp = resp; st.config = machineConfig; st.machineName = machineName;
  st.sessionToken = resp.session_token || '';
  var mathModel = (machineConfig.math_model && machineConfig.math_model[0]) || {};
  st.icons = mathModel.icon || [];
  st.lines = mathModel.lines || [];
  st.maxLines = mathModel.max_lines || 20;
  st.activeLines = st.maxLines;
  st.rowCount = mathModel.row_count || 3;
  st.colCount = mathModel.column_count || 5;
  st.betList = resp.bet_list || [];
  st.betIndex = 0;
  st.currency = resp.currency || 'coins';
  st.displaySymbol = resp.display_currency_symbol || 'CC';
  st.displayPrecision = resp.display_currency_precision || 2;
  if (_playCurrentMachine && _playCurrentMachine.machineEntry) {
    st.chooseQuantity = !!_playCurrentMachine.machineEntry.choose_quantity;
  }
  // Jackpot
  var jackpotPool=0, jackpotBaseUnit=1, jackpotRates=[];
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
  window._playDisplayPrecision = st.displayPrecision;
  slotRandomizeReels();
  slotRenderUI();
}

function slotRandomizeReels() {
  var st = _slotState;
  var icons = st.icons.length ? st.icons : [1,2,3,4,5,6,7,8,9,10];
  st.reelIcons = [];
  for (var i = 0; i < st.rowCount * st.colCount; i++)
    st.reelIcons.push(icons[Math.floor(Math.random() * icons.length)]);
}

function slotRenderUI() {
  var st = _slotState;
  var gameArea = document.getElementById('playGameArea');
  var resp = st.loginResp;
  var balance = resp.balance || 0;
  var gameId = resp.game_id || st.machineId;
  var bgPath = '/static/machine/' + st.machineName + '/background/' + st.machineName + '.png';

  var html = '';
  // Full background container
  html += '<div id="slotSkin" style="position:relative;width:480px;margin:0 auto;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6);">';
  html += '<img src="' + bgPath + '" style="width:100%;display:block;" onerror="this.style.display=\'none\'">';

  // Pattern area (top) - clickable
  html += '<div onclick="slotShowPattern()" style="position:absolute;top:0;left:0;width:100%;height:9%;cursor:pointer;" title="View patterns"></div>';

  // Balance (inside left dark box - lower position)
  html += '<div id="slotBalance" style="position:absolute;top:18.2%;left:8%;width:38%;height:3.5%;display:flex;align-items:center;padding-left:8px;font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000;">\uD83D\uDCB0 ' + balance.toLocaleString() + ' ' + st.displaySymbol + '</div>';

  // Jackpot (inside right dark box - lower position)
  html += '<div id="slotJackpotDisplay" style="position:absolute;top:18.2%;right:15%;width:38%;height:3.5%;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-size:15px;font-weight:700;color:#f5d742;text-shadow:0 1px 2px #000;">\uD83C\uDFC6 ' + slotCalcJackpot().toFixed(st.displayPrecision) + '</div>';

  // Reels area (positioned to align with the background reel window)
  html += '<div id="slotReelsContainer" style="position:absolute;top:26%;left:17%;width:66%;height:48%;overflow:hidden;display:flex;gap:0;perspective:600px;">';
  for (var col = 0; col < st.colCount; col++) {
    // Each reel has slight perspective transform for curved effect
    var rotY = (col - 2) * 3; // -6, -3, 0, 3, 6 degrees
    // Shift outer reels inward: col0 right, col4 left
    var marginL = 0, marginR = 0;
    if (col === 0) marginL = 4;
    if (col === st.colCount - 1) marginR = 4;
    if (col === st.colCount - 2) marginR = 2;
    html += '<div class="slot-reel" data-col="' + col + '" style="flex:1;display:flex;flex-direction:column;justify-content:space-around;align-items:center;height:100%;transform:rotateY(' + rotY + 'deg);transform-style:preserve-3d;margin-left:' + marginL + '%;margin-right:' + marginR + '%;">';
    for (var row = 0; row < st.rowCount; row++) {
      var idx = row * st.colCount + col;
      var iconId = st.reelIcons[idx] || 1;
      html += '<div class="slot-cell" data-idx="' + idx + '" style="width:88%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;">';
      html += '<img src="/static/machine/' + st.machineName + '/icon/i' + iconId + '.png" style="width:92%;height:92%;object-fit:contain;border-radius:6px;" onerror="this.outerHTML=\'<span style=color:#fff;font-size:14px>i' + iconId + '</span>\'">';
      html += '</div>';
    }
    html += '</div>';
  }
  html += '<svg id="slotLineSvg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></svg>';
  html += '</div>';

  // Win display
  html += '<div id="slotWinDisplay" style="position:absolute;top:75.5%;left:0;width:100%;text-align:center;font-size:14px;font-weight:700;color:#f5d742;text-shadow:0 2px 4px #000;"></div>';

  // BET controls (left box area ~80% top, ~7% left)
  html += '<div style="position:absolute;top:80.5%;left:7%;display:flex;align-items:center;gap:3px;">';
  html += '<div class="slot-btn-3d" onclick="slotChangeBet(-1)" style="width:28px;height:28px;">-</div>';
  var totalBet = (st.betList[st.betIndex] || 0) * st.activeLines;
  html += '<div id="slotBetDisplay" style="min-width:52px;height:28px;background:#0a0a0a;border:2px solid #f5d742;border-radius:4px;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:28px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.8);">' + totalBet.toFixed(st.displayPrecision) + '</div>';
  html += '<div class="slot-btn-3d" onclick="slotChangeBet(1)" style="width:28px;height:28px;">+</div>';
  html += '</div>';

  // LINES controls (right box area ~80% top, ~38% left)
  html += '<div style="position:absolute;top:80.5%;left:38%;display:flex;align-items:center;gap:3px;">';
  if (st.chooseQuantity) {
    html += '<div class="slot-btn-3d" onclick="slotChangeLines(-1)" style="width:28px;height:28px;">-</div>';
  }
  html += '<div id="slotLinesDisplay" style="min-width:36px;height:28px;background:#0a0a0a;border:2px solid #f5d742;border-radius:4px;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:28px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.8);">' + st.activeLines + '</div>';
  if (st.chooseQuantity) {
    html += '<div class="slot-btn-3d" onclick="slotChangeLines(1)" style="width:28px;height:28px;">+</div>';
  }
  html += '</div>';

  // SPIN button (large circle, shifted left-up to align with background)
  html += '<div id="slotSpinBtn" class="slot-spin-3d" onclick="slotSpin()" style="position:absolute;top:74%;right:10%;width:86px;height:86px;">';
  html += '<span style="font-size:15px;font-weight:800;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.6);z-index:1;">SPIN</span>';
  html += '<span style="font-size:7px;color:#ffd;z-index:1;white-space:nowrap;">HOLD AUTO</span>';
  html += '</div>';

  // Line numbers (left side)
  html += '<div style="position:absolute;top:26%;left:3.5%;height:48%;display:flex;flex-direction:column;justify-content:space-between;">';
  for (var i = 0; i < st.maxLines; i++) {
    if (SLOT_LEFT_LINES.indexOf(i+1) >= 0) {
      html += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:18px;height:12px;border-radius:8px;background:' + SLOT_LINE_COLORS[i] + ';color:#fff;font-size:6px;font-weight:700;text-align:center;line-height:12px;cursor:pointer;opacity:' + (i < st.activeLines ? '1' : '0.4') + ';">' + (i+1) + '</div>';
    }
  }
  html += '</div>';
  // Line numbers (right side)
  html += '<div style="position:absolute;top:26%;right:3.5%;height:48%;display:flex;flex-direction:column;justify-content:space-between;">';
  for (var i = 0; i < st.maxLines; i++) {
    if (SLOT_LEFT_LINES.indexOf(i+1) < 0) {
      html += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:18px;height:12px;border-radius:8px;background:' + SLOT_LINE_COLORS[i] + ';color:#fff;font-size:6px;font-weight:700;text-align:center;line-height:12px;cursor:pointer;opacity:' + (i < st.activeLines ? '1' : '0.4') + ';">' + (i+1) + '</div>';
    }
  }
  html += '</div>';

  html += '</div>'; // end slotSkin

  gameArea.innerHTML = html;
  document.getElementById('playBottomText').textContent = 'Connected | Balance: ' + balance.toLocaleString() + ' ' + st.displaySymbol;
  slotUpdateJackpot();
}

function slotCalcJackpot() {
  var pool = window._playJackpotPool || 0;
  var baseUnit = window._playJackpotBaseUnit || 1;
  var rates = window._playJackpotRates || [];
  var idx = Math.min(_slotState.betIndex, rates.length - 1);
  if (idx < 0 || rates.length === 0) return 0;
  return pool * baseUnit * (rates[idx] || 0);
}
function slotUpdateJackpot() {
  var jp = slotCalcJackpot();
  var el = document.getElementById('slotJackpotDisplay');
  if (!el) return;
  if (jp <= 0) { el.innerHTML = '<span style="color:#888;">\uD83D\uDD12 JP: 0.00</span>'; }
  else { el.innerHTML = '\uD83C\uDFC6 JP: ' + jp.toFixed(_slotState.displayPrecision); el.style.color = '#f39c12'; }
}

function slotToggleLine(lineIdx) {
  if (_slotState.visibleLines[lineIdx]) { delete _slotState.visibleLines[lineIdx]; slotClearLineSvg(lineIdx); }
  else { _slotState.visibleLines[lineIdx] = true; slotDrawLine(lineIdx); }
}
function slotDrawLine(lineIdx) {
  var st = _slotState;
  if (lineIdx >= st.lines.length) return;
  var line = st.lines[lineIdx];
  var svg = document.getElementById('slotLineSvg');
  var container = document.getElementById('slotReelsContainer');
  if (!svg || !container) return;
  var w = container.offsetWidth;
  var h = container.offsetHeight;
  var colW = w / st.colCount;
  var rowH = h / st.rowCount;
  var points = [];
  for (var i = 0; i < line.length; i++) {
    var pos = line[i];
    var col = pos % st.colCount;
    var row = Math.floor(pos / st.colCount);
    var cx = col * colW + colW / 2;
    var cy = row * rowH + rowH / 2;
    points.push(cx + ',' + cy);
  }
  var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', points.join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', SLOT_LINE_COLORS[lineIdx]);
  polyline.setAttribute('stroke-width', '3');
  polyline.setAttribute('stroke-opacity', '0.8');
  polyline.setAttribute('data-line', lineIdx);
  svg.appendChild(polyline);
}
function slotClearLineSvg(lineIdx) {
  var svg = document.getElementById('slotLineSvg');
  if (!svg) return;
  var el = svg.querySelector('[data-line="' + lineIdx + '"]');
  if (el) el.remove();
}
function slotClearAllLines() {
  var svg = document.getElementById('slotLineSvg');
  if (svg) svg.innerHTML = '';
  _slotState.visibleLines = {};
}

function slotChangeBet(dir) {
  var st = _slotState; if (st.spinning) return;
  st.betIndex = Math.max(0, Math.min(st.betList.length - 1, st.betIndex + dir));
  var total = (st.betList[st.betIndex] || 0) * st.activeLines;
  document.getElementById('slotBetDisplay').textContent = total.toFixed(st.displayPrecision);
  slotUpdateJackpot();
}
function slotMaxBet() {
  var st = _slotState; if (st.spinning) return;
  st.betIndex = st.betList.length - 1;
  var total = (st.betList[st.betIndex] || 0) * st.activeLines;
  document.getElementById('slotBetDisplay').textContent = total.toFixed(st.displayPrecision);
  slotUpdateJackpot();
}
function slotChangeLines(dir) {
  var st = _slotState; if (st.spinning) return;
  st.activeLines = Math.max(1, Math.min(st.maxLines, st.activeLines + dir));
  document.getElementById('slotLinesDisplay').textContent = st.activeLines;
  var total = (st.betList[st.betIndex] || 0) * st.activeLines;
  document.getElementById('slotBetDisplay').textContent = total.toFixed(st.displayPrecision);
  document.querySelectorAll('.slot-line-num').forEach(function(el) {
    el.style.opacity = parseInt(el.getAttribute('data-line')) < st.activeLines ? '1' : '0.3';
  });
}
function slotShowInfo() {
  var st = _slotState; var resp = st.loginResp;
  var mathModel = (st.config && st.config.math_model && st.config.math_model[0]) || {};
  var info = '\uD83C\uDFB0 Game Info\n\nID: ' + (resp.game_id||st.machineId) + '\nName: ' + st.machineName;
  info += '\nRTP: ' + (st.config.rtp_range || 'N/A') + '\nLines: ' + st.maxLines;
  info += '\nReels: ' + st.rowCount + 'x' + st.colCount + '\nIcons: ' + st.icons.length;
  info += '\nPatterns: ' + ((mathModel.pattern||[]).length);
  showAlert(info);
}

// Smooth reel spin animation
function slotSpin() {
  var st = _slotState;
  if (st.spinning) return;
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { showAlert('WebSocket not connected'); return; }
  st.spinning = true;
  var btn = document.getElementById('slotSpinBtn');
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
  document.getElementById('slotWinDisplay').textContent = '';
  slotClearAllLines();

  // Start reel spin animation (visual only, will stop when response arrives)
  slotStartReelAnimation();

  var bet = st.betList[st.betIndex] || 0.01;
  var linesStr = '';
  for (var i = 0; i < st.maxLines; i++) linesStr += (i < st.activeLines ? '1' : '0');
  var spinCmd = {
    cmd: 'solicitajogada', session_token: st.sessionToken,
    game_id: st.machineId, currency: st.currency,
    opt_id: st.loginResp.opt_id || '', username: st.loginResp.username || '',
    aposta: bet, lines: linesStr, bonus_unique_id: '', is_bonus: false,
    icons: [], target_pattern_ids: [], target_feature_ids: [],
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [SLOT SPIN] send: ' + JSON.stringify(spinCmd));
  _playWs.send(JSON.stringify(spinCmd));
}

var _slotReelTimers = [];
var _slotReelStopping = false;

function slotStartReelAnimation() {
  var st = _slotState;
  _slotReelStopping = false;
  var icons = st.icons.length ? st.icons : [1,2,3,4,5,6,7,8,9,10];

  for (var col = 0; col < st.colCount; col++) {
    (function(c) {
      var reelEl = document.querySelector('.slot-reel[data-col="' + c + '"]');
      if (!reelEl) return;
      var timer = setInterval(function() {
        // Shuffle cell icons randomly to simulate spinning
        var cells = reelEl.querySelectorAll('.slot-cell');
        cells.forEach(function(cell) {
          var randIcon = icons[Math.floor(Math.random() * icons.length)];
          var img = cell.querySelector('img');
          if (img) img.src = '/static/machine/' + st.machineName + '/icon/i' + randIcon + '.png';
        });
      }, 80 + c * 20); // Stagger slightly per reel
      _slotReelTimers.push({col: c, timer: timer, el: reelEl});
    })(col);
  }
}

function slotStopReelAnimation(onComplete) {
  var st = _slotState;
  _slotReelStopping = true;
  var stoppedCount = 0;
  var totalReels = _slotReelTimers.length;
  if (totalReels === 0) { if (onComplete) onComplete(); return; }

  _slotReelTimers.forEach(function(rt, idx) {
    setTimeout(function() {
      clearInterval(rt.timer);
      // Set final icons for this column
      var cells = rt.el.querySelectorAll('.slot-cell');
      for (var row = 0; row < st.rowCount && row < cells.length; row++) {
        var iconIdx = row * st.colCount + rt.col;
        var iconId = st.reelIcons[iconIdx] || 1;
        var img = cells[row].querySelector('img');
        if (img) img.src = '/static/machine/' + st.machineName + '/icon/i' + iconId + '.png';
        else cells[row].innerHTML = '<img src="/static/machine/' + st.machineName + '/icon/i' + iconId + '.png" style="width:90%;height:90%;object-fit:contain;">';
      }
      stoppedCount++;
      if (stoppedCount >= totalReels && onComplete) onComplete();
    }, idx * 300);
  });
  _slotReelTimers = [];
}

function slotHandleSpinResponse(resp) {
  var st = _slotState;
  playLog('<<< [SLOT SPIN] icons: ' + JSON.stringify(resp.icons) + ', won: ' + resp.total_won);
  if (resp.balance !== undefined) slotUpdateBalance(resp.balance);
  if (resp.features) slotUpdateJackpotFromFeatures(resp.features);
  if (resp.icons && resp.icons.length >= st.rowCount * st.colCount) {
    st.reelIcons = resp.icons.slice();
  }
  // Stop animation with final icons
  slotStopReelAnimation(function() {
    if (resp.total_won > 0) {
      document.getElementById('slotWinDisplay').innerHTML = '<span style="color:#f39c12;font-size:18px;">\uD83C\uDF89 WIN: ' + resp.total_won.toFixed(st.displayPrecision) + '</span>';
      slotShowWinningLines(resp);
    }
    slotRoundOver();
  });
}

function slotShowWinningLines(resp) {
  var st = _slotState;
  if (!resp.total_won || resp.total_won <= 0) return;
  for (var i = 0; i < st.activeLines && i < st.lines.length; i++) {
    st.visibleLines[i] = true;
    slotDrawLine(i);
  }
}

function slotRoundOver() {
  var st = _slotState;
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { st.spinning = false; slotEnableSpinBtn(); return; }
  var roCmd = {
    cmd: 'finalizajogada', session_token: st.sessionToken,
    game_id: st.machineId, currency: st.currency,
    opt_id: st.loginResp.opt_id || '', username: st.loginResp.username || '',
    bonus_unique_id: '', is_bonus: false, finalizar: true,
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [SLOT ROUND OVER] send: ' + JSON.stringify(roCmd));
  _playWs.send(JSON.stringify(roCmd));
}

function slotHandleRoundOverResponse(resp) {
  var st = _slotState;
  if (resp.balance !== undefined) slotUpdateBalance(resp.balance);
  if (resp.total_won !== undefined && resp.total_won > 0) {
    document.getElementById('slotWinDisplay').innerHTML = '<span style="color:#f39c12;font-size:18px;">\uD83C\uDF89 WIN: ' + resp.total_won.toFixed(st.displayPrecision) + '</span>';
  }
  st.spinning = false;
  slotEnableSpinBtn();
}

function slotEnableSpinBtn() {
  var btn = document.getElementById('slotSpinBtn');
  if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
}

function slotUpdateBalance(newBalance) {
  var st = _slotState;
  var el = document.getElementById('slotBalance');
  if (el) el.textContent = '\uD83D\uDCB0 ' + newBalance.toLocaleString() + ' ' + st.displaySymbol;
  document.getElementById('playBottomText').textContent = 'Balance: ' + newBalance.toLocaleString() + ' ' + st.displaySymbol;
}

function slotUpdateJackpotFromFeatures(features) {
  if (!features || !features.length) return;
  try {
    var feat = JSON.parse(features[0]);
    if (feat.jackpot && feat.jackpot[0] && feat.jackpot[0].jackpot_pool_item) {
      var poolItem = JSON.parse(feat.jackpot[0].jackpot_pool_item);
      window._playJackpotPool = parseFloat(poolItem.jackpotPool) || 0;
      slotUpdateJackpot();
    }
  } catch(e) {}
}

function slotShowPattern() {
  var st = _slotState;
  var patPath = '/static/machine/' + st.machineName + '/background/pattern/' + st.machineName + '.png';
  // Show pattern image in a modal overlay
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.onclick = function() { overlay.remove(); };
  overlay.innerHTML = '<img src="' + patPath + '" style="max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.8);">';
  document.body.appendChild(overlay);
}
