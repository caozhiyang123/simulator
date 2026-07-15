// ---------------------------------------------------------------------------
// MatrizCopa2026Nova Machine Plugin (Slot)
// 3x5 slot, 30 lines. DEMO mode with full client-side simulation.
// ---------------------------------------------------------------------------
var _mcDemoMode = false;
var _mcDemoBalance = 10000.00;
var _mcDemoConfig = null;

MachineRegistry.register('MatrizCopa2026Nova', {
  type: 'slot',

  afterRender: function(resp, config) {
    _mcDemoConfig = config;
    matrizCopaShowLoadingAnim(function() {
      var extraColors = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa',
        '#00acc1','#d81b60','#ff6d00','#26a69a','#c0ca33'];
      while (SLOT_LINE_COLORS.length < 30) {
        SLOT_LINE_COLORS.push(extraColors[SLOT_LINE_COLORS.length % extraColors.length]);
      }
      var mathModel = (config.math_model && config.math_model[0]) || {};
      var lineDir = mathModel.line_direction || [];
      if (lineDir.length > 0) matrizCopaRebuildLineNumbers(lineDir);
    });
  },

  onSpinResponse: function(resp) {
    if (_mcDemoMode && (resp.error_code || resp.error_message)) {
      mcDemoSimulateSpin(); return;
    }
    slotHandleSpinResponse(resp);
  },

  onRoundOver: function(resp) {
    if (_mcDemoMode && (resp.error_code || resp.error_message)) {
      mcDemoSimulateRoundOver(); return;
    }
    slotHandleRoundOverResponse(resp);
  }
});

// ===========================================================================
// DEMO Mode — Lobby Selection & Simulation
// ===========================================================================

/**
 * Show DEMO/NORMAL selection modal when clicking this machine in lobby.
 * Called from play.js machine card click (hooked below).
 */
function mcShowDemoChoiceModal(onChoice) {
  var overlay = document.createElement('div');
  overlay.id = 'mcDemoChoiceModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML =
    '<div style="background:#1a1a2e;border-radius:12px;padding:28px;border:2px solid #f5d742;text-align:center;min-width:300px;">' +
    '<div style="font-size:18px;font-weight:700;color:#f5d742;margin-bottom:6px;">⚽ MatrizCopa2026Nova</div>' +
    '<div style="font-size:12px;color:#aaa;margin-bottom:20px;">Choose play mode</div>' +
    '<div style="display:flex;gap:16px;justify-content:center;">' +
    '<button onclick="mcDemoChoiceSelect(true)" style="background:linear-gradient(180deg,#ffd700,#ff8c00);color:#000;border:none;border-radius:8px;padding:12px 28px;cursor:pointer;font-size:14px;font-weight:700;">DEMO</button>' +
    '<button onclick="mcDemoChoiceSelect(false)" style="background:linear-gradient(180deg,#4a90d9,#2a6ab9);color:#fff;border:none;border-radius:8px;padding:12px 28px;cursor:pointer;font-size:14px;font-weight:700;">NORMAL</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
  window._mcDemoChoiceCallback = onChoice;
}

function mcDemoChoiceSelect(isDemo) {
  _mcDemoMode = isDemo;
  _mcDemoBalance = 10000.00;
  var modal = document.getElementById('mcDemoChoiceModal');
  if (modal) modal.remove();
  if (window._mcDemoChoiceCallback) window._mcDemoChoiceCallback(isDemo);
}

function mcDemoSimulateLogin() {
  var config = _mcDemoConfig || (_playCurrentMachine && _playCurrentMachine.config);
  var mathModel = (config && config.math_model && config.math_model[0]) || {};
  var icons = mcDemoGenerateIcons(mathModel);

  var resp = {
    cmd: 'iniciar', round_is_over: true, role: 'admin', triggered: false,
    sound: true, remaining_amount: 0, total_won: 0, language: 'en',
    session_token: 'demo_sess_' + Date.now(), mode: 'play', won_pattern: '',
    display_currency_precision: 2, features: [], music: true,
    balance: _mcDemoBalance, nickname: 'demo_player', bonus_id: '',
    currency: 'coins', free_spin: false, game_id: 2026, rtp_range: '94%-96%',
    left_free_spin_by_bet: [],
    bet_list: [0.01,0.02,0.04,0.08,0.1,1,10,100],
    bonus_unique_id: '', icons: icons, current_amount: 0,
    is_bonus_session: false, total_amount: 0,
    display_currency_symbol: 'CC', opt_id: 'demo', username: 'demo_player',
    ext_config: '{}', bonus_type: '', bet_per_spin: 0, expire_time: 0,
    enabled_auto_features: ['auto_spin'], game_currency: 'coins', target_amount: 3
  };

  _playSessionToken = resp.session_token;
  _playCurrentMachine = { machine_id: 2026, response: resp, config: config, type: 'slot', name: 'MatrizCopa2026Nova' };
  playLog('<<< [DEMO LOGIN] response: ' + JSON.stringify(resp));
  playHideLoading();
  document.getElementById('playMachineList').style.display = 'none';
  document.getElementById('playGameArea').style.display = '';
  document.getElementById('playBackBtn').style.display = '';
  document.getElementById('playAuthBar').style.display = 'none';
  var tabBar = document.getElementById('playTabBar');
  if (tabBar) tabBar.style.display = 'none';
  SlotEngine.render(resp, config, 'MatrizCopa2026Nova');
}

function mcDemoSimulateSpin() {
  var st = _slotState;
  var config = _mcDemoConfig || (_playCurrentMachine && _playCurrentMachine.config);
  var mathModel = (config && config.math_model && config.math_model[0]) || {};
  var icons = mcDemoGenerateIcons(mathModel);
  var bet = (st.betList[st.betIndex] || 0.01);
  var totalBet = bet * st.activeLines;

  // Calculate wins
  var winResult = mcDemoCalcWins(icons, mathModel, st.activeLines, bet);
  _mcDemoBalance = parseFloat((_mcDemoBalance - totalBet + winResult.totalWon).toFixed(2));

  var resp = {
    cmd: 'solicitajogada', triggered: false, bonus_unique_id: '', aposta: bet,
    total_won: winResult.totalWon, remaining_amount: 0, bonus_type: '',
    bet_per_spin: 0, expire_time: 0, icons: icons, left_free_spin_amount: 0,
    won_pattern: winResult.wonPattern, current_amount: 0, features: [],
    balance: _mcDemoBalance, is_bonus_session: false, total_amount: 0,
    bonus_id: '', currency: 'coins', game_id: 2026
  };

  st.reelIcons = icons.slice();
  playLog('<<< [DEMO SPIN] response: ' + JSON.stringify(resp));
  slotHandleSpinResponse(resp);
}

function mcDemoSimulateRoundOver() {
  var resp = {
    cmd: 'finalizajogada', features: [], balance: _mcDemoBalance,
    total_won: 0, currency: 'coins', left_free_spin_amount: 0, game_id: 2026
  };
  playLog('<<< [DEMO ROUND OVER] response: ' + JSON.stringify(resp));
  slotHandleRoundOverResponse(resp);
}

/**
 * Generate random icons from actual_reel_icons using weighted random.
 * Each reel picks 3 consecutive icons (row_count=3).
 * Returns flat array in row-major order: [r0c0, r0c1, ..., r0c4, r1c0, ..., r2c4]
 */
function mcDemoGenerateIcons(mathModel) {
  var reelIcons = mathModel.actual_reel_icons || [];
  var reelWeights = mathModel.actual_reel_weight || [];
  var rowCount = mathModel.row_count || 3;
  var colCount = mathModel.column_count || 5;
  var reelResults = []; // reelResults[col][row]

  for (var col = 0; col < colCount; col++) {
    var strip = reelIcons[col] || [1,2,3,4,5,6,7,8,9,10];
    var weights = reelWeights[col] || [];
    // Pick a random starting position using weights
    var startIdx = mcDemoWeightedRandom(weights);
    var colIcons = [];
    for (var row = 0; row < rowCount; row++) {
      colIcons.push(strip[(startIdx + row) % strip.length]);
    }
    reelResults.push(colIcons);
  }

  // Convert to row-major: icons[row*colCount + col]
  var flat = [];
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) {
      flat.push(reelResults[col][row]);
    }
  }
  return flat;
}

function mcDemoWeightedRandom(weights) {
  if (!weights || weights.length === 0) return Math.floor(Math.random() * 39);
  var total = 0;
  for (var i = 0; i < weights.length; i++) total += weights[i];
  var r = Math.random() * total;
  var sum = 0;
  for (var i = 0; i < weights.length; i++) {
    sum += weights[i];
    if (r <= sum) return i;
  }
  return weights.length - 1;
}

/**
 * Calculate wins based on icons, patterns, lines, and line_direction.
 * line_direction: 1 = left-to-right (matches type 0,1), 2 = right-to-left (matches type 0,2)
 */
function mcDemoCalcWins(icons, mathModel, activeLines, bet) {
  var lines = mathModel.lines || [];
  var lineDir = mathModel.line_direction || [];
  var patterns = mathModel.pattern || [];
  var colCount = mathModel.column_count || 5;
  var totalWon = 0;
  var wonPatterns = [];

  for (var li = 0; li < activeLines && li < lines.length; li++) {
    var line = lines[li];
    var dir = lineDir[li] || 1;
    // Get icons on this line
    var lineIcons = [];
    for (var p = 0; p < line.length; p++) {
      lineIcons.push(icons[line[p]]);
    }
    // Check patterns: type 0 matches both, type 1 matches dir=1, type 2 matches dir=2
    var bestWin = 0;
    var bestPatFormat = '';
    for (var pi = 0; pi < patterns.length; pi++) {
      var pat = patterns[pi];
      if (pat.type !== 0 && pat.type !== dir) continue;
      if (mcDemoMatchPattern(lineIcons, pat.format)) {
        var win = pat.value * bet;
        if (win > bestWin) {
          bestWin = win;
          bestPatFormat = pat.format;
        }
      }
    }
    if (bestWin > 0) {
      totalWon += bestWin;
      // Build won_pattern string using the matched pattern format: [lN,pattern_format];
      wonPatterns.push('[l' + (li + 1) + ',' + bestPatFormat + ']');
    }
  }

  return {
    totalWon: parseFloat(totalWon.toFixed(2)),
    wonPattern: wonPatterns.length > 0 ? wonPatterns.join(';') + ';' : ''
  };
}

/**
 * Match line icons against a pattern format string.
 * Format: "i1i1i1i1i1" — each token iN means icon N must be at this position.
 * i9 in pattern = wild icon 9 must be at this position (only icon 9 matches).
 * i-N = any icon (don't care / wildcard position in pattern).
 * On the reel: icon 9 (wild) can substitute for any non-wild required icon.
 */
function mcDemoMatchPattern(lineIcons, format) {
  var regex = /i-?\d+/g;
  var tokens = [];
  var m;
  while ((m = regex.exec(format)) !== null) tokens.push(m[0]);
  if (tokens.length !== lineIcons.length) return false;

  var wildIcon = 9; // icon 9 is wild on the reel
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    if (token.indexOf('-') >= 0) continue; // i-N = any icon, always matches
    var requiredIcon = parseInt(token.substring(1));
    var actualIcon = lineIcons[i];
    if (actualIcon === requiredIcon) continue; // exact match
    // Wild on reel (icon 9) can substitute for a non-wild required icon
    if (actualIcon === wildIcon && requiredIcon !== wildIcon) continue;
    // No match
    return false;
  }
  return true;
}

// ===========================================================================
// Hook: Intercept machine click for DEMO choice & WS login error
// ===========================================================================
(function() {
  var origSelectMachine = window.playSelectMachine;
  if (!origSelectMachine) return;
  window.playSelectMachine = function(machineId, enabled, machineType) {
    if (machineId === 2026) {
      if (!enabled) { showAlert('Coming soon'); return; }
      mcShowDemoChoiceModal(function(isDemo) {
        if (isDemo) {
          playShowLoading('Loading DEMO...');
          fetch('/play/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({machine_id: machineId}) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            _mcDemoConfig = data.config || {};
            mcDemoSimulateLogin();
            mcDemoHookSpin();
          })
          .catch(function() { playHideLoading(); showAlert('Failed to load config'); });
        } else {
          origSelectMachine(machineId, enabled, machineType);
        }
      });
    } else {
      origSelectMachine(machineId, enabled, machineType);
    }
  };
})();

var _mcOrigSlotSpin = null;
function mcDemoHookSpin() {
  if (_mcOrigSlotSpin) return;
  _mcOrigSlotSpin = window.slotSpin;
  window.slotSpin = function() {
    if (_mcDemoMode && _playCurrentMachine && _playCurrentMachine.name === 'MatrizCopa2026Nova') {
      var st = _slotState;
      if (st.spinning) return;
      st.spinning = true;
      var btn = document.getElementById('slotSpinBtn');
      if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
      document.getElementById('slotWinDisplay').textContent = '';
      var winAmtEl = document.getElementById('slotWinAmount');
      if (winAmtEl) winAmtEl.textContent = '0.00';
      slotClearAllLines();
      slotStartReelAnimation();
      setTimeout(function() { mcDemoSimulateSpin(); }, 3500);
    } else {
      _mcOrigSlotSpin();
    }
  };
}

// ===========================================================================
// Line Numbers Rebuild
// ===========================================================================
function matrizCopaRebuildLineNumbers(lineDir) {
  var existing = document.querySelectorAll('.mc-line-container');
  existing.forEach(function(el) { el.remove(); });
  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;
  var absDivs = slotSkin.querySelectorAll('div[style*="position:absolute"]');
  absDivs.forEach(function(div) { if (div.querySelector('.slot-line-num')) div.remove(); });
  var reelsContainer = document.getElementById('slotReelsContainer');
  if (reelsContainer) { reelsContainer.style.left = '7%'; reelsContainer.style.width = '86%'; }
  var st = _slotState;
  var leftLines = [], rightLines = [];
  for (var i = 0; i < lineDir.length; i++) { if (lineDir[i] === 1) leftLines.push(i); else rightLines.push(i); }
  var ballImg = '/static/machine/MatrizCopa2026Nova/item/golden_ball.png';
  var ballSize = 28;
  var leftDiv = document.createElement('div');
  leftDiv.className = 'mc-line-container';
  leftDiv.style.cssText = 'position:absolute;top:20%;left:0;width:' + (ballSize+2) + 'px;height:52%;display:flex;flex-direction:column;justify-content:space-around;align-items:center;';
  leftLines.forEach(function(i) {
    leftDiv.innerHTML += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:' + ballSize + 'px;height:' + ballSize + 'px;border-radius:50%;background:url(' + ballImg + ') center/cover no-repeat;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:' + ballSize + 'px;cursor:pointer;opacity:' + (i < st.activeLines ? '1' : '0.4') + ';text-shadow:0 1px 3px rgba(0,0,0,0.9);">' + (i+1) + '</div>';
  });
  slotSkin.appendChild(leftDiv);
  var rightDiv = document.createElement('div');
  rightDiv.className = 'mc-line-container';
  rightDiv.style.cssText = 'position:absolute;top:20%;right:0;width:' + (ballSize+2) + 'px;height:52%;display:flex;flex-direction:column;justify-content:space-around;align-items:center;';
  rightLines.forEach(function(i) {
    rightDiv.innerHTML += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:' + ballSize + 'px;height:' + ballSize + 'px;border-radius:50%;background:url(' + ballImg + ') center/cover no-repeat;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:' + ballSize + 'px;cursor:pointer;opacity:' + (i < st.activeLines ? '1' : '0.4') + ';text-shadow:0 1px 3px rgba(0,0,0,0.9);">' + (i+1) + '</div>';
  });
  slotSkin.appendChild(rightDiv);
}

// ===========================================================================
// Loading Animation
// ===========================================================================
function matrizCopaShowLoadingAnim(onComplete) {
  var gameArea = document.getElementById('playGameArea');
  if (!gameArea) { onComplete(); return; }
  var overlay = document.createElement('div');
  overlay.id = 'mcLoadingOverlay';
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:9999;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;';
  overlay.innerHTML =
    '<img id="mcLoadBg" src="/static/machine/MatrizCopa2026Nova/item/loading.PNG" style="position:absolute;width:100%;height:100%;object-fit:cover;transform:scale(1.5);opacity:0;transition:transform 2s ease-out, opacity 0.5s ease-in;">' +
    '<img id="mcLoadScene" src="/static/machine/MatrizCopa2026Nova/item/loading1.png" style="position:absolute;width:80%;max-width:500px;height:auto;object-fit:contain;right:-600px;top:50%;transform:translateY(-50%) scale(1.5);opacity:0;transition:right 1.2s ease-out, transform 1.2s ease-out, opacity 0.3s;">' +
    '<img id="mcLoadBall" src="/static/machine/MatrizCopa2026Nova/item/golden_ball.png" style="position:absolute;width:40px;height:40px;object-fit:contain;left:-60px;top:calc(50% - 20px);opacity:0;transition:none;">' +
    '<div id="mcLoadText" style="position:absolute;left:50%;bottom:-60px;transform:translateX(-50%);opacity:0;transition:bottom 1s ease-out, opacity 0.5s;font-size:42px;font-weight:900;font-style:italic;color:transparent;background:linear-gradient(180deg,#ffd700,#ff8c00,#ffd700);-webkit-background-clip:text;background-clip:text;text-shadow:0 0 10px rgba(255,215,0,0.5);letter-spacing:4px;font-family:Arial Black,sans-serif;">2026</div>';
  gameArea.style.position = 'relative';
  gameArea.appendChild(overlay);
  setTimeout(function() { var bg = document.getElementById('mcLoadBg'); if (bg) { bg.style.opacity = '1'; bg.style.transform = 'scale(1)'; } }, 50);
  setTimeout(function() { var s = document.getElementById('mcLoadScene'); if (s) { s.style.opacity = '1'; s.style.right = '10%'; s.style.transform = 'translateY(-50%) scale(0.5)'; } }, 1500);
  setTimeout(function() { var b = document.getElementById('mcLoadBall'); if (b) { b.style.opacity = '1'; b.style.transition = 'left 1.5s cubic-bezier(0.25,0.46,0.45,0.94), transform 1.5s ease-out, width 1.5s ease-out, height 1.5s ease-out, top 1.5s ease-out'; b.style.left = 'calc(50% - 40px)'; b.style.top = 'calc(50% - 40px)'; b.style.width = '80px'; b.style.height = '80px'; b.style.transform = 'rotate(720deg)'; } }, 4000);
  setTimeout(function() { var t = document.getElementById('mcLoadText'); if (t) { t.style.opacity = '1'; t.style.bottom = 'calc(50% - 80px)'; } }, 5200);
  setTimeout(function() { var ov = document.getElementById('mcLoadingOverlay'); if (ov) { ov.style.transition = 'opacity 0.5s'; ov.style.opacity = '0'; setTimeout(function() { if (ov.parentNode) ov.remove(); onComplete(); }, 500); } else { onComplete(); } }, 7000);
}
