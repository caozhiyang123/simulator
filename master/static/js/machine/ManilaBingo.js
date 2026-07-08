// ---------------------------------------------------------------------------
// ManilaBingo Machine Plugin (Bingo)
// 5x3 cards, max 20 cards, overlap_win pattern matching.
// Mister Champion progress bar feature.
// ---------------------------------------------------------------------------
MachineRegistry.register('ManilaBingo', {
  type: 'bingo',

  afterRender: function(resp, config) {
    // Parse mister champion data from login
    if (resp.mister_champion_setting) {
      _mcState.settings = resp.mister_champion_setting;
    }
    if (resp.mister_champion_spent) {
      _mcState.spentByBet = resp.mister_champion_spent;
    }
    _mcState.triggerRate = resp.mister_champion_trigger_rate || '0';
    _mcState.countDownSecond = resp.mister_champion_count_down_second || 1;

    // Initialize current progress for active bet
    mcUpdateCurrentFromBet();
    mcRenderProgressBar();
    mcStartCountDown();
  },

  onSpinResponse: function(resp) {
    // Update progress from spin/eb response
    if (resp.mister_champion_spent_current !== undefined) {
      _mcState.current = resp.mister_champion_spent_current;
      mcUpdateProgressDisplay();
    }
    // Check if mister champion bonus triggered
    if (resp.mister_champion_card && resp.mister_champion_card.length > 0) {
      // Show bonus after a short delay
      setTimeout(function() {
        mcShowBonusGame(resp.mister_champion_card, resp.mister_champion_balls || [], resp.mister_champion_bingoPrize || 0);
      }, 800);
    }
    // Normal bingo handling
    playHandleSpinResponse(resp);
  }
});

// ===========================================================================
// ManilaBingo Mister Champion State
// ===========================================================================
var _mcState = {
  settings: [],       // [{bet, max, count_down_delta, target}]
  spentByBet: [],     // [{bet, spent}]
  triggerRate: '0',
  countDownSecond: 1,
  current: 0,         // current progress value
  currentMax: 100,
  currentTarget: 50,
  countDownTimer: null
};

/**
 * Find current bet's progress from spentByBet.
 */
function mcUpdateCurrentFromBet() {
  var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;

  // Find spent for current bet
  _mcState.current = 0;
  for (var i = 0; i < _mcState.spentByBet.length; i++) {
    if (Math.abs(_mcState.spentByBet[i].bet - bet) < 0.0001) {
      _mcState.current = _mcState.spentByBet[i].spent || 0;
      break;
    }
  }

  // Find setting for current bet
  _mcState.currentMax = 100;
  _mcState.currentTarget = 50;
  for (var i = 0; i < _mcState.settings.length; i++) {
    if (Math.abs(_mcState.settings[i].bet - bet) < 0.0001) {
      _mcState.currentMax = _mcState.settings[i].max || 100;
      _mcState.currentTarget = _mcState.settings[i].target || 50;
      break;
    }
  }
}

/**
 * Render the progress bar in the game area.
 */
function mcRenderProgressBar() {
  var old = document.getElementById('mcProgressBar');
  if (old) old.remove();

  var gameArea = document.getElementById('playGameArea');
  if (!gameArea) return;

  var bar = document.createElement('div');
  bar.id = 'mcProgressBar';
  bar.style.cssText = 'margin-bottom:8px;padding:6px 12px;background:#1a1a2e;border:1px solid #555;border-radius:6px;';

  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
      '<span style="color:#f39c12;font-size:10px;font-weight:700;">🏆 Champion</span>' +
      '<span id="mcTriggerRate" style="color:#4fc3f7;font-size:9px;">Rate: ' + _mcState.triggerRate + '%</span>' +
      '<span id="mcCurrentVal" style="color:#aaa;font-size:9px;margin-left:auto;">' + _mcState.current.toFixed(2) + ' / ' + _mcState.currentMax + '</span>' +
    '</div>' +
    '<div style="width:100%;height:12px;background:#222;border-radius:6px;position:relative;">' +
      '<div id="mcTargetLine" style="position:absolute;left:' + (_mcState.currentTarget / _mcState.currentMax * 100) + '%;top:0;width:2px;height:100%;background:#fff;opacity:0.6;z-index:2;"></div>' +
      '<div id="mcBarFill" style="height:100%;border-radius:6px;transition:width 0.2s,background 0.2s;"></div>' +
      '<img id="mcBarIcon" src="/static/machine/ManilaBingo/icon/bar.png" style="position:absolute;top:50%;left:0;transform:translate(-50%,-50%);width:24px;height:24px;object-fit:contain;z-index:3;transition:left 0.2s;" onerror="this.style.display=\'none\'">' +
    '</div>';

  gameArea.insertBefore(bar, gameArea.firstChild);
  mcUpdateProgressDisplay();
}

/**
 * Update the progress bar display.
 */
function mcUpdateProgressDisplay() {
  var pct = Math.min(100, (_mcState.current / _mcState.currentMax) * 100);
  var fill = document.getElementById('mcBarFill');
  var valEl = document.getElementById('mcCurrentVal');
  var icon = document.getElementById('mcBarIcon');

  if (fill) {
    fill.style.width = pct + '%';
    if (_mcState.current >= _mcState.currentTarget) {
      fill.style.background = 'linear-gradient(90deg, #27ae60, #2ecc71)';
    } else {
      fill.style.background = 'linear-gradient(90deg, #e74c3c, #c0392b)';
    }
  }
  if (icon) {
    icon.style.left = pct + '%';
  }
  if (valEl) {
    valEl.textContent = _mcState.current.toFixed(2) + ' / ' + _mcState.currentMax;
  }
}

/**
 * Start countdown timer — decreases progress by 0.005 every 100ms.
 */
function mcStartCountDown() {
  if (_mcState.countDownTimer) clearInterval(_mcState.countDownTimer);
  // count_down_delta per count_down_second → 0.005 per 100ms
  // (count_down_delta / countDownSecond) / 10 = decrease per 100ms
  _mcState.countDownTimer = setInterval(function() {
    if (_mcState.current > 0) {
      _mcState.current = Math.max(0, _mcState.current - 0.005);
      mcUpdateProgressDisplay();
    }
  }, 100);
}

/**
 * Stop countdown timer.
 */
function mcStopCountDown() {
  if (_mcState.countDownTimer) {
    clearInterval(_mcState.countDownTimer);
    _mcState.countDownTimer = null;
  }
}


// ===========================================================================
// ManilaBingo Mister Champion Bonus Game (3x3 bingo card + auto balls)
// ===========================================================================
function mcShowBonusGame(card, balls, prize) {
  var old = document.getElementById('mcBonusModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'mcBonusModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var html = '<div style="background:linear-gradient(135deg,#1a2e1a,#2d4e2d);border-radius:16px;padding:28px;border:2px solid #f39c12;text-align:center;min-width:320px;">';
  html += '<div style="color:#f39c12;font-size:18px;font-weight:800;margin-bottom:12px;">🏆 Champion Bonus!</div>';

  // 3x3 card
  html += '<div id="mcBonusCard" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-width:200px;margin:0 auto 12px;">';
  for (var i = 0; i < card.length; i++) {
    html += '<div class="mc-bonus-cell" data-num="' + card[i] + '" style="background:#f5f5f5;border-radius:4px;padding:10px;text-align:center;font-size:14px;font-weight:700;color:#333;">' + (card[i] < 10 ? '0' + card[i] : card[i]) + '</div>';
  }
  html += '</div>';

  // Ball area
  html += '<div id="mcBonusBalls" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;min-height:28px;margin-bottom:12px;"></div>';

  // Status
  html += '<div id="mcBonusStatus" style="color:#aaa;font-size:12px;">Drawing balls...</div>';
  html += '</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  // Auto-draw balls with animation
  mcAnimateBalls(balls, card, prize);
}

function mcAnimateBalls(balls, card, prize) {
  var idx = 0;
  var cardSet = new Set(card);

  function drawNext() {
    if (idx >= balls.length) {
      // All balls drawn — show result
      setTimeout(function() { mcBonusFinish(prize); }, 800);
      return;
    }
    var ball = balls[idx];

    // Add ball to ball area
    var ballArea = document.getElementById('mcBonusBalls');
    if (ballArea) {
      var isHit = cardSet.has(ball);
      ballArea.innerHTML += '<div style="width:24px;height:24px;border-radius:50%;background:' + (isHit ? '#27ae60' : '#3498db') + ';display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;">' + ball + '</div>';
    }

    // Mark on card if hit
    if (cardSet.has(ball)) {
      var cells = document.querySelectorAll('.mc-bonus-cell');
      cells.forEach(function(cell) {
        if (parseInt(cell.getAttribute('data-num')) === ball) {
          cell.style.background = '#222';
          cell.style.color = '#fff';
          cell.style.boxShadow = '0 0 6px rgba(39,174,96,0.8)';
        }
      });
    }

    idx++;
    setTimeout(drawNext, 400);
  }
  drawNext();
}

function mcBonusFinish(prize) {
  var status = document.getElementById('mcBonusStatus');
  if (prize > 0) {
    if (status) {
      status.style.color = '#2ecc71';
      status.innerHTML = '<span style="font-size:16px;font-weight:800;">🎉 Won: ' + prize.toFixed(2) + '!</span>';
    }
  } else {
    if (status) {
      status.style.color = '#f39c12';
      status.innerHTML = '<span style="font-size:14px;">Better luck next time! 💪</span>';
    }
  }

  // Close after delay
  setTimeout(function() {
    var m = document.getElementById('mcBonusModal');
    if (m) m.remove();
  }, 2500);
}
