// ---------------------------------------------------------------------------
// LuckyDragon Machine Plugin (Slot)
// 3x3 slot, 5 lines, 7 icons. DEMO mode with client-side simulation.
// Features: DragonMultiplierFeature, DragonSpinFeature.
// ---------------------------------------------------------------------------
var _ldDemoMode = false;
var _ldDemoBalance = 10000.00;
var _ldDemoConfig = null;
var _ldDemoFreeSpinsLeft = 0;
var _ldDemoDragonSpinTotalWin = 0;

MachineRegistry.register('LuckyDragon', {
  type: 'slot',

  afterRender: function(resp, config) {
    _ldDemoConfig = config;
    // Build custom UI: dragon image + dragon spin reel area + wheel
    setTimeout(function() { ldBuildCustomUI(config); }, 100);
  },

  onSpinResponse: function(resp) {
    if (_ldDemoMode && (resp.error_code || resp.error_message)) {
      ldDemoSimulateSpin(); return;
    }
    slotHandleSpinResponse(resp);
  },

  onRoundOver: function(resp) {
    if (_ldDemoMode && (resp.error_code || resp.error_message)) {
      ldDemoSimulateRoundOver(); return;
    }
    slotHandleRoundOverResponse(resp);
  }
});

// ===========================================================================
// DEMO Mode — Lobby Selection & Simulation
// ===========================================================================
function ldDemoSimulateLogin() {
  var config = _ldDemoConfig;
  var mathModel = (config && config.math_model && config.math_model[0]) || {};
  var icons = ldDemoGenerateIcons(mathModel);

  var resp = {
    cmd: 'iniciar', round_is_over: true, role: 'admin', triggered: false,
    sound: true, remaining_amount: 0, total_won: 0, language: 'en',
    session_token: 'demo_sess_' + Date.now(), mode: 'play', won_pattern: '',
    display_currency_precision: 2, features: [], music: true,
    balance: _ldDemoBalance, nickname: 'demo_player', bonus_id: '',
    currency: 'coins', free_spin: false, game_id: 2027, rtp_range: '94%-96%',
    left_free_spin_by_bet: [],
    bet_list: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
    bonus_unique_id: '', icons: icons, current_amount: 0,
    is_bonus_session: false, total_amount: 0,
    display_currency_symbol: 'CC', opt_id: 'demo', username: 'demo_player',
    ext_config: '{}', bonus_type: '', bet_per_spin: 0, expire_time: 0,
    enabled_auto_features: ['auto_spin'], game_currency: 'coins', target_amount: 0,
    multiplier_reel: (function() { var sf = ldGetFeatureConfig(mathModel, 'DragonSpinFeature'); return sf ? (sf.multiplier_reel || []) : []; })()
  };

  _playSessionToken = resp.session_token;
  _playCurrentMachine = { machine_id: 2027, response: resp, config: config, type: 'slot', name: 'LuckyDragon' };
  playLog('<<< [DEMO LOGIN] response: ' + JSON.stringify(resp));
  playHideLoading();
  document.getElementById('playMachineList').style.display = 'none';
  document.getElementById('playGameArea').style.display = '';
  document.getElementById('playBackBtn').style.display = '';
  document.getElementById('playAuthBar').style.display = 'none';
  var tabBar = document.getElementById('playTabBar');
  if (tabBar) tabBar.style.display = 'none';
  SlotEngine.render(resp, config, 'LuckyDragon');
}

function ldDemoSimulateSpin() {
  var st = _slotState;
  var config = _ldDemoConfig || (_playCurrentMachine && _playCurrentMachine.config);
  var mathModel = (config && config.math_model && config.math_model[0]) || {};
  var bet = (st.betList[st.betIndex] || 0.01);
  var totalBet = bet * st.activeLines;

  // Get tool overrides
  var toolOverrides = (typeof slotSpinToolGetOverrides === 'function') ? slotSpinToolGetOverrides() : {};
  var toolIcons = toolOverrides.icons || [];
  var toolPatternIds = toolOverrides.targetPatternIds || [];

  var icons;
  if (toolIcons.length >= st.rowCount * st.colCount) {
    icons = toolIcons.slice();
  } else if (toolPatternIds.length > 0) {
    icons = ldDemoGenerateIconsForPattern(mathModel, toolPatternIds[0], st.activeLines);
  } else {
    icons = ldDemoGenerateIcons(mathModel);
  }

  // Calculate base wins
  var winResult = ldDemoCalcWins(icons, mathModel, st.activeLines, bet);
  var baseWon = winResult.totalWon;

  var multiplier = 0;
  var dragonMultiplierTriggered = false;
  var dragonSpinTriggered = false;
  var dragonSpinMultiplier = [];
  var isFreeSpin = _ldDemoFreeSpinsLeft > 0;

  if (isFreeSpin) {
    // FREE SPIN (Dragon Spin) mode:
    // - No DragonMultiplierFeature
    // - Always run DragonSpinFeature reel (but no re-trigger free spins)
    var spinFeature = ldGetFeatureConfig(mathModel, 'DragonSpinFeature');
    if (spinFeature) {
      var sReel = spinFeature.multiplier_reel || [];
      var sWeights = spinFeature.multiplier_reel_weight || [];
      var windowSize = spinFeature.column_count || 3;
      var pickedIdx = ldWeightedRandomIdx(sWeights);
      dragonSpinMultiplier = [];
      var spinSum = 0;
      for (var s = 0; s < windowSize; s++) {
        var val = sReel[(pickedIdx + s) % sReel.length];
        dragonSpinMultiplier.push(val);
        spinSum += val;
      }
      if (spinSum > 0) {
        baseWon = parseFloat((baseWon * spinSum).toFixed(2));
      }
    }
    var totalWon = baseWon;
    _ldDemoFreeSpinsLeft--;
    _ldDemoBalance = parseFloat((_ldDemoBalance + totalWon).toFixed(2));
    _ldDemoDragonSpinTotalWin = parseFloat((_ldDemoDragonSpinTotalWin + totalWon).toFixed(2));
  } else {
    // NORMAL SPIN mode:
    // DragonMultiplierFeature first
    var multFeature = ldGetFeatureConfig(mathModel, 'DragonMultiplierFeature');
    if (multFeature) {
      var mults = multFeature.multiplier || [];
      var mWeights = multFeature.multiplier_weight || [];
      var mIdx = ldWeightedRandomIdx(mWeights);
      multiplier = mults[mIdx] || 0;
      if (multiplier > 0) dragonMultiplierTriggered = true;
    }
    var totalWon = dragonMultiplierTriggered ? parseFloat((baseWon * multiplier).toFixed(2)) : baseWon;

    // DragonSpinFeature: only if DragonMultiplier did NOT trigger
    if (!dragonMultiplierTriggered) {
      var spinFeature = ldGetFeatureConfig(mathModel, 'DragonSpinFeature');
      if (spinFeature && Math.random() < (spinFeature.hit_rate || 0.1)) {
        dragonSpinTriggered = true;
        var sReel = spinFeature.multiplier_reel || [];
        var sWeights = spinFeature.multiplier_reel_weight || [];
        var windowSize = spinFeature.column_count || 3;
        var pickedIdx = ldWeightedRandomIdx(sWeights);
        dragonSpinMultiplier = [];
        var spinSum = 0;
        for (var s = 0; s < windowSize; s++) {
          var val = sReel[(pickedIdx + s) % sReel.length];
          dragonSpinMultiplier.push(val);
          spinSum += val;
        }
        if (spinSum > 0) {
          totalWon = parseFloat((totalWon * spinSum).toFixed(2));
        }
        // Calculate free spins
        var freeSpins = spinFeature.free_spin || [];
        var freeSpinWeights = spinFeature.free_spin_weight || [];
        if (freeSpins.length > 0) {
          var fsIdx = ldWeightedRandomIdx(freeSpinWeights);
          _ldDemoFreeSpinsLeft = freeSpins[fsIdx] || 0;
        }
      }
    }
    _ldDemoBalance = parseFloat((_ldDemoBalance - totalBet + totalWon).toFixed(2));
    _ldDemoDragonSpinTotalWin = dragonSpinTriggered ? totalWon : 0;
  }

  var resp = {
    cmd: isFreeSpin ? 'free_spin' : 'solicitajogada',
    triggered: dragonSpinTriggered, bonus_unique_id: '',
    aposta: bet, total_won: totalWon, remaining_amount: 0, bonus_type: '',
    bet_per_spin: 0, expire_time: 0, icons: icons, left_free_spin_amount: _ldDemoFreeSpinsLeft,
    won_pattern: winResult.wonPattern, current_amount: 0, features: [],
    balance: _ldDemoBalance, is_bonus_session: isFreeSpin, total_amount: 0,
    bonus_id: '', currency: 'coins', game_id: 2027,
    dragon_multiplier: multiplier,
    dragon_spin_triggered: dragonSpinTriggered,
    dragon_spin_multiplier: dragonSpinMultiplier,
    dragon_spin_total_win: _ldDemoDragonSpinTotalWin
  };

  st.reelIcons = icons.slice();
  playLog('<<< [DEMO SPIN] response: ' + JSON.stringify(resp));
  slotHandleSpinResponse(resp);
  // Start dragon reel + wheel spinning immediately (with main reels)
  ldStartFeatureSpinning(resp);
  // Show results after reels stop (~3.5s)
  setTimeout(function() { ldShowFeatureResults(resp); }, 3600);
}

function ldDemoSimulateRoundOver() {
  var resp = {
    cmd: 'finalizajogada', features: [], balance: _ldDemoBalance,
    total_won: 0, currency: 'coins', left_free_spin_amount: 0, game_id: 2027
  };
  playLog('<<< [DEMO ROUND OVER] response: ' + JSON.stringify(resp));
  slotHandleRoundOverResponse(resp);
}

// ===========================================================================
// Icon Generation & Win Calculation
// ===========================================================================
function ldDemoGenerateIcons(mathModel) {
  var reelIcons = mathModel.actual_reel_icons || [];
  var reelWeights = mathModel.actual_reel_weight || [];
  var rowCount = mathModel.row_count || 3;
  var colCount = mathModel.column_count || 3;
  var reelResults = [];
  for (var col = 0; col < colCount; col++) {
    var strip = reelIcons[col] || [1,2,3,4,5,6,7];
    var weights = reelWeights[col] || [];
    var startIdx = ldWeightedRandomIdx(weights);
    var colIcons = [];
    for (var row = 0; row < rowCount; row++) {
      colIcons.push(strip[(startIdx + row) % strip.length]);
    }
    reelResults.push(colIcons);
  }
  var flat = [];
  for (var row = 0; row < rowCount; row++) {
    for (var col = 0; col < colCount; col++) { flat.push(reelResults[col][row]); }
  }
  return flat;
}

function ldDemoGenerateIconsForPattern(mathModel, targetPatId, activeLines) {
  var patterns = mathModel.pattern || [];
  var lines = mathModel.lines || [];
  var lineDir = mathModel.line_direction || [];
  var rowCount = mathModel.row_count || 3;
  var colCount = mathModel.column_count || 3;
  var allIcons = mathModel.icon || [1,2,3,4,5,6,7];
  var targetPat = null;
  for (var i = 0; i < patterns.length; i++) { if (patterns[i].id === targetPatId) { targetPat = patterns[i]; break; } }
  if (!targetPat) return ldDemoGenerateIcons(mathModel);
  var eligibleLines = [];
  for (var li = 0; li < activeLines && li < lines.length; li++) {
    var dir = lineDir[li] || 1;
    if (targetPat.type === 0 || targetPat.type === dir) eligibleLines.push(li);
  }
  if (eligibleLines.length === 0) return ldDemoGenerateIcons(mathModel);
  var chosenLineIdx = eligibleLines[Math.floor(Math.random() * eligibleLines.length)];
  var chosenLine = lines[chosenLineIdx];
  var regex = /i-?\d+/g; var tokens = []; var m;
  while ((m = regex.exec(targetPat.format)) !== null) tokens.push(m[0]);
  var icons = [];
  for (var i = 0; i < rowCount * colCount; i++) icons.push(allIcons[Math.floor(Math.random() * allIcons.length)]);
  for (var p = 0; p < tokens.length && p < chosenLine.length; p++) {
    var token = tokens[p];
    if (token.indexOf('-') >= 0) continue;
    icons[chosenLine[p]] = parseInt(token.substring(1));
  }
  return icons;
}

function ldDemoCalcWins(icons, mathModel, activeLines, bet) {
  var lines = mathModel.lines || [];
  var lineDir = mathModel.line_direction || [];
  var patterns = mathModel.pattern || [];
  var totalWon = 0;
  var wonPatterns = [];
  for (var li = 0; li < activeLines && li < lines.length; li++) {
    var line = lines[li];
    var dir = lineDir[li] || 1;
    var lineIcons = [];
    for (var p = 0; p < line.length; p++) lineIcons.push(icons[line[p]]);
    var bestWin = 0; var bestPatFormat = '';
    for (var pi = 0; pi < patterns.length; pi++) {
      var pat = patterns[pi];
      if (pat.type !== 0 && pat.type !== dir) continue;
      if (ldMatchPattern(lineIcons, pat.format)) {
        var win = pat.value * bet;
        if (win > bestWin) { bestWin = win; bestPatFormat = pat.format; }
      }
    }
    if (bestWin > 0) {
      totalWon += bestWin;
      wonPatterns.push('[l' + (li + 1) + ',' + bestPatFormat + ']');
    }
  }
  return { totalWon: parseFloat(totalWon.toFixed(2)), wonPattern: wonPatterns.length > 0 ? wonPatterns.join(';') + ';' : '' };
}

function ldMatchPattern(lineIcons, format) {
  var regex = /i-?\d+/g; var tokens = []; var m;
  while ((m = regex.exec(format)) !== null) tokens.push(m[0]);
  if (tokens.length !== lineIcons.length) return false;
  var wildIcon = 1; // icon 1 (Tiger/Dragon) is wild in this game
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    if (token.indexOf('-') >= 0) continue;
    var requiredIcon = parseInt(token.substring(1));
    var actualIcon = lineIcons[i];
    if (actualIcon === requiredIcon) continue;
    if (actualIcon === wildIcon && requiredIcon !== wildIcon) continue;
    return false;
  }
  return true;
}

// ===========================================================================
// Utility Functions
// ===========================================================================
function ldGetFeatureConfig(mathModel, featureName) {
  var features = (mathModel.features && mathModel.features.lists) || [];
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf(featureName) >= 0) return features[i].config;
  }
  return null;
}

function ldWeightedPick(values, weights) {
  if (!values || values.length === 0) return 1;
  var total = 0;
  for (var i = 0; i < weights.length; i++) total += weights[i];
  var r = Math.random() * total; var sum = 0;
  for (var i = 0; i < weights.length; i++) { sum += weights[i]; if (r <= sum) return values[i]; }
  return values[values.length - 1];
}

function ldWeightedRandomIdx(weights) {
  if (!weights || weights.length === 0) return Math.floor(Math.random() * 7);
  var total = 0;
  for (var i = 0; i < weights.length; i++) total += weights[i];
  var r = Math.random() * total; var sum = 0;
  for (var i = 0; i < weights.length; i++) { sum += weights[i]; if (r <= sum) return i; }
  return weights.length - 1;
}

// ===========================================================================
// Hook: Intercept machine click for DEMO choice
// ===========================================================================
(function() {
  var origSelectMachine = window.playSelectMachine;
  if (!origSelectMachine) return;
  var prevHook = window.playSelectMachine;
  window.playSelectMachine = function(machineId, enabled, machineType) {
    if (machineId === 2027) {
      if (!enabled) { showAlert('Coming soon'); return; }
      ldShowDemoChoiceModal(function(isDemo) {
        if (isDemo) {
          playShowLoading('Loading DEMO...');
          fetch('/play/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({machine_id: machineId}) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            _ldDemoConfig = data.config || {};
            ldDemoSimulateLogin();
            ldDemoHookSpin();
          })
          .catch(function() { playHideLoading(); showAlert('Failed to load config'); });
        } else {
          prevHook(machineId, enabled, machineType);
        }
      });
    } else {
      prevHook(machineId, enabled, machineType);
    }
  };
})();

function ldShowDemoChoiceModal(onChoice) {
  var overlay = document.createElement('div');
  overlay.id = 'ldDemoChoiceModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML =
    '<div style="background:#1a1a2e;border-radius:12px;padding:28px;border:2px solid #e74c3c;text-align:center;min-width:300px;">' +
    '<div style="font-size:18px;font-weight:700;color:#e74c3c;margin-bottom:6px;">🐉 LuckyDragon</div>' +
    '<div style="font-size:12px;color:#aaa;margin-bottom:20px;">Choose play mode</div>' +
    '<div style="display:flex;gap:16px;justify-content:center;">' +
    '<button onclick="ldDemoChoiceSelect(true)" style="background:linear-gradient(180deg,#ffd700,#ff8c00);color:#000;border:none;border-radius:8px;padding:12px 28px;cursor:pointer;font-size:14px;font-weight:700;">DEMO</button>' +
    '<button onclick="ldDemoChoiceSelect(false)" style="background:linear-gradient(180deg,#4a90d9,#2a6ab9);color:#fff;border:none;border-radius:8px;padding:12px 28px;cursor:pointer;font-size:14px;font-weight:700;">NORMAL</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
  window._ldDemoChoiceCallback = onChoice;
}

function ldDemoChoiceSelect(isDemo) {
  _ldDemoMode = isDemo;
  _ldDemoBalance = 10000.00;
  var modal = document.getElementById('ldDemoChoiceModal');
  if (modal) modal.remove();
  if (window._ldDemoChoiceCallback) window._ldDemoChoiceCallback(isDemo);
}

var _ldOrigSlotSpin = null;
function ldDemoHookSpin() {
  if (_ldOrigSlotSpin) return;
  _ldOrigSlotSpin = window.slotSpin;
  window.slotSpin = function() {
    if (_ldDemoMode && _playCurrentMachine && _playCurrentMachine.name === 'LuckyDragon') {
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
      setTimeout(function() { ldDemoSimulateSpin(); }, 3500);
    } else {
      _ldOrigSlotSpin();
    }
  };
}

// ===========================================================================
// Custom UI: Dragon image + Dragon Spin Reel + Wheel
// ===========================================================================
function ldBuildCustomUI(config) {
  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;
  var imgBase = '/static/machine/LuckyDragon/item/';
  var mathModel = (config && config.math_model && config.math_model[0]) || {};
  var spinFeature = ldGetFeatureConfig(mathModel, 'DragonSpinFeature');
  var multiplierReel = (spinFeature && spinFeature.multiplier_reel) || [];

  // Dragon image: bottom aligned with reel top (50% of previous 600px = 300px)
  var dragonEl = document.createElement('div');
  dragonEl.id = 'ldDragonArea';
  dragonEl.style.cssText = 'position:absolute;bottom:70%;left:50%;transform:translateX(-50%);width:300px;height:auto;z-index:50;pointer-events:none;';
  dragonEl.innerHTML = '<img src="' + imgBase + 'dragon.png" style="width:100%;height:auto;object-fit:contain;display:block;">';
  slotSkin.appendChild(dragonEl);

  // Dragon spin reel area (below dragon image, lower z-index so dragon covers it partially)
  var reelArea = document.createElement('div');
  reelArea.id = 'ldDragonReelArea';
  reelArea.style.cssText = 'position:absolute;top:19%;left:50%;transform:translateX(-50%);width:180px;height:30px;overflow:hidden;border-radius:4px;border:2px solid #ffd700;background:#1a0a0a;z-index:40;display:none;';
  var stripHtml = '<div id="ldDragonReelStrip" style="display:flex;transition:transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94);white-space:nowrap;">';
  for (var rep = 0; rep < 3; rep++) {
    for (var i = 0; i < multiplierReel.length; i++) {
      stripHtml += '<div style="min-width:60px;height:30px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:' + (multiplierReel[i] > 0 ? '#ffd700' : '#555') + ';">' + (multiplierReel[i] > 0 ? 'x' + multiplierReel[i] : '-') + '</div>';
    }
  }
  stripHtml += '</div>';
  reelArea.innerHTML = stripHtml;
  slotSkin.appendChild(reelArea);

  // Wheel area: above controls with enough gap (top:68% to avoid overlap with BET/LINE/SPIN at ~80%)
  var wheelArea = document.createElement('div');
  wheelArea.id = 'ldWheelArea';
  wheelArea.style.cssText = 'position:absolute;top:65%;left:50%;transform:translateX(-50%);width:80px;height:80px;z-index:50;';
  wheelArea.innerHTML = '<img id="ldWheelImg" src="' + imgBase + 'wheel.png" style="width:100%;height:100%;object-fit:contain;">';
  slotSkin.appendChild(wheelArea);
}

// ===========================================================================
// Feature Animations after spin
// ===========================================================================
function ldStartFeatureSpinning(resp) {
  // Start wheel spinning immediately
  var wheel = document.getElementById('ldWheelImg');
  if (wheel) {
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    setTimeout(function() {
      wheel.style.transition = 'transform 3s ease-in-out';
      wheel.style.transform = 'rotate(720deg)';
    }, 20);
  }

  // Start dragon reel spinning if in free spin or dragon spin triggered
  if ((resp.dragon_spin_multiplier && resp.dragon_spin_multiplier.length > 0) || resp.dragon_spin_triggered) {
    var reelArea = document.getElementById('ldDragonReelArea');
    var strip = document.getElementById('ldDragonReelStrip');
    if (reelArea && strip) {
      reelArea.style.display = '';
      // Rapid scroll animation (spinning)
      strip.style.transition = 'none';
      strip.style.transform = 'translateX(0)';
      setTimeout(function() {
        strip.style.transition = 'transform 3s linear';
        strip.style.transform = 'translateX(-1200px)';
      }, 20);
    }
  }
}

function ldShowFeatureResults(resp) {
  var reelArea = document.getElementById('ldDragonReelArea');

  // Stop dragon reel at correct position
  if (resp.dragon_spin_multiplier && resp.dragon_spin_multiplier.length > 0) {
    ldStopDragonReel(resp.dragon_spin_multiplier, function() {
      // Show multiplier effect from wheel
      var mult = resp.dragon_multiplier || 0;
      if (mult > 0) ldShowMultiplierEffect(mult);
      // Update free spin button
      if (resp.left_free_spin_amount > 0) {
        ldUpdateSpinBtn();
      } else if (resp.left_free_spin_amount === 0 && resp.cmd === 'free_spin') {
        if (reelArea) reelArea.style.display = 'none';
        ldUpdateSpinBtn();
      }
    });
  } else {
    // Normal spin: just show multiplier effect
    var mult = resp.dragon_multiplier || 0;
    if (mult > 0) ldShowMultiplierEffect(mult);
    if (resp.dragon_spin_triggered && resp.left_free_spin_amount > 0) {
      ldUpdateSpinBtn();
    }
    if (_ldDemoFreeSpinsLeft <= 0 && reelArea) reelArea.style.display = 'none';
  }
}

function ldStopDragonReel(spinResult, onComplete) {
  var strip = document.getElementById('ldDragonReelStrip');
  if (!strip) { if (onComplete) onComplete(); return; }

  var cellWidth = 60;
  var config = _ldDemoConfig || (_playCurrentMachine && _playCurrentMachine.config);
  var mathModel = (config && config.math_model && config.math_model[0]) || {};
  var spinFeature = ldGetFeatureConfig(mathModel, 'DragonSpinFeature');
  var reel = (spinFeature && spinFeature.multiplier_reel) || [];
  var reelLen = reel.length;

  // Find target index matching spinResult
  var targetIdx = 0;
  for (var i = 0; i < reelLen; i++) {
    var match = true;
    for (var j = 0; j < spinResult.length; j++) {
      if (reel[(i + j) % reelLen] !== spinResult[j]) { match = false; break; }
    }
    if (match) { targetIdx = i; break; }
  }

  // Stop at target position
  var offset = (reelLen + targetIdx) * cellWidth;
  strip.style.transition = 'transform 0.8s cubic-bezier(0.2, 0, 0.2, 1)';
  strip.style.transform = 'translateX(-' + offset + 'px)';

  var spinSum = 0;
  for (var i = 0; i < spinResult.length; i++) spinSum += spinResult[i];

  setTimeout(function() {
    if (spinSum > 0) {
      ldShowMultiplierEffect(spinSum);
      setTimeout(function() { if (onComplete) onComplete(); }, 1500);
    } else {
      if (onComplete) onComplete();
    }
  }, 1000);
}

function ldShowMultiplierEffect(multiplier) {
  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;
  var effect = document.createElement('div');
  effect.style.cssText = 'position:absolute;top:65%;left:50%;transform:translateX(-50%);z-index:100;font-size:40px;font-weight:900;color:#ffd700;text-shadow:0 0 20px rgba(255,215,0,0.8),0 2px 4px #000;transition:top 1s ease-out, font-size 1s ease-out, opacity 0.5s 1s;opacity:1;pointer-events:none;';
  effect.textContent = 'x' + multiplier;
  slotSkin.appendChild(effect);
  setTimeout(function() { effect.style.top = '40%'; effect.style.fontSize = '52px'; }, 50);
  setTimeout(function() { effect.style.opacity = '0'; }, 1500);
  setTimeout(function() { effect.remove(); }, 2200);
}

function ldUpdateSpinBtn() {
  var spinBtn = document.getElementById('slotSpinBtn');
  if (!spinBtn) return;
  var span = spinBtn.querySelector('span');
  if (_ldDemoFreeSpinsLeft > 0) {
    if (span) span.textContent = _ldDemoFreeSpinsLeft + ' FREE';
    spinBtn.style.opacity = '1';
    spinBtn.style.pointerEvents = 'auto';
  } else {
    if (span) span.textContent = 'SPIN';
    spinBtn.style.opacity = '1';
    spinBtn.style.pointerEvents = 'auto';
  }
}
