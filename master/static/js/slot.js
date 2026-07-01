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

  // Check for plugin asset overrides
  var plugin = MachineRegistry.get(st.machineName);
  var pluginAssets = (plugin && plugin.assets) || {};
  var bgPath = pluginAssets.background || ('/static/machine/' + st.machineName + '/background/' + st.machineName + '.png');

  var html = '';
  // Full background container
  html += '<div id="slotSkin" style="position:relative;width:480px;margin:0 auto;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6);min-height:600px;background:#1a1a2e;">';
  html += '<img src="' + bgPath + '" style="width:100%;display:block;" onerror="this.style.display=\'none\'">';

  // Pattern area (top) - clickable
  html += '<div onclick="slotShowPattern()" style="position:absolute;top:0;left:0;width:100%;height:9%;cursor:pointer;" title="View patterns"></div>';

  // Balance (inside left dark box - lower position)
  html += '<div id="slotBalance" style="position:absolute;top:18.2%;left:8%;width:38%;height:3.5%;display:flex;align-items:center;padding-left:8px;font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000;">\uD83D\uDCB0 ' + balance.toLocaleString() + ' ' + st.displaySymbol + '</div>';

  // Jackpot (inside right dark box - lower position)
  html += '<div id="slotJackpotDisplay" style="position:absolute;top:18.2%;right:15%;width:38%;height:3.5%;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-size:15px;font-weight:700;color:#f5d742;text-shadow:0 1px 2px #000;">\uD83C\uDFC6 ' + slotCalcJackpot().toFixed(st.displayPrecision) + '</div>';

  // Reels area - vertical strip approach (icons packed with 0 gap)
  var cellHeight = 80; // height per icon
  var visibleRows = st.rowCount; // 3 rows visible
  var stripLength = 20; // total icons per reel strip
  var resultPosition = 14; // where final 3 icons sit in the strip (index 14,15,16)

  html += '<div id="slotReelsContainer" style="position:absolute;top:20%;left:17%;width:66%;height:52%;overflow:hidden;display:flex;gap:2px;align-items:center;">';
  var containerH = cellHeight * visibleRows; // visible window height

  for (var col = 0; col < st.colCount; col++) {
    var marginL = 0, marginR = 0;
    if (col === 0) marginL = 4;
    if (col === st.colCount - 1) marginR = 4;
    if (col === st.colCount - 2) marginR = 2;

    // Build strip: random icons filling, with result icons at position resultPosition
    var icons = st.icons.length ? st.icons : [1,2,3,4,5,6,7,8,9,10];
    var stripIcons = [];
    for (var s = 0; s < stripLength; s++) {
      if (s >= resultPosition && s < resultPosition + visibleRows) {
        // Final result icons
        var idx = (s - resultPosition) * st.colCount + col;
        stripIcons.push((st.reelIcons[idx] !== undefined && st.reelIcons[idx] !== null) ? st.reelIcons[idx] : 1);
      } else {
        stripIcons.push(icons[Math.floor(Math.random() * icons.length)]);
      }
    }

    html += '<div class="slot-reel-wrapper" data-col="' + col + '" style="flex:1;height:' + containerH + 'px;overflow:hidden;margin-left:' + marginL + '%;margin-right:' + marginR + '%;position:relative;perspective:800px;border:2px solid #1a1a1a;border-radius:4px;box-shadow:inset 0 4px 8px rgba(0,0,0,0.7),inset 0 -2px 4px rgba(0,0,0,0.4),0 1px 0 rgba(255,255,255,0.05);">';
    html += '<div class="slot-reel-strip" data-col="' + col + '" style="display:flex;flex-direction:column;position:absolute;top:0;left:0;width:100%;will-change:transform;transform-style:preserve-3d;">';
    for (var s = 0; s < stripLength; s++) {
      html += '<div style="width:100%;height:' + cellHeight + 'px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
      html += '<img src="/static/machine/' + st.machineName + '/icon/i' + stripIcons[s] + '.png" style="width:100%;height:100%;object-fit:fill;" onerror="this.style.opacity=0">';
      html += '</div>';
    }
    html += '</div>'; // end strip
    // Curved shading overlay: darkens top/bottom edges to simulate cylinder curvature
    html += '<div style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.1) 20%,transparent 35%,transparent 65%,rgba(0,0,0,0.1) 80%,rgba(0,0,0,0.45) 100%);z-index:2;"></div>';
    html += '</div>'; // end wrapper
  }
  html += '<svg id="slotLineSvg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></svg>';
  html += '</div>';

  // Win display (centered over reels area where coins appear)
  html += '<div id="slotWinDisplay" style="position:absolute;top:45%;left:17%;width:66%;text-align:center;font-size:20px;font-weight:800;color:#f5d742;text-shadow:0 0 10px #f5d742,0 2px 4px #000;z-index:50;pointer-events:none;"></div>';

  // BET controls (left box area ~80% top, ~7% left)
  html += '<div style="position:absolute;top:80.5%;left:7%;display:flex;align-items:center;gap:3px;">';
  html += '<div class="slot-btn-3d" onclick="slotChangeBet(-1)" style="width:28px;height:28px;">-</div>';
  var betVal = (st.betList[st.betIndex] || 0) * st.activeLines;
  html += '<div id="slotBetDisplay" style="min-width:52px;height:28px;background:#0a0a0a;border:2px solid #f5d742;border-radius:4px;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:28px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.8);">' + betVal.toFixed(st.displayPrecision) + '</div>';
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

  // COLLECT button (shown when round_is_over=false)
  var showCollect = resp.round_is_over === false;
  html += '<div id="slotCollectBtn" class="slot-btn-3d" onclick="slotCollectRound()" style="position:absolute;top:78%;right:24%;width:52px;height:36px;font-size:9px;display:' + (showCollect ? 'flex' : 'none') + ';">COLLECT</div>';

  // WIN display (after BET/LINE controls)
  html += '<div id="slotWinLabel" style="position:absolute;top:81%;left:60%;font-size:11px;font-weight:700;color:#f5d742;text-shadow:0 1px 2px #000;">WIN: <span id="slotWinAmount">0.00</span></div>';

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
  slotSpinToolInit();
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
  var displayBet = (st.betList[st.betIndex] || 0) * st.activeLines;
  document.getElementById('slotBetDisplay').textContent = displayBet.toFixed(st.displayPrecision);
  slotUpdateJackpot();
}
function slotMaxBet() {
  var st = _slotState; if (st.spinning) return;
  st.betIndex = st.betList.length - 1;
  var displayBet = (st.betList[st.betIndex] || 0) * st.activeLines;
  document.getElementById('slotBetDisplay').textContent = displayBet.toFixed(st.displayPrecision);
  slotUpdateJackpot();
}
function slotChangeLines(dir) {
  var st = _slotState; if (st.spinning) return;
  st.activeLines = Math.max(1, Math.min(st.maxLines, st.activeLines + dir));
  document.getElementById('slotLinesDisplay').textContent = st.activeLines;
  var displayBet = (st.betList[st.betIndex] || 0) * st.activeLines;
  document.getElementById('slotBetDisplay').textContent = displayBet.toFixed(st.displayPrecision);
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
  var winAmtEl = document.getElementById('slotWinAmount');
  if (winAmtEl) winAmtEl.textContent = '0.00';
  slotClearAllLines();

  // Client-side: deduct total bet from displayed balance immediately
  var bet = st.betList[st.betIndex] || 0.01;
  var totalBet = bet * st.activeLines;
  var balEl = document.getElementById('slotBalance');
  if (balEl) {
    var curBal = parseFloat(balEl.textContent.replace(/[^\d.-]/g, '')) || 0;
    slotUpdateBalance(curBal - totalBet, false);
  }

  // Start reel spin animation (visual only, will stop when response arrives)
  slotStartReelAnimation();

  var linesStr = '';
  for (var i = 0; i < st.maxLines; i++) linesStr += (i < st.activeLines ? '1' : '0');

  // Get spin tool overrides
  var toolOverrides = slotSpinToolGetOverrides();

  var spinCmd = {
    cmd: 'solicitajogada', session_token: st.sessionToken,
    game_id: st.machineId, currency: st.currency,
    opt_id: st.loginResp.opt_id || '', username: st.loginResp.username || '',
    aposta: bet, lines: linesStr, bonus_unique_id: '', is_bonus: false,
    icons: toolOverrides.icons || [],
    target_pattern_ids: toolOverrides.targetPatternIds || [],
    target_feature_ids: toolOverrides.targetFeatureIds || [],
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
  _slotReelTimers = [];
  var cellHeight = 80;
  var icons = st.icons.length ? st.icons : [1,2,3,4,5,6,7,8,9,10];

  for (var col = 0; col < st.colCount; col++) {
    (function(c) {
      var strip = document.querySelector('.slot-reel-strip[data-col="' + c + '"]');
      if (!strip) return;
      strip.style.transition = 'none';
      // Start scrolling from top
      var offset = 0;
      var speed = 15 + c * 4; // px per frame, stagger per reel
      var totalH = strip.children.length * cellHeight;
      var loopPoint = totalH - cellHeight * st.rowCount;

      var timer = setInterval(function() {
        offset += speed;
        if (offset >= loopPoint) {
          offset = 0;
          // Re-randomize the non-result icons while scrolling
          var imgs = strip.querySelectorAll('img');
          for (var i = 0; i < imgs.length - st.rowCount; i++) {
            var ri = icons[Math.floor(Math.random() * icons.length)];
            imgs[i].style.opacity = '1';
            imgs[i].src = '/static/machine/' + st.machineName + '/icon/i' + ri + '.png';
          }
        }
        strip.style.transform = 'translateY(-' + offset + 'px)';
      }, 16);

      _slotReelTimers.push({col: c, timer: timer, strip: strip});
    })(col);
  }
}

function slotStopReelAnimation(onComplete) {
  var st = _slotState;
  _slotReelStopping = true;
  var stoppedCount = 0;
  var totalReels = _slotReelTimers.length;
  if (totalReels === 0) { if (onComplete) onComplete(); return; }

  var cellHeight = 80;
  var resultPosition = 14; // must match the value in slotRenderUI
  var icons = st.icons.length ? st.icons : [1,2,3,4,5,6,7,8,9,10];
  var targetOffset = resultPosition * cellHeight; // scroll to show result icons

  _slotReelTimers.forEach(function(rt, idx) {
    setTimeout(function() {
      clearInterval(rt.timer);
      var strip = rt.strip;

      // Update the result icons in the strip (positions resultPosition, +1, +2)
      var allCells = strip.children;
      for (var row = 0; row < st.rowCount; row++) {
        var cellIdx = resultPosition + row;
        if (cellIdx < allCells.length) {
          var iconIdx = row * st.colCount + rt.col;
          var iconId = (st.reelIcons[iconIdx] !== undefined && st.reelIcons[iconIdx] !== null) ? st.reelIcons[iconIdx] : 1;
          var img = allCells[cellIdx].querySelector('img');
          if (img) { img.style.opacity = '1'; img.src = '/static/machine/' + st.machineName + '/icon/i' + iconId + '.png'; }
        }
      }

      // Smooth deceleration to target position
      strip.style.transition = 'transform 0.6s cubic-bezier(0.1, 0.7, 0.3, 1)';
      strip.style.transform = 'translateY(-' + targetOffset + 'px)';

      stoppedCount++;
      if (stoppedCount >= totalReels) {
        setTimeout(function() { if (onComplete) onComplete(); }, 700);
      }
    }, idx * 300);
  });
  _slotReelTimers = [];
}

function slotHandleSpinResponse(resp) {
  var st = _slotState;
  playLog('<<< [SLOT SPIN] icons: ' + JSON.stringify(resp.icons) + ', won: ' + resp.total_won);
  // Don't update balance yet if won > 0 (wait for animation)
  if (resp.total_won <= 0 && resp.balance !== undefined) slotUpdateBalance(resp.balance, false);
  if (resp.features) slotUpdateJackpotFromFeatures(resp.features);
  if (resp.icons && resp.icons.length >= st.rowCount * st.colCount) {
    st.reelIcons = resp.icons.slice();
  }
  // Stop animation with final icons
  slotStopReelAnimation(function() {
    if (resp.total_won > 0) {
      slotShowWinAnimation(resp.total_won);
      slotShowWinningLines(resp);
      // Start balance animation immediately (coins are flying)
      if (resp.balance !== undefined) slotUpdateBalance(resp.balance);
    }
    slotRoundOver();
  });
}

function slotShowWinningLines(resp) {
  var st = _slotState;
  if (!resp.total_won || resp.total_won <= 0) return;

  // Parse won_pattern to extract winning line numbers
  // Format: "[l1,i1i1i1i1i-1];[l5,i2i2i2i2i2];" etc.
  var wonPattern = resp.won_pattern || '';
  var wonLines = [];
  var matches = wonPattern.match(/l(\d+)/g);
  if (matches) {
    for (var i = 0; i < matches.length; i++) {
      var lineNum = parseInt(matches[i].substring(1)) - 1; // convert 1-based to 0-based
      if (lineNum >= 0 && wonLines.indexOf(lineNum) < 0) {
        wonLines.push(lineNum);
      }
    }
  }

  // If we parsed specific lines, only show those; otherwise fallback to all active
  if (wonLines.length > 0) {
    for (var i = 0; i < wonLines.length; i++) {
      var lineIdx = wonLines[i];
      if (lineIdx < st.lines.length) {
        st.visibleLines[lineIdx] = true;
        slotDrawLine(lineIdx);
      }
    }
  } else {
    // Fallback: show all active lines
    for (var i = 0; i < st.activeLines && i < st.lines.length; i++) {
      st.visibleLines[i] = true;
      slotDrawLine(i);
    }
  }
}

function slotRoundOver() {
  // If a bonus/feature is pending, defer round over
  if (_playBonusPending) return;
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
  if (resp.total_won !== undefined && resp.total_won > 0) {
    slotShowWinAnimation(resp.total_won);
    // Start balance animation immediately (coins are flying)
    if (resp.balance !== undefined) slotUpdateBalance(resp.balance);
    // Enable spin after animation finishes
    setTimeout(function() {
      st.spinning = false;
      slotEnableSpinBtn();
    }, 5000);
  } else {
    if (resp.balance !== undefined) slotUpdateBalance(resp.balance, false);
    st.spinning = false;
    slotEnableSpinBtn();
  }
}

function slotEnableSpinBtn() {
  var btn = document.getElementById('slotSpinBtn');
  if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
}

var _slotBalanceTimer = null;

function slotUpdateBalance(newBalance, animate) {
  var st = _slotState;
  var el = document.getElementById('slotBalance');
  if (!el) return;

  // Get current displayed balance
  var curText = el.textContent.replace(/[^\d.-]/g, '');
  var curBal = parseFloat(curText) || 0;
  var diff = newBalance - curBal;

  // If difference is negligible or animate=false, just set directly
  if (Math.abs(diff) < 0.005 || animate === false) {
    el.textContent = '\uD83D\uDCB0 ' + newBalance.toLocaleString(undefined, {minimumFractionDigits: st.displayPrecision, maximumFractionDigits: st.displayPrecision}) + ' ' + st.displaySymbol;
    document.getElementById('playBottomText').textContent = 'Balance: ' + newBalance.toLocaleString() + ' ' + st.displaySymbol;
    return;
  }

  // Animate: increment by 0.01 steps over ~2 seconds
  if (_slotBalanceTimer) clearInterval(_slotBalanceTimer);
  var step = 0.01 * (diff > 0 ? 1 : -1);
  var steps = Math.abs(Math.round(diff / 0.01));
  var interval = Math.max(10, Math.min(50, 2000 / steps)); // 2s total, min 10ms per tick
  var current = curBal;

  _slotBalanceTimer = setInterval(function() {
    current += step;
    // Check if we've reached or passed the target
    if ((step > 0 && current >= newBalance) || (step < 0 && current <= newBalance)) {
      current = newBalance;
      clearInterval(_slotBalanceTimer);
      _slotBalanceTimer = null;
    }
    el.textContent = '\uD83D\uDCB0 ' + current.toLocaleString(undefined, {minimumFractionDigits: st.displayPrecision, maximumFractionDigits: st.displayPrecision}) + ' ' + st.displaySymbol;
    document.getElementById('playBottomText').textContent = 'Balance: ' + current.toLocaleString() + ' ' + st.displaySymbol;
  }, interval);
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
  var plugin = MachineRegistry.get(st.machineName);
  var pluginAssets = (plugin && plugin.assets) || {};
  var patPath = pluginAssets.pattern || ('/static/machine/' + st.machineName + '/background/pattern/' + st.machineName + '.png');
  // Show pattern image in a modal overlay
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.onclick = function() { overlay.remove(); };
  overlay.innerHTML = '<img src="' + patPath + '" style="max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.8);">';
  document.body.appendChild(overlay);
}

function slotShowWinAnimation(amount) {
  var st = _slotState;
  var winEl = document.getElementById('slotWinDisplay');
  if (winEl) {
    winEl.innerHTML = '<span class="slot-win-text" style="color:#f39c12;font-size:20px;font-weight:800;text-shadow:0 0 10px #f5d742,0 0 20px #f39c12;animation:slotWinPulse 0.5s ease-in-out 5;">\uD83C\uDF89 WIN: ' + amount.toFixed(st.displayPrecision) + '</span>';
  // Also update the static WIN label
  var winAmtEl = document.getElementById('slotWinAmount');
  if (winAmtEl) winAmtEl.textContent = amount.toFixed(st.displayPrecision);
  }

  // Spawn coins from reels area flying to balance
  var skin = document.getElementById('slotSkin');
  if (!skin) return;
  var balEl = document.getElementById('slotBalance');
  var skinRect = skin.getBoundingClientRect();
  var balRect = balEl ? balEl.getBoundingClientRect() : {left: skinRect.left + 50, top: skinRect.top + 50};

  var coinCount = Math.min(Math.max(8, Math.floor(amount)), 20);
  for (var i = 0; i < coinCount; i++) {
    (function(idx) {
      setTimeout(function() {
        var coin = document.createElement('div');
        coin.className = 'slot-coin-fly';
        // Start from random position in reels area
        var startX = 80 + Math.random() * 300;
        var startY = 200 + Math.random() * 200;
        // End at balance position (relative to skin)
        var endX = balRect.left - skinRect.left + 30;
        var endY = balRect.top - skinRect.top + 10;
        coin.style.cssText = 'position:absolute;left:' + startX + 'px;top:' + startY + 'px;width:36px;height:36px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffe066,#f5a623,#c87800);border:3px solid #f5d742;box-shadow:0 3px 8px rgba(0,0,0,0.5),inset 0 -3px 4px rgba(0,0,0,0.3),0 0 12px rgba(245,166,35,0.4);z-index:100;font-size:16px;text-align:center;line-height:36px;color:#7a5000;font-weight:700;pointer-events:none;';
        coin.textContent = '$';
        skin.appendChild(coin);

        // Animate: rise up, then fly to balance
        var keyframes = [
          {transform: 'translateY(0) scale(1) rotateY(0deg)', opacity: 1},
          {transform: 'translateY(-40px) scale(1.3) rotateY(180deg)', opacity: 1, offset: 0.3},
          {transform: 'translate(' + (endX - startX) + 'px,' + (endY - startY) + 'px) scale(0.5) rotateY(720deg)', opacity: 0.6}
        ];
        var anim = coin.animate(keyframes, {duration: 1500 + Math.random() * 500, easing: 'cubic-bezier(0.2,0.8,0.3,1)', fill: 'forwards'});
        anim.onfinish = function() { coin.remove(); };
      }, idx * 200);
    })(i);
  }

  // Clear win text after 5 seconds
  setTimeout(function() {
    var el = document.getElementById('slotWinDisplay');
    if (el) el.innerHTML = '';
  }, 5000);
}

function slotCollectRound() {
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { showAlert('Not connected'); return; }
  var st = _slotState;
  var roCmd = {
    cmd: 'finalizajogada', session_token: st.sessionToken,
    game_id: st.machineId, currency: st.currency,
    opt_id: st.loginResp.opt_id || '', username: st.loginResp.username || '',
    bonus_unique_id: '', is_bonus: false, finalizar: true,
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [SLOT COLLECT ROUND] send: ' + JSON.stringify(roCmd));
  _playWs.send(JSON.stringify(roCmd));
  var btn = document.getElementById('slotCollectBtn');
  if (btn) btn.style.display = 'none';
}


// ===========================================================================
// Slot Spin Tool (admin/qa sidebar)
// ===========================================================================
var _slotSpinTool = {
  enabled: false,
  targetPatternIds: [],
  targetFeatureIds: [],
  targetIcons: [],
  mode: null // 'pattern' | 'feature' | 'icons'
};

function slotSpinToolInit() {
  var st = _slotState;
  var role = (st.loginResp && st.loginResp.role) || '';
  if (role !== 'admin' && role !== 'qa') return;
  _slotSpinTool.enabled = true;
  _slotSpinTool.targetPatternIds = [];
  _slotSpinTool.targetFeatureIds = [];
  _slotSpinTool.targetIcons = [];
  _slotSpinTool.mode = null;

  var mathModel = (st.config && st.config.math_model && st.config.math_model[0]) || {};
  _slotSpinTool.patterns = mathModel.pattern || [];
  _slotSpinTool.features = (mathModel.features && mathModel.features.lists) || [];
  _slotSpinTool.icons = mathModel.icon || st.icons || [];
  _slotSpinTool.rowCount = st.rowCount;
  _slotSpinTool.colCount = st.colCount;

  slotSpinToolRender();
}

function slotSpinToolRender() {
  var old = document.getElementById('slotSpinTool');
  if (old) old.remove();

  var gameArea = document.getElementById('playGameArea');
  if (!gameArea) return;

  var panel = document.createElement('div');
  panel.id = 'slotSpinTool';
  panel.style.cssText = 'position:absolute;top:280px;left:0;z-index:200;';

  panel.innerHTML = '<div id="slotSpinToolTab" onclick="slotSpinToolToggle()" style="background:#1a1a2e;border:1px solid #f5d742;border-left:none;border-radius:0 8px 8px 0;padding:8px 6px;cursor:pointer;color:#f5d742;font-size:10px;font-weight:700;writing-mode:vertical-rl;text-orientation:mixed;">🔧 TOOL</div>' +
    '<div id="slotSpinToolPanel" style="display:none;position:absolute;top:0;left:30px;background:#1a1a2e;border:1px solid #f5d742;border-radius:0 8px 8px 0;padding:12px;width:220px;max-height:400px;overflow-y:auto;">' +
    '<div style="color:#fff;font-size:11px;font-weight:700;margin-bottom:8px;">🔧 Slot Spin Tool</div>' +
    '<div id="sstItemPattern" class="bst-item" onclick="slotSpinToolChoosePattern()" style="padding:6px 8px;margin-bottom:4px;background:#2a2a4e;border-radius:4px;cursor:pointer;color:#ccc;font-size:10px;">📌 Choose Pattern</div>' +
    '<div id="sstPatternList" style="display:none;padding-left:8px;max-height:180px;overflow-y:auto;"></div>' +
    '<div id="sstItemFeature" class="bst-item" onclick="slotSpinToolChooseFeature()" style="padding:6px 8px;margin-bottom:4px;background:#2a2a4e;border-radius:4px;cursor:pointer;color:#ccc;font-size:10px;">⚡ Choose Feature</div>' +
    '<div id="sstFeatureList" style="display:none;padding-left:8px;"></div>' +
    '<div id="sstItemIcons" class="bst-item" onclick="slotSpinToolChooseIcons()" style="padding:6px 8px;margin-bottom:4px;background:#2a2a4e;border-radius:4px;cursor:pointer;color:#ccc;font-size:10px;">🎰 Choose Icons</div>' +
    '<div id="sstStatus" style="margin-top:8px;font-size:9px;color:#888;border-top:1px solid #333;padding-top:6px;"></div>' +
    '<div onclick="slotSpinToolClear()" style="margin-top:6px;padding:4px 8px;background:#e74c3c;border-radius:4px;cursor:pointer;color:#fff;font-size:9px;text-align:center;">Clear All</div>' +
    '</div>';

  gameArea.style.position = 'relative';
  gameArea.appendChild(panel);
  slotSpinToolUpdateStatus();
}

function slotSpinToolToggle() {
  var panel = document.getElementById('slotSpinToolPanel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function slotSpinToolChoosePattern() {
  // Mutual exclusion
  _slotSpinTool.targetFeatureIds = [];
  _slotSpinTool.targetIcons = [];
  var featList = document.getElementById('sstFeatureList');
  if (featList) featList.style.display = 'none';

  var listEl = document.getElementById('sstPatternList');
  if (!listEl) return;
  if (listEl.style.display !== 'none') { listEl.style.display = 'none'; return; }

  var patterns = _slotSpinTool.patterns;
  var machineName = _slotState.machineName;
  var html = '';
  patterns.forEach(function(p) {
    var selected = _slotSpinTool.targetPatternIds.indexOf(p.id) >= 0;
    // Parse format string: e.g. "i1i1i1i1i-1" -> [{icon:'i1'},{icon:'i1'},...,{icon:'i-1',wild:true}]
    var formatIcons = slotSpinToolParseFormat(p.format || '');

    html += '<div onclick="slotSpinToolSelectPattern(' + p.id + ',this)" style="padding:4px 6px;margin:3px 0;background:' + (selected ? '#f5d742' : '#333') + ';color:' + (selected ? '#000' : '#ccc') + ';border-radius:4px;cursor:pointer;font-size:9px;">';
    // Line 1: id, name, alias, value
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">';
    html += '<span>' + (p.alias || '') + ' <span style="opacity:0.7;">' + (p.name || '') + '</span> id:' + p.id + '</span>';
    html += '<span style="font-weight:700;">x' + p.value + '</span>';
    html += '</div>';
    // Line 2: icon images from format
    html += '<div style="display:flex;gap:2px;align-items:center;">';
    formatIcons.forEach(function(fi) {
      if (fi.wild) {
        // Empty/wild position
        html += '<div style="width:20px;height:20px;border:1px dashed #666;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:7px;color:#666;">?</div>';
      } else {
        html += '<img src="/static/machine/' + machineName + '/icon/' + fi.icon + '.png" style="width:20px;height:20px;object-fit:contain;border-radius:2px;background:#222;" onerror="this.outerHTML=\'<span style=color:#aaa;font-size:7px;width:20px;display:inline-block;text-align:center>' + fi.icon + '</span>\'">';
      }
    });
    html += '</div>';
    html += '</div>';
  });
  listEl.innerHTML = html;
  listEl.style.display = '';
  slotSpinToolUpdateStatus();
}

/**
 * Parse a slot pattern format string like "i1i1i1i1i-1" into icon tokens.
 * Returns array of {icon: 'i1', wild: false} or {icon: 'i-1', wild: true}
 * Wild/negative icons (i-N) mean "not this icon" = empty slot in display.
 */
function slotSpinToolParseFormat(format) {
  var result = [];
  var regex = /i-?\d+/g;
  var match;
  while ((match = regex.exec(format)) !== null) {
    var token = match[0];
    if (token.indexOf('-') >= 0) {
      result.push({ icon: token, wild: true });
    } else {
      result.push({ icon: token, wild: false });
    }
  }
  return result;
}

function slotSpinToolSelectPattern(pid, el) {
  _slotSpinTool.targetPatternIds = [pid];
  _slotSpinTool.targetFeatureIds = [];
  _slotSpinTool.targetIcons = [];
  var siblings = el.parentElement.children;
  for (var i = 0; i < siblings.length; i++) { siblings[i].style.background = '#333'; siblings[i].style.color = '#ccc'; }
  el.style.background = '#f5d742'; el.style.color = '#000';
  slotSpinToolUpdateStatus();
}

function slotSpinToolChooseFeature() {
  // Mutual exclusion
  _slotSpinTool.targetPatternIds = [];
  _slotSpinTool.targetIcons = [];
  var patList = document.getElementById('sstPatternList');
  if (patList) patList.style.display = 'none';

  var listEl = document.getElementById('sstFeatureList');
  if (!listEl) return;
  if (listEl.style.display !== 'none') { listEl.style.display = 'none'; return; }

  var features = _slotSpinTool.features;
  var html = '';
  features.forEach(function(f) {
    var ref = f.reference || '';
    if (ref.indexOf('SynchronizedMachineStatusFeature') >= 0) return;
    var name = ref.split('.').pop();
    var fid = f.config && f.config.feature_id;
    var selected = _slotSpinTool.targetFeatureIds.indexOf(fid) >= 0;
    html += '<div onclick="slotSpinToolSelectFeature(' + fid + ',this)" style="padding:3px 6px;margin:2px 0;background:' + (selected ? '#f5d742' : '#333') + ';color:' + (selected ? '#000' : '#ccc') + ';border-radius:3px;cursor:pointer;font-size:9px;">' + name + ' (id:' + fid + ')</div>';
  });
  listEl.innerHTML = html;
  listEl.style.display = '';
  slotSpinToolUpdateStatus();
}

function slotSpinToolSelectFeature(fid, el) {
  _slotSpinTool.targetFeatureIds = [fid];
  _slotSpinTool.targetPatternIds = [];
  _slotSpinTool.targetIcons = [];
  var siblings = el.parentElement.children;
  for (var i = 0; i < siblings.length; i++) { siblings[i].style.background = '#333'; siblings[i].style.color = '#ccc'; }
  el.style.background = '#f5d742'; el.style.color = '#000';
  slotSpinToolUpdateStatus();
}

function slotSpinToolChooseIcons() {
  // Mutual exclusion
  _slotSpinTool.targetPatternIds = [];
  _slotSpinTool.targetFeatureIds = [];
  _slotSpinTool.targetIcons = [];
  var patList = document.getElementById('sstPatternList');
  if (patList) patList.style.display = 'none';
  var featList = document.getElementById('sstFeatureList');
  if (featList) featList.style.display = 'none';

  // Show icon picker modal
  slotSpinToolShowIconPicker();
  slotSpinToolUpdateStatus();
}

function slotSpinToolShowIconPicker() {
  var old = document.getElementById('sstIconModal');
  if (old) old.remove();

  var st = _slotSpinTool;
  var totalNeeded = st.rowCount * st.colCount;
  var icons = st.icons;
  var machineName = _slotState.machineName;

  var modal = document.createElement('div');
  modal.id = 'sstIconModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var html = '<div style="background:#1a1a2e;border-radius:12px;padding:20px;border:2px solid #f5d742;max-width:90vw;text-align:center;">';
  html += '<div style="color:#f5d742;font-size:14px;font-weight:700;margin-bottom:6px;">🎰 Choose Icons</div>';
  html += '<div style="color:#aaa;font-size:11px;margin-bottom:12px;">Select ' + totalNeeded + ' icons (row×col = ' + st.rowCount + '×' + st.colCount + '). Click to add.</div>';

  // Icon selection grid
  html += '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px;">';
  icons.forEach(function(iconId) {
    html += '<div onclick="slotSpinToolAddIcon(' + iconId + ')" style="width:48px;height:48px;border-radius:6px;background:#2a2a4e;border:2px solid #555;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.1s;" onmouseover="this.style.borderColor=\'#f5d742\'" onmouseout="this.style.borderColor=\'#555\'">';
    html += '<img src="/static/machine/' + machineName + '/icon/i' + iconId + '.png" style="width:36px;height:36px;object-fit:contain;" onerror="this.outerHTML=\'<span style=color:#fff;font-size:14px>i' + iconId + '</span>\'">';
    html += '</div>';
  });
  html += '</div>';

  // Selected icons display
  html += '<div style="color:#aaa;font-size:10px;margin-bottom:4px;">Selected: <span id="sstIconCount">0</span>/' + totalNeeded + '</div>';
  html += '<div id="sstSelectedIcons" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;min-height:30px;padding:6px;background:#0a0a1e;border-radius:6px;margin-bottom:12px;"></div>';

  // Buttons
  html += '<div style="display:flex;gap:8px;justify-content:center;">';
  html += '<div onclick="slotSpinToolIconConfirm()" style="padding:6px 16px;background:#27ae60;border-radius:4px;cursor:pointer;color:#fff;font-size:11px;font-weight:700;">Confirm</div>';
  html += '<div onclick="slotSpinToolIconCancel()" style="padding:6px 16px;background:#e74c3c;border-radius:4px;cursor:pointer;color:#fff;font-size:11px;font-weight:700;">Cancel</div>';
  html += '<div onclick="slotSpinToolIconClear()" style="padding:6px 16px;background:#666;border-radius:4px;cursor:pointer;color:#fff;font-size:11px;font-weight:700;">Clear</div>';
  html += '</div></div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);
}

function slotSpinToolAddIcon(iconId) {
  var st = _slotSpinTool;
  var totalNeeded = st.rowCount * st.colCount;
  if (st.targetIcons.length >= totalNeeded) return;

  st.targetIcons.push(iconId);
  var machineName = _slotState.machineName;
  var container = document.getElementById('sstSelectedIcons');
  if (container) {
    container.innerHTML += '<div style="width:28px;height:28px;background:#2a2a4e;border-radius:4px;display:flex;align-items:center;justify-content:center;"><img src="/static/machine/' + machineName + '/icon/i' + iconId + '.png" style="width:22px;height:22px;object-fit:contain;" onerror="this.outerHTML=\'<span style=color:#fff;font-size:9px>i' + iconId + '</span>\'"></div>';
  }
  var countEl = document.getElementById('sstIconCount');
  if (countEl) countEl.textContent = st.targetIcons.length;
}

function slotSpinToolIconConfirm() {
  var st = _slotSpinTool;
  var totalNeeded = st.rowCount * st.colCount;
  if (st.targetIcons.length !== totalNeeded) {
    showAlert('Need exactly ' + totalNeeded + ' icons, got ' + st.targetIcons.length);
    return;
  }
  var modal = document.getElementById('sstIconModal');
  if (modal) modal.remove();
  slotSpinToolUpdateStatus();
}

function slotSpinToolIconCancel() {
  _slotSpinTool.targetIcons = [];
  var modal = document.getElementById('sstIconModal');
  if (modal) modal.remove();
  slotSpinToolUpdateStatus();
}

function slotSpinToolIconClear() {
  _slotSpinTool.targetIcons = [];
  var container = document.getElementById('sstSelectedIcons');
  if (container) container.innerHTML = '';
  var countEl = document.getElementById('sstIconCount');
  if (countEl) countEl.textContent = '0';
}

function slotSpinToolClear() {
  _slotSpinTool.targetPatternIds = [];
  _slotSpinTool.targetFeatureIds = [];
  _slotSpinTool.targetIcons = [];
  _slotSpinTool.mode = null;
  var patList = document.getElementById('sstPatternList');
  if (patList) patList.style.display = 'none';
  var featList = document.getElementById('sstFeatureList');
  if (featList) featList.style.display = 'none';
  slotSpinToolUpdateStatus();
}

function slotSpinToolUpdateStatus() {
  var st = _slotSpinTool;
  var el = document.getElementById('sstStatus');
  if (!el) return;
  var lines = [];
  if (st.targetPatternIds.length) lines.push('Pattern: [' + st.targetPatternIds.join(',') + ']');
  if (st.targetFeatureIds.length) lines.push('Feature: [' + st.targetFeatureIds.join(',') + ']');
  if (st.targetIcons.length) lines.push('Icons: [' + st.targetIcons.join(',') + '] (' + st.targetIcons.length + '/' + (st.rowCount * st.colCount) + ')');
  el.innerHTML = lines.length ? lines.join('<br>') : '<span style="color:#666;">No tool active</span>';

  // Update menu item highlights
  var patEl = document.getElementById('sstItemPattern');
  var featEl = document.getElementById('sstItemFeature');
  var iconEl = document.getElementById('sstItemIcons');
  if (patEl) { patEl.style.background = st.targetPatternIds.length ? '#f5d742' : '#2a2a4e'; patEl.style.color = st.targetPatternIds.length ? '#000' : '#ccc'; }
  if (featEl) { featEl.style.background = st.targetFeatureIds.length ? '#f5d742' : '#2a2a4e'; featEl.style.color = st.targetFeatureIds.length ? '#000' : '#ccc'; }
  if (iconEl) { iconEl.style.background = st.targetIcons.length ? '#f5d742' : '#2a2a4e'; iconEl.style.color = st.targetIcons.length ? '#000' : '#ccc'; }
}

function slotSpinToolGetOverrides() {
  var st = _slotSpinTool;
  if (!st.enabled) return { targetPatternIds: [], targetFeatureIds: [], icons: [] };
  return {
    targetPatternIds: st.targetPatternIds.slice(),
    targetFeatureIds: st.targetFeatureIds.slice(),
    icons: st.targetIcons.slice()
  };
}
