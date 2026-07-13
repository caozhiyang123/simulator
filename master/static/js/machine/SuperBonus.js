// ---------------------------------------------------------------------------
// SuperBonus Machine Plugin (Bingo)
// 5x3 cards, overlap_win, FreeSpinFeature (bet-only binding).
// ---------------------------------------------------------------------------
MachineRegistry.register('SuperBonus', {
  type: 'bingo',

  afterRender: function(resp, config) {
    // Store free spin by bet data from login
    if (resp.left_free_spin_by_bet) {
      _sbFreeSpinByBet = resp.left_free_spin_by_bet;
    }
    sbUpdateFreeSpinFromBet();
    sbHookBetChange();
  },

  onSpinResponse: function(resp) {
    // Update free spin count from spin/free_spin response
    if (resp.left_free_spin_amount !== undefined) {
      _sbFreeSpinsLeft = resp.left_free_spin_amount;
      // Update stored by-bet data
      var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
      var found = false;
      for (var i = 0; i < _sbFreeSpinByBet.length; i++) {
        if (Math.abs(_sbFreeSpinByBet[i].bet - bet) < 0.0001) {
          _sbFreeSpinByBet[i].free_spin = resp.left_free_spin_amount;
          found = true; break;
        }
      }
      if (!found && resp.left_free_spin_amount > 0) {
        _sbFreeSpinByBet.push({ bet: bet, free_spin: resp.left_free_spin_amount });
      }
    }
    // Default bingo spin handling
    playHandleSpinResponse(resp);
  },

  onRoundOver: function(resp) {
    // Update free spin count from round over response
    if (resp.left_free_spin_amount !== undefined) {
      _sbFreeSpinsLeft = resp.left_free_spin_amount;
      var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
      var found = false;
      for (var i = 0; i < _sbFreeSpinByBet.length; i++) {
        if (Math.abs(_sbFreeSpinByBet[i].bet - bet) < 0.0001) {
          _sbFreeSpinByBet[i].free_spin = resp.left_free_spin_amount;
          found = true; break;
        }
      }
      if (!found && resp.left_free_spin_amount > 0) {
        _sbFreeSpinByBet.push({ bet: bet, free_spin: resp.left_free_spin_amount });
      }
    }
    playHandleRoundOverResponse(resp);
    // After round over resets SPIN button, override if free spins remain
    sbUpdateSpinBtn();
  }
});

// ===========================================================================
// SuperBonus Free Spin By Bet (bet-only, no card binding)
// ===========================================================================
var _sbFreeSpinByBet = [];
var _sbFreeSpinsLeft = 0;

function sbUpdateFreeSpinFromBet() {
  var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
  _sbFreeSpinsLeft = 0;
  for (var i = 0; i < _sbFreeSpinByBet.length; i++) {
    if (Math.abs(_sbFreeSpinByBet[i].bet - bet) < 0.0001) {
      _sbFreeSpinsLeft = _sbFreeSpinByBet[i].free_spin || 0;
      break;
    }
  }
  sbUpdateSpinBtn();
}

function sbUpdateSpinBtn() {
  var spinBtn = document.getElementById('playSpinBtn');
  if (!spinBtn) return;
  var span = spinBtn.querySelector('span');
  if (_sbFreeSpinsLeft > 0) {
    if (span) span.textContent = _sbFreeSpinsLeft + ' FREE';
    spinBtn.onclick = function() { sbSendFreeSpin(); };
  } else {
    if (span) span.textContent = 'SPIN';
    spinBtn.onclick = function() { playSpin(); };
  }
}

function sbHookBetChange() {
  var origChangeBet = window.playChangeBet;
  if (origChangeBet) {
    window.playChangeBet = function(dir) {
      origChangeBet(dir);
      sbUpdateFreeSpinFromBet();
    };
  }
}

function sbSendFreeSpin() {
  if (!_playSessionToken || !_playCurrentMachine) { showAlert('Not connected'); return; }
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { showAlert('WebSocket not connected'); return; }

  var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
  var resp = _playCurrentMachine.response;
  var qtd = resp.qtd || 4;
  var activeCards = window._playActiveCards || qtd;
  var cardIdx = [];
  for (var i = 1; i <= activeCards; i++) cardIdx.push(i);

  _playSpinState = 'spinning';
  var spinBtn = document.getElementById('playSpinBtn');
  if (spinBtn) {
    spinBtn.querySelector('span').textContent = 'STOP';
    spinBtn.onclick = function() { _playStopRequested = true; };
  }
  document.getElementById('playWinDisplay').textContent = 'FREE SPIN...';

  // No balance deduction for free spin

  var toolOverrides = (typeof bingoSpinToolGetOverrides === 'function') ? bingoSpinToolGetOverrides() : {};
  var targetPatterns = (toolOverrides.targetPatternIds && toolOverrides.targetPatternIds.length) ? toolOverrides.targetPatternIds : [];
  var targetFeatures = (toolOverrides.targetFeatureIds && toolOverrides.targetFeatureIds.length) ? toolOverrides.targetFeatureIds : [];
  var targetBalls = (toolOverrides.balls && toolOverrides.balls.length) ? toolOverrides.balls : [];

  var cmd = {
    cmd: 'free_spin',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    aposta: bet,
    card_idx: cardIdx,
    bonus_unique_id: '',
    is_bonus: false,
    target_pattern_ids: targetPatterns,
    target_feature_ids: targetFeatures,
    payload_data: "[{'key':'value'}]"
  };
  if (targetBalls.length) cmd.balls = targetBalls;
  playLog('>>> [SUPERBONUS FREE SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}
