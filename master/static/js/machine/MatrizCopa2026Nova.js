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
  var bet = (st.betList[st.betIndex] || 0.01);
  var totalBet = bet * st.activeLines;

  // Get tool overrides
  var toolOverrides = (typeof slotSpinToolGetOverrides === 'function') ? slotSpinToolGetOverrides() : {};
  var toolIcons = toolOverrides.icons || [];
  var toolPatternIds = toolOverrides.targetPatternIds || [];

  var icons;
  if (toolIcons.length >= st.rowCount * st.colCount) {
    // Tool provided exact icons — use them directly
    icons = toolIcons.slice();
  } else if (toolPatternIds.length > 0) {
    // Tool wants to hit a specific pattern — generate icons that match it
    icons = mcDemoGenerateIconsForPattern(mathModel, toolPatternIds[0], st.activeLines);
  } else {
    // Normal random
    icons = mcDemoGenerateIcons(mathModel);
  }

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

  // Check MatrizaCopaBonusFeature trigger
  var bonusResult = mcDemoCheckBonusTrigger(icons, mathModel, bet);
  if (bonusResult) {
    resp.triggered = true;
    resp.opened_closet_content = bonusResult.content;
    resp.copa_bonus = bonusResult.copaBonus;
    resp.calculated_goal = bonusResult.calculatedGoal;
    resp.hit_goal_bonus = bonusResult.hitGoalBonus;
    // Only copa_bonus counts as win (closet prize is used for goal calculation only)
    resp.total_won = parseFloat((resp.total_won + bonusResult.copaBonus).toFixed(2));
    _mcDemoBalance = parseFloat((_mcDemoBalance + bonusResult.copaBonus).toFixed(2));
    resp.balance = _mcDemoBalance;
  }

  st.reelIcons = icons.slice();
  playLog('<<< [DEMO SPIN] response: ' + JSON.stringify(resp));
  slotHandleSpinResponse(resp);

  // Show bonus animation after reels stop if triggered
  if (bonusResult) {
    _playBonusPending = true;
    window._mcBonusResult = bonusResult;
    setTimeout(function() { mcDemoShowClosetBonus(bonusResult.content, bonusResult.prize, bet); }, 3800);
  }
}

/**
 * Generate icons that guarantee hitting a specific pattern on a random active line.
 * Fills the target line positions with icons matching the pattern format,
 * and fills remaining positions randomly.
 */
function mcDemoGenerateIconsForPattern(mathModel, targetPatId, activeLines) {
  var patterns = mathModel.pattern || [];
  var lines = mathModel.lines || [];
  var lineDir = mathModel.line_direction || [];
  var reelIcons = mathModel.actual_reel_icons || [];
  var rowCount = mathModel.row_count || 3;
  var colCount = mathModel.column_count || 5;
  var totalPositions = rowCount * colCount;
  var allIcons = mathModel.icon || [1,2,3,4,5,6,7,8,9,10];
  var wildIcon = 9;

  // Find a matching pattern by id
  var targetPat = null;
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].id === targetPatId) { targetPat = patterns[i]; break; }
  }
  if (!targetPat) return mcDemoGenerateIcons(mathModel);

  // Find eligible lines based on pattern type and line_direction
  var eligibleLines = [];
  for (var li = 0; li < activeLines && li < lines.length; li++) {
    var dir = lineDir[li] || 1;
    if (targetPat.type === 0 || targetPat.type === dir) {
      eligibleLines.push(li);
    }
  }
  if (eligibleLines.length === 0) return mcDemoGenerateIcons(mathModel);

  // Pick a random eligible line
  var chosenLineIdx = eligibleLines[Math.floor(Math.random() * eligibleLines.length)];
  var chosenLine = lines[chosenLineIdx];

  // Parse pattern format tokens
  var regex = /i-?\d+/g;
  var tokens = [];
  var m;
  while ((m = regex.exec(targetPat.format)) !== null) tokens.push(m[0]);

  // Start with all random icons
  var icons = [];
  for (var i = 0; i < totalPositions; i++) {
    icons.push(allIcons[Math.floor(Math.random() * allIcons.length)]);
  }

  // Place icons on the chosen line to match the pattern
  for (var p = 0; p < tokens.length && p < chosenLine.length; p++) {
    var token = tokens[p];
    var pos = chosenLine[p];
    if (token.indexOf('-') >= 0) {
      // i-N = don't care, keep random (but avoid accidentally matching other patterns)
      continue;
    }
    var reqIcon = parseInt(token.substring(1));
    if (reqIcon === wildIcon) {
      // Pattern requires wild icon at this position
      icons[pos] = wildIcon;
    } else {
      // Pattern requires this specific icon (or wild can substitute)
      icons[pos] = reqIcon;
    }
  }

  return icons;
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
    '<img id="mcLoadBg" src="/static/machine/MatrizCopa2026Nova/item/loading.PNG" style="position:absolute;width:100%;height:100%;object-fit:fill;transform:scale(1.5);opacity:0;transition:transform 2s ease-out, opacity 0.5s ease-in;">' +
    '<img id="mcLoadScene2" src="/static/machine/MatrizCopa2026Nova/item/loading2.png" style="position:absolute;width:60%;max-width:400px;height:auto;object-fit:contain;right:-600px;bottom:5%;transform:scale(3);opacity:0;transition:right 1.2s ease-out, transform 1.2s ease-out, opacity 0.3s;">' +
    '<img id="mcLoadScene" src="/static/machine/MatrizCopa2026Nova/item/loading1.png" style="position:absolute;width:60%;max-width:400px;height:auto;object-fit:contain;right:-600px;bottom:5%;transform:scale(1.5);opacity:0;transition:right 1.2s ease-out, transform 1.2s ease-out, opacity 0.3s;">' +
    '<img id="mcLoadBall" src="/static/machine/MatrizCopa2026Nova/item/golden_ball.png" style="position:absolute;width:30px;height:30px;object-fit:contain;left:-60px;bottom:10%;opacity:0;transition:none;">' +
    '<div id="mcLoadText" style="position:absolute;left:10%;bottom:-60px;opacity:0;transition:bottom 1s ease-out, opacity 0.5s;font-size:36px;font-weight:900;font-style:italic;color:transparent;background:linear-gradient(180deg,#ffd700,#ff8c00,#ffd700);-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:2px #000;letter-spacing:4px;font-family:Arial Black,sans-serif;filter:drop-shadow(2px 2px 0 #000) drop-shadow(-1px -1px 0 #000);">2026</div>';
  gameArea.style.position = 'relative';
  gameArea.appendChild(overlay);
  setTimeout(function() { var bg = document.getElementById('mcLoadBg'); if (bg) { bg.style.opacity = '1'; bg.style.transform = 'scale(1)'; } }, 50);
  setTimeout(function() { var s2 = document.getElementById('mcLoadScene2'); if (s2) { s2.style.opacity = '1'; s2.style.right = '2%'; s2.style.transform = 'scale(1)'; } var s = document.getElementById('mcLoadScene'); if (s) { s.style.opacity = '1'; s.style.right = '2%'; s.style.transform = 'scale(0.5)'; } }, 1500);
  setTimeout(function() { var b = document.getElementById('mcLoadBall'); if (b) { b.style.opacity = '1'; b.style.transition = 'left 1.5s cubic-bezier(0.25,0.46,0.45,0.94), transform 1.5s ease-out, width 1.5s ease-out, height 1.5s ease-out'; b.style.left = '10%'; b.style.width = '60px'; b.style.height = '60px'; b.style.transform = 'rotate(720deg)'; } }, 4000);
  setTimeout(function() { var t = document.getElementById('mcLoadText'); if (t) { t.style.opacity = '1'; t.style.bottom = '3%'; } }, 5200);
  setTimeout(function() { var ov = document.getElementById('mcLoadingOverlay'); if (ov) { ov.style.transition = 'opacity 0.5s'; ov.style.opacity = '0'; setTimeout(function() { if (ov.parentNode) ov.remove(); onComplete(); }, 500); } else { onComplete(); } }, 7000);
}

// ===========================================================================
// MatrizaCopaBonusFeature — Closet Bonus
// ===========================================================================

/**
 * Check if icons trigger the bonus.
 * trigger_code: ["i10c5","i10c4","i10c3"] — icon 10, count 5/4/3
 * chances_to_open_box: [3,2,1] — corresponding chances
 */
function mcDemoCheckBonusTrigger(icons, mathModel, bet) {
  var features = (mathModel.features && mathModel.features.lists) || [];
  var bonusConfig = null;
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('MatrizaCopaBonusFeature') >= 0) {
      bonusConfig = features[i].config; break;
    }
  }
  if (!bonusConfig) return null;

  var triggerCodes = bonusConfig.trigger_code || [];
  var chances = bonusConfig.chances_to_open_box || [];
  var boxContent = bonusConfig.box_content || [];
  var boxWeight = bonusConfig.box_content_weight || [];

  // Count icon 10 occurrences
  var icon10Count = 0;
  for (var i = 0; i < icons.length; i++) { if (icons[i] === 10) icon10Count++; }

  // Check trigger codes: "i10c5" means icon 10 count >= 5
  var numChances = 0;
  for (var i = 0; i < triggerCodes.length; i++) {
    var match = triggerCodes[i].match(/i(\d+)c(\d+)/);
    if (match) {
      var reqIcon = parseInt(match[1]);
      var reqCount = parseInt(match[2]);
      if (reqIcon === 10 && icon10Count >= reqCount) {
        numChances = chances[i] || 0;
        break; // First match (highest count first)
      }
    }
  }

  if (numChances <= 0) return null;

  // Generate opened_closet_content by weighted random (no replacement)
  var content = [];
  var availableIndices = [];
  for (var i = 0; i < boxContent.length; i++) availableIndices.push(i);

  for (var c = 0; c < numChances && availableIndices.length > 0; c++) {
    // Normalize weights for available indices
    var totalW = 0;
    for (var i = 0; i < availableIndices.length; i++) totalW += boxWeight[availableIndices[i]];
    var r = Math.random() * totalW;
    var sum = 0;
    var picked = 0;
    for (var i = 0; i < availableIndices.length; i++) {
      sum += boxWeight[availableIndices[i]];
      if (r <= sum) { picked = i; break; }
    }
    content.push(boxContent[availableIndices[picked]]);
    availableIndices.splice(picked, 1);
  }

  var prize = 0;
  for (var i = 0; i < content.length; i++) prize += content[i] * bet;
  prize = parseFloat(prize.toFixed(2));

  // Shooting phase calculation (放回式 - with replacement, single normalization)
  var timesToShoot = bonusConfig.times_to_shoot || 5;
  var shootWeight = bonusConfig.shoot_weight || [0.5,0.5,0.5,0.5,0.5];
  var goalMultipliers = (bonusConfig.goal || []).slice();
  var goalWeights = (bonusConfig.goal_weight || []).slice();

  // calculated_goal = prize * each goal multiplier
  var calculatedGoal = goalMultipliers.map(function(g) { return parseFloat((prize * g).toFixed(2)); });

  // Normalize goal_weight once (with replacement - same weights each shot)
  var totalGW = 0;
  for (var i = 0; i < goalWeights.length; i++) totalGW += goalWeights[i];
  var normalizedGW = goalWeights.map(function(w) { return w / totalGW; });

  // Simulate shooting: for each shot, pick a goal target, then check if hit
  // With replacement: same position can be hit multiple times
  var hitGoal = new Array(goalMultipliers.length).fill(0);
  var hitGoalBonus = []; // ordered list of prizes for each successful shot

  for (var shot = 0; shot < timesToShoot; shot++) {
    // Pick target using normalized weights (with replacement)
    var rg = Math.random();
    var sumG = 0; var goalPos = 0;
    for (var i = 0; i < normalizedGW.length; i++) {
      sumG += normalizedGW[i];
      if (rg <= sumG) { goalPos = i; break; }
    }

    // Check if shot hits (compare random with shoot_weight for this shot)
    var sw = (shot < shootWeight.length) ? shootWeight[shot] : 0.5;
    if (Math.random() <= sw) {
      hitGoal[goalPos] += 1;
      hitGoalBonus.push(calculatedGoal[goalPos]);
    } else {
      hitGoalBonus.push(0); // miss
    }
  }

  // copa_bonus = sum of all hit prizes
  var copaBonus = 0;
  for (var i = 0; i < hitGoalBonus.length; i++) { copaBonus += hitGoalBonus[i]; }
  copaBonus = parseFloat(copaBonus.toFixed(2));

  return { content: content, prize: prize, chances: numChances, copaBonus: copaBonus, calculatedGoal: calculatedGoal, hitGoalBonus: hitGoalBonus };
}

/**
 * Show closet bonus animation.
 * Background + 2x5 closets, player clicks to reveal prizes.
 */
function mcDemoShowClosetBonus(contentArray, totalPrize, bet) {
  var imgBase = '/static/machine/MatrizCopa2026Nova/item/';
  var overlay = document.createElement('div');
  overlay.id = 'mcClosetBonusOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';

  var html = '<div style="position:relative;width:500px;max-width:90vw;height:360px;border-radius:12px;overflow:hidden;">';
  // Background
  html += '<img src="' + imgBase + 'bonus1_step_background.jpg" style="position:absolute;width:100%;height:100%;object-fit:cover;">';
  // Title
  html += '<div style="position:absolute;top:8px;left:50%;transform:translateX(-50%);color:#ffd700;font-size:16px;font-weight:700;text-shadow:0 2px 4px #000;">⚽ BONUS — Open Closets!</div>';
  // 2x5 closet grid
  html += '<div id="mcClosetGrid" style="position:absolute;top:70px;left:50%;transform:translateX(-50%);display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(2,110px);gap:0;justify-content:center;width:320px;">';
  for (var i = 0; i < 10; i++) {
    html += '<div class="mc-closet" data-idx="' + i + '" onclick="mcDemoClickCloset(' + i + ')" style="cursor:pointer;position:relative;width:100%;height:100%;overflow:hidden;">';
    html += '<img src="' + imgBase + 'bonus1_step_closet1.PNG" style="width:100%;height:100%;object-fit:fill;display:block;" id="mcClosetImg' + i + '">';
    html += '</div>';
  }
  html += '</div>';
  // Status
  html += '<div id="mcClosetStatus" style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);color:#fff;font-size:13px;font-weight:600;text-shadow:0 1px 3px #000;">Tap ' + contentArray.length + ' closet(s) to reveal prizes</div>';
  html += '</div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  window._mcClosetState = {
    content: contentArray,
    currentIdx: 0,
    totalRevealed: 0,
    totalPrize: totalPrize,
    bet: bet
  };
}

function mcDemoClickCloset(idx) {
  var state = window._mcClosetState;
  if (!state || state.currentIdx >= state.content.length) return;
  if (state.animating) return; // prevent clicking during animation

  var closetEl = document.querySelector('.mc-closet[data-idx="' + idx + '"]');
  if (!closetEl || closetEl.getAttribute('data-opened') === '1') return;

  state.animating = true;

  // Play 4-frame character animation before opening
  var imgBase = '/static/machine/MatrizCopa2026Nova/item/';
  var frames = ['bonus1_step_1_p1.PNG', 'bonus1_step_1_p2.png', 'bonus1_step_1_p3.png', 'bonus1_step_1_p4.PNG'];
  var charEl = document.getElementById('mcClosetCharAnim');
  if (!charEl) {
    charEl = document.createElement('img');
    charEl.id = 'mcClosetCharAnim';
    charEl.style.cssText = 'position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:120px;height:auto;object-fit:contain;z-index:10;pointer-events:none;';
    var bonusContainer = document.querySelector('#mcClosetBonusOverlay > div');
    if (bonusContainer) { bonusContainer.style.position = 'relative'; bonusContainer.appendChild(charEl); }
  }
  charEl.style.display = '';

  var frameIdx = 0;
  charEl.src = imgBase + frames[0];
  var frameTimer = setInterval(function() {
    frameIdx++;
    if (frameIdx < frames.length) {
      charEl.src = imgBase + frames[frameIdx];
    } else {
      clearInterval(frameTimer);
      charEl.style.display = 'none';
      // Now open the closet
      mcDemoRevealCloset(idx);
    }
  }, 200);
}

function mcDemoRevealCloset(idx) {
  var state = window._mcClosetState;
  var closetEl = document.querySelector('.mc-closet[data-idx="' + idx + '"]');
  if (!closetEl) { state.animating = false; return; }

  closetEl.setAttribute('data-opened', '1');
  closetEl.style.cursor = 'default';

  var imgBase = '/static/machine/MatrizCopa2026Nova/item/';
  var prize = state.content[state.currentIdx];
  state.currentIdx++;
  state.totalRevealed++;
  state.animating = false;

  // Replace closet image with opened version
  var img = document.getElementById('mcClosetImg' + idx);
  if (img) img.src = imgBase + 'bonus1_step_closet2.PNG';

  // Show power bar + prize value
  var prizeHtml = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;">';
  prizeHtml += '<div style="color:#ffd700;font-size:14px;font-weight:900;text-shadow:0 1px 3px #000;">x' + prize + '</div>';
  prizeHtml += '<img src="' + imgBase + 'bonus1_step_1_power.png" style="width:50px;height:auto;">';
  prizeHtml += '</div>';
  closetEl.insertAdjacentHTML('beforeend', prizeHtml);

  // Update status
  var remaining = state.content.length - state.currentIdx;
  var statusEl = document.getElementById('mcClosetStatus');
  if (remaining > 0) {
    statusEl.textContent = 'Tap ' + remaining + ' more closet(s)';
  } else {
    // All opened — show total and close
    statusEl.innerHTML = '<span style="color:#ffd700;font-size:16px;">🎉 Total Bonus: +' + state.totalPrize.toFixed(2) + '</span>';
    setTimeout(function() {
      var ov = document.getElementById('mcClosetBonusOverlay');
      if (ov) { ov.style.transition = 'opacity 0.5s'; ov.style.opacity = '0'; setTimeout(function() { ov.remove(); }, 500); }
      // Start shooting phase transition
      setTimeout(function() { mcDemoStartShootingTransition(); }, 600);
    }, 2000);
  }
}

// ===========================================================================
// Shooting Phase — Transition & Animation
// ===========================================================================

function mcDemoStartShootingTransition() {
  var imgBase = '/static/machine/MatrizCopa2026Nova/item/';
  var overlay = document.createElement('div');
  overlay.id = 'mcShootTransOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);overflow:hidden;';
  // bonus1_step_2.PNG zoom from far to near
  overlay.innerHTML = '<div style="position:relative;width:500px;max-width:90vw;height:360px;border-radius:12px;overflow:hidden;"><img id="mcTransImg" src="' + imgBase + 'bonus1_step_2.PNG" style="width:100%;height:100%;object-fit:fill;transform:scale(0.5);opacity:0;transition:transform 2s ease-out, opacity 0.3s;"></div>';
  document.body.appendChild(overlay);

  // Phase 1: bonus1_step_2 zoom in
  setTimeout(function() { var img = document.getElementById('mcTransImg'); if (img) { img.style.opacity = '1'; img.style.transform = 'scale(1)'; } }, 50);

  // Phase 2: transition to loading.PNG (2s later)
  setTimeout(function() {
    var img = document.getElementById('mcTransImg');
    if (img) { img.src = imgBase + 'loading.PNG'; }
  }, 2000);

  // Phase 3: start shooting (3s total transition)
  setTimeout(function() {
    var ov = document.getElementById('mcShootTransOverlay');
    if (ov) ov.remove();
    mcDemoStartShooting();
  }, 3000);
}

function mcDemoStartShooting() {
  var result = window._mcBonusResult;
  if (!result) { _playBonusPending = false; slotRoundOver(); return; }

  var imgBase = '/static/machine/MatrizCopa2026Nova/item/';
  var calculatedGoal = result.calculatedGoal || [];
  var timesToShoot = 5;

  var overlay = document.createElement('div');
  overlay.id = 'mcShootOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';

  var html = '<div style="position:relative;width:750px;max-width:95vw;height:400px;border-radius:12px;overflow:hidden;">';
  html += '<img src="' + imgBase + 'bonus1_step_3_background.jpg" style="position:absolute;width:100%;height:100%;object-fit:fill;">';
  // Goal targets (2x3 grid)
  html += '<div id="mcGoalGrid" style="position:absolute;top:8%;left:50%;transform:translateX(-50%);display:grid;grid-template-columns:repeat(3,45px);grid-template-rows:repeat(2,45px);column-gap:120px;row-gap:50px;">';
  for (var i = 0; i < 6; i++) {
    var goalVal = calculatedGoal[i] !== undefined ? calculatedGoal[i].toFixed(2) : '0';
    html += '<div class="mc-goal-spot" data-idx="' + i + '" style="position:relative;display:flex;align-items:center;justify-content:center;">';
    html += '<img src="' + imgBase + 'bonus1_step_3_round1.PNG" style="width:100%;height:100%;object-fit:contain;" id="mcGoalImg' + i + '">';
    html += '<div style="position:absolute;top:2px;font-size:9px;color:#fff;font-weight:700;text-shadow:0 1px 2px #000;">' + goalVal + '</div>';
    html += '</div>';
  }
  html += '</div>';
  // Target (moving)
  html += '<img id="mcShootTarget" src="' + imgBase + 'bonus1_step_3_target.PNG" style="position:absolute;width:50px;height:50px;object-fit:contain;top:20%;left:calc(50% - 25px);transition:left 0.3s, top 0.3s;pointer-events:none;">';
  // Goalkeeper
  html += '<img id="mcShootKeeper" src="' + imgBase + 'bonus1_step_3_player1.PNG" style="position:absolute;bottom:50%;left:50%;transform:translateX(-50%);width:120px;height:120px;object-fit:contain;pointer-events:none;transition:transform 0.3s ease-out;">';
  // Ball (clickable)
  html += '<img id="mcShootBall" src="' + imgBase + 'bonus1_step_3_ball1.PNG" style="position:absolute;bottom:8%;left:50%;transform:translateX(-50%);width:50px;height:50px;object-fit:contain;cursor:pointer;" onclick="mcDemoShootBall()">';
  // Status
  html += '<div id="mcShootStatus" style="position:absolute;bottom:2%;left:50%;transform:translateX(-50%);color:#fff;font-size:12px;font-weight:600;text-shadow:0 1px 3px #000;">Tap the ball to shoot! (5 shots)</div>';
  html += '</div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  window._mcShootState = {
    hitGoalBonus: result.hitGoalBonus || [],
    calculatedGoal: calculatedGoal,
    shotsFired: 0,
    maxShots: timesToShoot,
    totalHit: 0,
    runningTotal: 0,
    copaBonus: result.copaBonus,
    targetPos: 0,
    animating: false
  };

  // Start target movement animation
  mcDemoMoveTarget();
}

var _mcTargetTimer = null;
function mcDemoMoveTarget() {
  var positions = [
    { top: '10%', left: 'calc(50% - 185px)' },
    { top: '10%', left: 'calc(50% - 25px)' },
    { top: '10%', left: 'calc(50% + 135px)' },
    { top: '28%', left: 'calc(50% - 185px)' },
    { top: '28%', left: 'calc(50% - 25px)' },
    { top: '28%', left: 'calc(50% + 135px)' }
  ];
  var idx = 0;
  _mcTargetTimer = setInterval(function() {
    var state = window._mcShootState;
    if (!state) { clearInterval(_mcTargetTimer); return; }
    idx = (idx + 1) % positions.length;
    state.targetPos = idx;
    var target = document.getElementById('mcShootTarget');
    if (target) { target.style.top = positions[idx].top; target.style.left = positions[idx].left; }
  }, 400);
}

function mcDemoShootBall() {
  var state = window._mcShootState;
  if (!state || state.animating || state.shotsFired >= state.maxShots) return;
  state.animating = true;
  state.shotsFired++;

  var imgBase = '/static/machine/MatrizCopa2026Nova/item/';
  var shotIdx = state.shotsFired - 1;
  var shotPrize = state.hitGoalBonus[shotIdx] || 0;
  var isHit = shotPrize > 0;

  // Determine target position: if hit, find the matching goal spot; if miss, use moving target
  var targetPos;
  if (isHit) {
    // Find goal spot that matches this prize value
    targetPos = 0;
    for (var i = 0; i < state.calculatedGoal.length; i++) {
      if (Math.abs(state.calculatedGoal[i] - shotPrize) < 0.001) { targetPos = i; break; }
    }
  } else {
    targetPos = state.targetPos; // miss goes to current moving target
  }

  // Animate ball flying to target position
  var ball = document.getElementById('mcShootBall');
  var goalSpot = document.querySelector('.mc-goal-spot[data-idx="' + targetPos + '"]');
  if (!ball || !goalSpot) { state.animating = false; return; }

  var container = document.querySelector('#mcShootOverlay > div');
  if (!container) { state.animating = false; return; }
  var containerRect = container.getBoundingClientRect();
  var ballRect = ball.getBoundingClientRect();
  var goalRect = goalSpot.getBoundingClientRect();

  var startX = ballRect.left - containerRect.left + ballRect.width / 2;
  var startY = ballRect.top - containerRect.top + ballRect.height / 2;
  var endX = goalRect.left - containerRect.left + goalRect.width / 2;
  var endY = goalRect.top - containerRect.top + goalRect.height / 2;

  // Create flying ball clone
  var flyBall = document.createElement('img');
  flyBall.src = imgBase + 'bonus1_step_3_ball1.PNG';
  flyBall.style.cssText = 'position:absolute;width:40px;height:40px;object-fit:contain;z-index:20;pointer-events:none;left:' + (startX - 20) + 'px;top:' + (startY - 20) + 'px;transition:left 0.6s ease-out, top 0.6s cubic-bezier(0.2,0,0.4,1.5);';
  container.appendChild(flyBall);

  setTimeout(function() {
    flyBall.style.left = (endX - 20) + 'px';
    flyBall.style.top = (endY - 20) + 'px';
  }, 50);

  // After ball arrives
  setTimeout(function() {
    if (isHit && shotPrize > 0) {
      // Hit: remove ball, mark goal
      flyBall.remove();
      var goalImg = document.getElementById('mcGoalImg' + targetPos);
      if (goalImg) goalImg.src = imgBase + 'bonus1_step_3_round2.PNG';
      state.totalHit++;
      state.runningTotal = parseFloat((state.runningTotal + shotPrize).toFixed(2));
    } else {
      // Miss: bounce ball back + goalkeeper dive
      var col = targetPos % 3;
      var keeper = document.getElementById('mcShootKeeper');
      if (keeper) {
        if (col === 0) {
          keeper.src = imgBase + 'bonus1_step_3_player2.PNG';
          keeper.style.transform = 'translateX(-50%) translateX(-120px)';
        } else if (col === 2) {
          keeper.src = imgBase + 'bonus1_step_3_player3.PNG';
          keeper.style.transform = 'translateX(-50%) translateX(120px)';
        } else {
          if (Math.random() < 0.5) {
            keeper.src = imgBase + 'bonus1_step_3_player2.PNG';
            keeper.style.transform = 'translateX(-50%) translateX(-60px)';
          } else {
            keeper.src = imgBase + 'bonus1_step_3_player3.PNG';
            keeper.style.transform = 'translateX(-50%) translateX(60px)';
          }
        }
        setTimeout(function() {
          if (keeper) { keeper.src = imgBase + 'bonus1_step_3_player1.PNG'; keeper.style.transform = 'translateX(-50%)'; }
        }, 800);
      }
      // Ball bounce back animation
      flyBall.style.transition = 'left 0.5s ease-in, top 0.5s cubic-bezier(0.5,0,1,0.5), opacity 0.3s 0.4s';
      var bounceX = parseFloat(flyBall.style.left) + (col === 0 ? -60 : (col === 2 ? 60 : (Math.random() < 0.5 ? -40 : 40)));
      flyBall.style.left = bounceX + 'px';
      flyBall.style.top = (startY - 20) + 'px';
      flyBall.style.opacity = '0';
      setTimeout(function() { flyBall.remove(); }, 600);
    }

    // Update status with running total
    var remaining = state.maxShots - state.shotsFired;
    var statusEl = document.getElementById('mcShootStatus');
    if (remaining > 0) {
      var msg = isHit && shotPrize > 0 ? 'GOAL! +' + shotPrize.toFixed(2) + ' | ' : 'Miss! | ';
      statusEl.innerHTML = msg + 'Total: <span style="color:#ffd700;">' + state.runningTotal.toFixed(2) + '</span> | ' + remaining + ' shot(s) left';
      state.animating = false;
    } else {
      // All shots done
      clearInterval(_mcTargetTimer);
      var target = document.getElementById('mcShootTarget');
      if (target) target.style.display = 'none';
      // Copa bonus celebration animation
      var shootContainer = document.querySelector('#mcShootOverlay > div');
      if (shootContainer) {
        var celebHtml = '<div id="mcCopaCelebration" style="position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:30;animation:jpScale 0.8s ease-out;">';
        celebHtml += '<div style="font-size:20px;margin-bottom:8px;">⚽🏆⚽</div>';
        celebHtml += '<div style="color:#ffd700;font-size:24px;font-weight:900;text-shadow:0 0 20px rgba(255,215,0,0.6),0 2px 4px #000;margin-bottom:6px;">COPA BONUS!</div>';
        celebHtml += '<div style="color:#fff;font-size:36px;font-weight:900;text-shadow:0 0 15px rgba(255,215,0,0.5);">+' + state.copaBonus.toFixed(2) + '</div>';
        celebHtml += '<div style="color:#aaa;font-size:12px;margin-top:8px;">Goals: ' + state.totalHit + '/' + state.maxShots + '</div>';
        celebHtml += '</div>';
        shootContainer.insertAdjacentHTML('beforeend', celebHtml);
      }
      statusEl.innerHTML = '';
      // Close and finish after celebration
      setTimeout(function() {
        var ov = document.getElementById('mcShootOverlay');
        if (ov) { ov.style.transition = 'opacity 0.5s'; ov.style.opacity = '0'; setTimeout(function() { ov.remove(); }, 500); }
        _playBonusPending = false;
        slotRoundOver();
      }, 3000);
    }
  }, 700);
}
