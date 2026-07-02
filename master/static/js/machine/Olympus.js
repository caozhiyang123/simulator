// ---------------------------------------------------------------------------
// Olympus Machine Plugin (Slot with background skin)
// Uses slot engine with custom skin and win animation.
// Free spin by bet support.
// ---------------------------------------------------------------------------
MachineRegistry.register('Olympus', {
  type: 'slot',

  assets: {
    background: '/static/machine/Olympus/background/Olympus.png',
    pattern: '/static/machine/Olympus/background/pattern/Olympus.png',
    icons: '/static/machine/Olympus/icon/'
  },

  afterRender: function(resp, config) {
    // Store free spin by bet data
    if (resp.left_free_spin_by_bet) {
      _olympusFreeSpinByBet = resp.left_free_spin_by_bet;
    }
    // Auto-switch to bet with free spins
    olympusAutoSwitchToFreeSpinBet();
    // Update free spin state for current bet
    olympusUpdateFreeSpinFromBet();
    // Hook bet/line change
    olympusHookBetChange();
  },

  onSpinResponse: function(resp) {
    // Update free spin count from response
    if (resp.left_free_spin_amount !== undefined) {
      _olympusFreeSpinsLeft = resp.left_free_spin_amount;
    }
    // Default slot handling
    slotHandleSpinResponse(resp);
    // Update SPIN button after reels stop
    setTimeout(function() {
      olympusUpdateSpinBtn();
    }, 3500);
  }
});

// ===========================================================================
// Olympus Free Spin By Bet
// ===========================================================================
var _olympusFreeSpinByBet = [];
var _olympusFreeSpinsLeft = 0;

function olympusAutoSwitchToFreeSpinBet() {
  var st = _slotState;
  if (!_olympusFreeSpinByBet || _olympusFreeSpinByBet.length === 0) return;
  var target = null;
  for (var i = 0; i < _olympusFreeSpinByBet.length; i++) {
    if (_olympusFreeSpinByBet[i].free_spin > 0) { target = _olympusFreeSpinByBet[i]; break; }
  }
  if (!target) return;
  // Switch bet
  for (var i = 0; i < st.betList.length; i++) {
    if (Math.abs(st.betList[i] - target.bet) < 0.0001) { st.betIndex = i; break; }
  }
  // Switch lines
  st.activeLines = target.lines || st.activeLines;
  // Update displays
  var betEl = document.getElementById('slotBetDisplay');
  if (betEl) betEl.textContent = (st.betList[st.betIndex] * st.activeLines).toFixed(st.displayPrecision);
  var linesEl = document.getElementById('slotLinesDisplay');
  if (linesEl) linesEl.textContent = st.activeLines;
}

function olympusUpdateFreeSpinFromBet() {
  var st = _slotState;
  var bet = (st.betList && st.betList[st.betIndex]) || 0.01;
  var lines = st.activeLines || 20;
  _olympusFreeSpinsLeft = 0;
  for (var i = 0; i < _olympusFreeSpinByBet.length; i++) {
    var e = _olympusFreeSpinByBet[i];
    if (Math.abs(e.bet - bet) < 0.0001 && e.lines === lines) {
      _olympusFreeSpinsLeft = e.free_spin || 0; break;
    }
  }
  olympusUpdateSpinBtn();
}

function olympusUpdateSpinBtn() {
  var spinBtn = document.getElementById('slotSpinBtn');
  if (!spinBtn) return;
  var span = spinBtn.querySelector('span');
  if (_olympusFreeSpinsLeft > 0) {
    if (span) span.textContent = _olympusFreeSpinsLeft + ' FREE';
    spinBtn.onclick = function() { olympusSendFreeSpin(); };
  } else {
    if (span) span.textContent = 'SPIN';
    spinBtn.onclick = function() { slotSpin(); };
  }
}

function olympusHookBetChange() {
  var origBet = window.slotChangeBet;
  var origLines = window.slotChangeLines;
  window.slotChangeBet = function(dir) {
    origBet(dir);
    olympusUpdateFreeSpinFromBet();
  };
  if (origLines) {
    window.slotChangeLines = function(dir) {
      origLines(dir);
      olympusUpdateFreeSpinFromBet();
    };
  }
}

function olympusSendFreeSpin() {
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
  playLog('>>> [OLYMPUS FREE SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}
