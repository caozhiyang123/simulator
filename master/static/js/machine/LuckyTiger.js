// ---------------------------------------------------------------------------
// LuckyTiger Machine Plugin (Slot)
// 3x3 slot, 7 icons, 5 lines.
// Bonus stage: when bonus_stage=true, sends free_spin until bonus_over=true.
// ---------------------------------------------------------------------------
MachineRegistry.register('LuckyTiger', {
  type: 'slot',

  afterRender: function(resp, config) {
    // Check if already in bonus stage from login
    if (resp.bonus_stage === true && resp.bonus_over === false) {
      _ltBonus.active = true;
      _ltBonus.bonusIcon = resp.bonus_icon || 0;
      _ltBonus.totalPrize = resp.total_bonus_prize || 0;
      _ltBonus.bet = resp.aposta || (_slotState.betList && _slotState.betList[_slotState.betIndex]) || 0.01;
      _ltBonus.lines = resp.lines || [];

      // Set bet/lines to match bonus state
      luckyTigerSetBonusBetLines(resp);

      // Display the icons from last round on reels
      if (resp.icons && resp.icons.length > 0) {
        _slotState.reelIcons = resp.icons.slice();
        // Force update reel display to show these icons
        luckyTigerForceReelDisplay(resp.icons);
      }

      luckyTigerShowBonusUI();
      luckyTigerUpdateSpinBtn();
    }
    // Hook bet/line change to block during bonus
    luckyTigerHookBetLineChange();
  },

  onSpinResponse: function(resp) {
    // Default slot handling
    slotHandleSpinResponse(resp);

    // After reels stop, handle bonus state
    setTimeout(function() {
      if (resp.bonus_stage === true) {
        _ltBonus.active = true;
        _ltBonus.bonusIcon = resp.bonus_icon || 0;
        _ltBonus.totalPrize = resp.total_bonus_prize || 0;
        luckyTigerShowBonusUI();

        if (resp.bonus_over === true) {
          // Bonus complete
          luckyTigerBonusComplete();
        } else {
          // More free spins in bonus — update SPIN button
          luckyTigerUpdateSpinBtn();
        }
      } else {
        // Not in bonus stage — normal
        _ltBonus.active = false;
        luckyTigerHideBonusUI();
        luckyTigerResetSpinBtn();
      }
      // Check X10 multiplier: if all hit_lines are won, show X10 effect
      luckyTigerCheckX10(resp);
    }, 3500);
  }
});

// ===========================================================================
// LuckyTiger Bonus State
// ===========================================================================
var _ltBonus = {
  active: false,
  bonusIcon: 0,
  totalPrize: 0,
  bet: 0.01,
  lines: []
};

/**
 * Set bet and lines to match the bonus state from login.
 */
function luckyTigerSetBonusBetLines(resp) {
  var st = _slotState;
  var bonusBet = resp.aposta || 0.01;
  // Find matching bet index
  for (var i = 0; i < st.betList.length; i++) {
    if (Math.abs(st.betList[i] - bonusBet) < 0.0001) { st.betIndex = i; break; }
  }
  // Set active lines
  if (resp.lines && resp.lines.length > 0) {
    st.activeLines = resp.lines.length;
  }
  // Update displays
  var betEl = document.getElementById('slotBetDisplay');
  if (betEl) betEl.textContent = (st.betList[st.betIndex] * st.activeLines).toFixed(st.displayPrecision);
  var linesEl = document.getElementById('slotLinesDisplay');
  if (linesEl) linesEl.textContent = st.activeLines;
}

/**
 * Hook bet/line change to block during bonus stage.
 */
function luckyTigerHookBetLineChange() {
  var origBet = window.slotChangeBet;
  var origLines = window.slotChangeLines;
  window.slotChangeBet = function(dir) {
    if (_ltBonus.active) return; // block during bonus
    origBet(dir);
  };
  if (origLines) {
    window.slotChangeLines = function(dir) {
      if (_ltBonus.active) return; // block during bonus
      origLines(dir);
    };
  }
}

/**
 * Force update reel strips to display the given icons (used on login to restore bonus state).
 */
function luckyTigerForceReelDisplay(icons) {
  var st = _slotState;
  var colCount = st.colCount || 3;
  var rowCount = st.rowCount || 3;
  var mn = st.machineName || 'LuckyTiger';
  var cellHeight = 80;

  for (var col = 0; col < colCount; col++) {
    var wrapper = document.querySelector('#slotReelsContainer .slot-reel-wrapper[data-col="' + col + '"]');
    if (!wrapper) continue;
    var strip = wrapper.querySelector('.slot-reel-strip');
    if (!strip) continue;

    // Rebuild strip to show just the visible icons
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    var html = '';
    for (var row = 0; row < rowCount; row++) {
      var idx = row * colCount + col;
      var iconId = icons[idx];
      html += '<div style="width:100%;height:' + cellHeight + 'px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
      html += '<img src="/static/machine/' + mn + '/icon/i' + iconId + '.png" style="width:100%;height:100%;object-fit:fill;" onerror="this.style.opacity=0">';
      html += '</div>';
    }
    strip.innerHTML = html;
  }
}

/**
 * Show bonus stage UI (status bar with icon and total prize).
 */
function luckyTigerShowBonusUI() {
  var el = document.getElementById('ltBonusBar');
  if (!el) {
    var slotSkin = document.getElementById('slotSkin');
    if (!slotSkin) return;
    el = document.createElement('div');
    el.id = 'ltBonusBar';
    el.style.cssText = 'position:absolute;top:8%;left:15%;width:70%;background:rgba(0,0,0,0.7);border:2px solid #f39c12;border-radius:8px;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;z-index:10;';
    slotSkin.appendChild(el);
  }
  var mn = _slotState.machineName || 'LuckyTiger';
  el.innerHTML = '<span style="color:#f39c12;font-size:11px;font-weight:700;">🐯 BONUS STAGE</span>' +
    '<span style="color:#fff;font-size:11px;">Icon: <img src="/static/machine/' + mn + '/icon/i' + _ltBonus.bonusIcon + '.png" style="width:16px;height:16px;vertical-align:middle;" onerror="this.outerHTML=\'i' + _ltBonus.bonusIcon + '\'"></span>' +
    '<span id="ltBonusPrize" style="color:#2ecc71;font-size:11px;font-weight:700;">Won: ' + _ltBonus.totalPrize.toFixed(2) + '</span>';
}

/**
 * Hide bonus stage UI.
 */
function luckyTigerHideBonusUI() {
  var el = document.getElementById('ltBonusBar');
  if (el) el.remove();
}

/**
 * Update SPIN button to show FREE SPIN during bonus stage.
 */
function luckyTigerUpdateSpinBtn() {
  var spinBtn = document.getElementById('slotSpinBtn');
  if (!spinBtn) return;
  var span = spinBtn.querySelector('span');
  if (span) span.textContent = 'FREE';
  spinBtn.style.opacity = '1';
  spinBtn.style.pointerEvents = '';
  spinBtn.onclick = function() { luckyTigerSendFreeSpin(); };
}

/**
 * Reset SPIN button to normal.
 */
function luckyTigerResetSpinBtn() {
  var spinBtn = document.getElementById('slotSpinBtn');
  if (!spinBtn) return;
  var span = spinBtn.querySelector('span');
  if (span) span.textContent = 'SPIN';
  spinBtn.onclick = function() { slotSpin(); };
}

/**
 * Send free_spin request during bonus stage.
 */
function luckyTigerSendFreeSpin() {
  var st = _slotState;
  if (st.spinning) return;
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { showAlert('Not connected'); return; }
  st.spinning = true;
  var btn = document.getElementById('slotSpinBtn');
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
  document.getElementById('slotWinDisplay').textContent = '';
  var winAmtEl = document.getElementById('slotWinAmount');
  if (winAmtEl) winAmtEl.textContent = '0.00';
  slotClearAllLines();
  slotStartReelAnimation();

  var bet = st.betList[st.betIndex] || 0.01;
  var linesStr = '';
  for (var i = 0; i < st.maxLines; i++) linesStr += (i < st.activeLines ? '1' : '0');

  var toolOverrides = slotSpinToolGetOverrides();

  var cmd = {
    cmd: 'free_spin',
    session_token: st.sessionToken,
    game_id: st.machineId,
    currency: st.currency,
    opt_id: st.loginResp.opt_id || '',
    username: st.loginResp.username || '',
    aposta: bet,
    lines: linesStr,
    bonus_unique_id: '',
    is_bonus: false,
    icons: toolOverrides.icons || [],
    target_pattern_ids: toolOverrides.targetPatternIds || [],
    target_feature_ids: toolOverrides.targetFeatureIds || [],
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [LT FREE SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

/**
 * Bonus stage complete — show total prize and reset.
 */
function luckyTigerBonusComplete() {
  playLog('🐯 [BONUS] complete, total prize: ' + _ltBonus.totalPrize);

  // Show celebration
  var slotSkin = document.getElementById('slotSkin');
  if (slotSkin) {
    var overlay = document.createElement('div');
    overlay.id = 'ltBonusOverlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:50;display:flex;align-items:center;justify-content:center;flex-direction:column;border-radius:12px;';
    overlay.innerHTML = '<div style="color:#f39c12;font-size:18px;font-weight:700;">🐯 BONUS COMPLETE! 🐯</div>' +
      '<div style="color:#fff;font-size:32px;font-weight:900;margin-top:8px;text-shadow:0 0 16px #f39c12;">+ ' + _ltBonus.totalPrize.toFixed(2) + '</div>';
    slotSkin.appendChild(overlay);

    setTimeout(function() {
      var o = document.getElementById('ltBonusOverlay');
      if (o) o.remove();
      _ltBonus.active = false;
      luckyTigerHideBonusUI();
      luckyTigerResetSpinBtn();
    }, 2500);
  }
}


// ===========================================================================
// LuckyTiger X10 Multiplier Feature
// If all hit_lines [1,2,3] are in won_pattern, show X10 effect.
// ===========================================================================
function luckyTigerCheckX10(resp) {
  if (!resp.won_pattern) return;

  // Get X10MultiplierFeature config
  var hitLines = [];
  var payout = 10;
  if (_playCurrentMachine && _playCurrentMachine.config) {
    var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
    var features = (mathModel.features && mathModel.features.lists) || [];
    for (var i = 0; i < features.length; i++) {
      if (features[i].reference && features[i].reference.indexOf('X10MultiplierFeature') >= 0) {
        hitLines = (features[i].config && features[i].config.hit_lines) || [];
        payout = (features[i].config && features[i].config.payout) || 10;
        break;
      }
    }
  }
  if (hitLines.length === 0) return;

  // Parse won lines from won_pattern
  var wonPattern = resp.won_pattern || '';
  var wonLines = [];
  var matches = wonPattern.match(/l(\d+)/g);
  if (matches) {
    for (var i = 0; i < matches.length; i++) {
      var lineNum = parseInt(matches[i].substring(1));
      if (wonLines.indexOf(lineNum) < 0) wonLines.push(lineNum);
    }
  }

  // Check if ALL hit_lines are in wonLines
  var allHit = true;
  for (var i = 0; i < hitLines.length; i++) {
    if (wonLines.indexOf(hitLines[i]) < 0) { allHit = false; break; }
  }

  if (allHit) {
    luckyTigerShowX10Effect(payout);
  }
}

function luckyTigerShowX10Effect(payout) {
  playLog('🐯 [X10] All hit lines matched! Payout X' + payout);

  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;

  var effect = document.createElement('div');
  effect.style.cssText = 'position:absolute;top:40%;left:50%;transform:translate(-50%,-50%) scale(0.5);z-index:200;pointer-events:none;color:#f39c12;font-size:56px;font-weight:900;text-shadow:0 0 20px #f39c12,0 0 40px #e74c3c,0 2px 6px rgba(0,0,0,0.8);';
  effect.textContent = 'X' + payout;
  slotSkin.appendChild(effect);

  effect.animate([
    { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.5 },
    { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: 0.75 },
    { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 0 }
  ], { duration: 2500, easing: 'ease-out', fill: 'forwards' }).onfinish = function() {
    effect.remove();
  };
}
