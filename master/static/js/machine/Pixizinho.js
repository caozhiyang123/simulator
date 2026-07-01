// ---------------------------------------------------------------------------
// Pixizinho Machine Plugin (Slot)
// 3x3 slot, 11 icons (0-10), 1 line.
// Icon 0=empty, 1=golden, 2=minor, 3=major, 4=grand, 5-10=values
// Features: PixizinhoRespinFeature, PixizinhoJackpotFeature
// Free spin with sticky goldens on column 2.
// ---------------------------------------------------------------------------
MachineRegistry.register('Pixizinho', {
  type: 'slot',

  assets: {
    icons: '/static/machine/Pixizinho/icon/'
  },

  afterRender: function(resp, config) {
    pixizinhoRenderJackpotPanel(resp, config);
    // Store free spin by bet data
    if (resp.left_free_spin_by_bet) {
      _pixState.freeSpinByBet = resp.left_free_spin_by_bet;
    }
    // Auto-switch to bet that has free spins
    pixizinhoAutoSwitchToFreeSpinBet();
    // Apply sticky goldens from login
    if (resp.sticky_goldens && resp.sticky_goldens.length > 0) {
      _pixState.stickyPositions = resp.sticky_goldens;
      setTimeout(function() { pixizinhoApplyStickyGoldens(); }, 100);
    }
    // Determine free spins for current bet/line
    pixizinhoUpdateFreeSpinFromBet();
    // Show free spin UI if applicable
    if (_pixState.freeSpinsLeft > 0) {
      _pixState.totalFreeSpinPrize = resp.total_free_spin_prize || 0;
      pixizinhoShowFreeSpinUI();
    }
    // Hook bet change to update jackpot and free spin count
    pixizinhoHookBetChange();
  },

  onSpinResponse: function(resp) {
    // Reset WIN display
    var winEl = document.getElementById('slotWinDisplay');
    if (winEl) winEl.textContent = '';
    var winAmtEl = document.getElementById('slotWinAmount');
    if (winAmtEl) winAmtEl.textContent = '0.00';

    if (resp.pixizinho_jackpot) pixizinhoUpdateJackpot(resp.pixizinho_jackpot);

    // Store sticky positions before spin handling
    if (resp.sticky_goldens && resp.sticky_goldens.length > 0) {
      _pixState.stickyPositions = resp.sticky_goldens;
    }
    // Clear sticky if no free spins left
    if (resp.left_free_spin_amount !== undefined && resp.left_free_spin_amount <= 0) {
      _pixState.stickyPositions = [];
    }

    // Default slot handling
    slotHandleSpinResponse(resp);

    // Update free spin state
    if (resp.left_free_spin_amount !== undefined) {
      _pixState.freeSpinsLeft = resp.left_free_spin_amount;
      _pixState.totalFreeSpinPrize = resp.total_free_spin_prize || 0;
    }

    // After reels stop: golden animation + sticky + free spin continuation
    setTimeout(function() {
      // Apply or clear sticky golden display
      if (_pixState.stickyPositions.length > 0) {
        pixizinhoApplyStickyGoldens();
      } else {
        // Remove all sticky overlays
        document.querySelectorAll('.pix-sticky').forEach(function(el) { el.remove(); });
      }
      // Golden prize animation
      if (resp.golden_prize && resp.golden_prize.length > 0) {
        pixizinhoGoldenPrizeAnimation(resp.golden_prize);
      }
      // Update free spin UI and enable SPIN button for manual free spin
      pixizinhoUpdateFreeSpinUI();
    }, 3800);
  }
});

// ---------------------------------------------------------------------------
// Pixizinho State
// ---------------------------------------------------------------------------
var _pixState = {
  freeSpinsLeft: 0,
  totalFreeSpinPrize: 0,
  stickyPositions: [],          // indices that are sticky (golden icons locked)
  freeSpinByBet: []             // [{bet, lines, free_spin}] from login
};

// ---------------------------------------------------------------------------
// Jackpot Panel (left of reels, same height as reel container, centered)
// ---------------------------------------------------------------------------
var _pixJackpot = { minor: 0, major: 0, grand: 0, minorMulti: 12.5, majorMulti: 25, grandMulti: 100 };

function pixizinhoRenderJackpotPanel(resp, config) {
  var mathModel = (config.math_model && config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  var jpConfig = null;
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('PixizinhoJackpotFeature') >= 0) {
      jpConfig = features[i].config; break;
    }
  }
  _pixJackpot.minorMulti = (jpConfig && jpConfig.minor_multiplier) || 12.5;
  _pixJackpot.majorMulti = (jpConfig && jpConfig.major_multiplier) || 25.0;
  _pixJackpot.grandMulti = (jpConfig && jpConfig.grand_multiplier) || 100.0;

  pixizinhoRecalcJackpot();
  if (resp.pixizinho_jackpot) pixizinhoUpdateJackpot(resp.pixizinho_jackpot);

  var old = document.getElementById('pixJackpotPanel');
  if (old) old.remove();

  var slotSkin = document.getElementById('slotSkin');
  var reelsEl = document.getElementById('slotReelsContainer');
  if (!slotSkin) return;

  // Match reels position and height
  var reelTop = reelsEl ? reelsEl.style.top : '20%';
  var reelH = reelsEl ? reelsEl.style.height : '52%';

  // Place jackpot panel above the reels (increased gap from reels)
  var reelTopNum = parseFloat(reelTop) || 20;
  var panelTop = reelTopNum - 35; // above reels with 2x gap
  if (panelTop < 2) panelTop = 2;

  var panel = document.createElement('div');
  panel.id = 'pixJackpotPanel';
  panel.style.cssText = 'position:absolute;top:' + panelTop + '%;left:2%;width:96%;display:flex;gap:12px;justify-content:center;align-items:center;z-index:5;pointer-events:none;';

  var mn = _slotState.machineName || 'Pixizinho';
  panel.innerHTML =
    pixizinhoJpRow('grand', mn, 'i4', '#c00') +
    pixizinhoJpRow('major', mn, 'i3', '#0a0') +
    pixizinhoJpRow('minor', mn, 'i2', '#00a');

  slotSkin.appendChild(panel);
}

function pixizinhoJpRow(type, mn, icon, bg) {
  var val = _pixJackpot[type] || 0;
  return '<div style="flex:1;display:flex;align-items:center;">' +
    '<img src="/static/machine/' + mn + '/icon/' + icon + '.png" style="width:56px;height:56px;object-fit:contain;flex-shrink:0;z-index:1;margin-right:-8px;" onerror="this.style.opacity=0">' +
    '<div style="flex:1;background:' + bg + ';border-radius:6px;border:2px solid #999;padding:4px 6px 4px 16px;text-align:center;">' +
    '<span id="pixJp_' + type + '" style="color:#fff;font-size:12px;font-weight:700;text-shadow:0 1px 2px #000;">' + pixJpFormat(val) + '</span>' +
    '</div></div>';
}

/** Format jackpot value: show actual result without forced 2 decimals */
function pixJpFormat(val) {
  if (val === 0) return '0';
  // Show up to 4 decimal places, remove trailing zeros
  var s = val.toFixed(4);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function pixizinhoRecalcJackpot() {
  var st = _slotState;
  var bet = (st.betList && st.betList[st.betIndex]) || 0.01;
  _pixJackpot.minor = bet * _pixJackpot.minorMulti;
  _pixJackpot.major = bet * _pixJackpot.majorMulti;
  _pixJackpot.grand = bet * _pixJackpot.grandMulti;
  var el1 = document.getElementById('pixJp_minor');
  var el2 = document.getElementById('pixJp_major');
  var el3 = document.getElementById('pixJp_grand');
  if (el1) el1.textContent = pixJpFormat(_pixJackpot.minor);
  if (el2) el2.textContent = pixJpFormat(_pixJackpot.major);
  if (el3) el3.textContent = pixJpFormat(_pixJackpot.grand);
}

function pixizinhoUpdateJackpot(jpData) {
  var st = _slotState;
  var bet = (st.betList && st.betList[st.betIndex]) || 0.01;
  for (var i = 0; i < jpData.length; i++) {
    var e = jpData[i];
    if (e.minor !== undefined) _pixJackpot.minor = bet * e.minor;
    if (e.major !== undefined) _pixJackpot.major = bet * e.major;
    if (e.grand !== undefined) _pixJackpot.grand = bet * e.grand;
  }
  var el1 = document.getElementById('pixJp_minor');
  var el2 = document.getElementById('pixJp_major');
  var el3 = document.getElementById('pixJp_grand');
  if (el1) el1.textContent = pixJpFormat(_pixJackpot.minor);
  if (el2) el2.textContent = pixJpFormat(_pixJackpot.major);
  if (el3) el3.textContent = pixJpFormat(_pixJackpot.grand);
}

// Hook into bet change to recalc jackpot and update free spin count
function pixizinhoHookBetChange() {
  var origChangeBet = window.slotChangeBet;
  window.slotChangeBet = function(dir) {
    // Block bet change if current bet has unconsumed free spins
    if (_pixState.freeSpinsLeft > 0) {
      return; // cannot switch bet while free spins remain
    }
    origChangeBet(dir);
    pixizinhoRecalcJackpot();
    pixizinhoUpdateFreeSpinFromBet();
  };
}

/**
 * Look up free spins for current bet/lines from left_free_spin_by_bet data.
 */
function pixizinhoUpdateFreeSpinFromBet() {
  var st = _slotState;
  var bet = (st.betList && st.betList[st.betIndex]) || 0.01;
  var lines = st.activeLines || 1;
  var freeSpins = 0;

  for (var i = 0; i < _pixState.freeSpinByBet.length; i++) {
    var entry = _pixState.freeSpinByBet[i];
    // Compare bet with tolerance for floating point, and match lines
    if (Math.abs(entry.bet - bet) < 0.0001 && entry.lines === lines) {
      freeSpins = entry.free_spin || 0;
      break;
    }
  }

  _pixState.freeSpinsLeft = freeSpins;
  pixizinhoUpdateSpinBtnFreeSpin();

  // Show or hide free spin UI
  if (freeSpins > 0) {
    if (!document.getElementById('pixFreeSpinBar')) pixizinhoShowFreeSpinUI();
    else pixizinhoUpdateFreeSpinUI();
  } else {
    var bar = document.getElementById('pixFreeSpinBar');
    if (bar) bar.remove();
  }
}

/**
 * Auto-switch bet to one that has free spins remaining.
 */
function pixizinhoAutoSwitchToFreeSpinBet() {
  var st = _slotState;
  if (!_pixState.freeSpinByBet || _pixState.freeSpinByBet.length === 0) return;

  // Find first entry with free_spin > 0
  var targetBet = null;
  for (var i = 0; i < _pixState.freeSpinByBet.length; i++) {
    if (_pixState.freeSpinByBet[i].free_spin > 0) {
      targetBet = _pixState.freeSpinByBet[i].bet;
      break;
    }
  }
  if (targetBet === null) return;

  // Find the bet index that matches
  for (var i = 0; i < st.betList.length; i++) {
    if (Math.abs(st.betList[i] - targetBet) < 0.0001) {
      st.betIndex = i;
      // Update bet display
      var displayBet = targetBet * st.activeLines;
      var betEl = document.getElementById('slotBetDisplay');
      if (betEl) betEl.textContent = displayBet.toFixed(st.displayPrecision);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Free Spin Logic
// ---------------------------------------------------------------------------
function pixizinhoShowFreeSpinUI() {
  var old = document.getElementById('pixFreeSpinBar');
  if (old) old.remove();
  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;

  var bar = document.createElement('div');
  bar.id = 'pixFreeSpinBar';
  bar.style.cssText = 'position:absolute;top:8%;left:20%;width:60%;background:rgba(0,0,0,0.7);border:2px solid #f5d742;border-radius:8px;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;z-index:10;';
  bar.innerHTML = '<span style="color:#f5d742;font-size:11px;font-weight:700;">FREE SPIN</span>' +
    '<span id="pixFsLeft" style="color:#fff;font-size:11px;">Left: ' + _pixState.freeSpinsLeft + '</span>' +
    '<span id="pixFsPrize" style="color:#4fc3f7;font-size:11px;font-weight:700;">Won: ' + _pixState.totalFreeSpinPrize.toFixed(2) + '</span>';
  slotSkin.appendChild(bar);

  // Disable SPIN button and show "N FREE"
  pixizinhoUpdateSpinBtnFreeSpin();
}

function pixizinhoUpdateSpinBtnFreeSpin() {
  var btn = document.getElementById('slotSpinBtn');
  if (!btn) return;
  if (_pixState.freeSpinsLeft > 0) {
    // Enable button for manual free spin, show "N FREE" text
    btn.style.opacity = '1';
    btn.style.pointerEvents = '';
    btn.onclick = function() { pixizinhoSendFreeSpin(); };
    var span = btn.querySelector('span');
    if (span) span.textContent = _pixState.freeSpinsLeft + ' FREE';
    var span2 = btn.querySelectorAll('span')[1];
    if (span2) span2.textContent = '';
  } else {
    // Restore normal SPIN button
    btn.style.opacity = '1';
    btn.style.pointerEvents = '';
    btn.onclick = function() { slotSpin(); };
    var span = btn.querySelector('span');
    if (span) span.textContent = 'SPIN';
    var span2 = btn.querySelectorAll('span')[1];
    if (span2) span2.textContent = 'HOLD AUTO';
  }
}

function pixizinhoUpdateFreeSpinUI() {
  var leftEl = document.getElementById('pixFsLeft');
  var prizeEl = document.getElementById('pixFsPrize');
  if (leftEl) leftEl.textContent = 'Left: ' + _pixState.freeSpinsLeft;
  if (prizeEl) prizeEl.textContent = 'Won: ' + _pixState.totalFreeSpinPrize.toFixed(2);

  // Update SPIN button text
  pixizinhoUpdateSpinBtnFreeSpin();

  if (_pixState.freeSpinsLeft <= 0) {
    // Free spin phase ended
    var bar = document.getElementById('pixFreeSpinBar');
    if (bar) setTimeout(function() { bar.remove(); }, 3000);
    _pixState.stickyPositions = [];
    // Restore SPIN button
    setTimeout(function() { pixizinhoUpdateSpinBtnFreeSpin(); }, 3100);
  } else {
    if (!document.getElementById('pixFreeSpinBar')) pixizinhoShowFreeSpinUI();
  }
}

function pixizinhoSendFreeSpin() {
  var st = _slotState;
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) return;

  st.spinning = true;
  var btn = document.getElementById('slotSpinBtn');
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }

  // Start reel animation (skip sticky columns)
  pixizinhoStartReelAnimationWithSticky();

  var bet = st.betList[st.betIndex] || 0.01;
  var cmd = {
    cmd: 'free_spin',
    session_token: st.sessionToken,
    game_id: st.machineId,
    currency: st.currency,
    opt_id: st.loginResp.opt_id || '',
    username: st.loginResp.username || '',
    aposta: bet,
    lines: '1',
    bonus_unique_id: '',
    is_bonus: false,
    icons: [],
    target_pattern_ids: [],
    target_feature_ids: [],
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [PIX FREE SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

// ---------------------------------------------------------------------------
// Sticky Goldens — lock certain reel positions during animation
// ---------------------------------------------------------------------------
function pixizinhoApplyStickyGoldens() {
  var st = _slotState;
  var colCount = st.colCount || 3;
  var mn = st.machineName || 'Pixizinho';
  var positions = _pixState.stickyPositions;

  positions.forEach(function(pos) {
    var col = pos % colCount;
    var row = Math.floor(pos / colCount);
    var wrapper = document.querySelector('#slotReelsContainer .slot-reel-wrapper[data-col="' + col + '"]');
    if (!wrapper) return;

    // Add sticky overlay with golden icon
    var existing = wrapper.querySelector('.pix-sticky[data-pos="' + pos + '"]');
    if (existing) return; // already applied

    var cellH = wrapper.offsetHeight / (st.rowCount || 3);
    var overlay = document.createElement('div');
    overlay.className = 'pix-sticky';
    overlay.setAttribute('data-pos', pos);
    overlay.style.cssText = 'position:absolute;top:' + (row * cellH) + 'px;left:0;width:100%;height:' + cellH + 'px;z-index:5;display:flex;align-items:center;justify-content:center;background:#111;border:2px solid #f5d742;border-radius:4px;box-shadow:0 0 8px rgba(245,215,66,0.6);';
    overlay.innerHTML = '<img src="/static/machine/' + mn + '/icon/i1.png" style="width:100%;height:100%;object-fit:fill;" onerror="this.style.opacity=0">';
    wrapper.style.position = 'relative';
    wrapper.appendChild(overlay);
  });
}

function pixizinhoStartReelAnimationWithSticky() {
  // Use the default reel animation but it will be overlaid by sticky elements
  slotStartReelAnimation();
}

// ---------------------------------------------------------------------------
// Golden Prize Animation
// ---------------------------------------------------------------------------
function pixizinhoGoldenPrizeAnimation(prizes) {
  if (!prizes || prizes.length === 0) return;
  var st = _slotState;
  var container = document.getElementById('slotReelsContainer');
  var slotSkin = document.getElementById('slotSkin');
  if (!container || !slotSkin) return;

  var containerRect = container.getBoundingClientRect();
  var skinRect = slotSkin.getBoundingClientRect();
  var colCount = st.colCount || 3;
  var rowCount = st.rowCount || 3;
  var cellW = container.offsetWidth / colCount;
  var cellH = container.offsetHeight / rowCount;

  var balEl = document.getElementById('slotBalance');
  var balRect = balEl ? balEl.getBoundingClientRect() : { left: skinRect.left + 50, top: skinRect.top + 30 };
  var endX = balRect.left - skinRect.left + 30;
  var endY = balRect.top - skinRect.top + 10;
  slotSkin.style.position = 'relative';

  prizes.forEach(function(prize, idx) {
    setTimeout(function() {
      var pos = prize.index;
      var col = pos % colCount;
      var row = Math.floor(pos / colCount);
      var srcX = (containerRect.left - skinRect.left) + col * cellW + cellW / 2;
      var srcY = (containerRect.top - skinRect.top) + row * cellH + cellH / 2;

      var label = document.createElement('div');
      label.style.cssText = 'position:absolute;left:' + srcX + 'px;top:' + (srcY - 20) + 'px;transform:translate(-50%,-50%);z-index:100;color:#f5d742;font-size:14px;font-weight:800;text-shadow:0 1px 3px #000;pointer-events:none;';
      label.textContent = '+' + prize.balance.toFixed(2);
      slotSkin.appendChild(label);
      label.animate([
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
        { opacity: 1, transform: 'translate(-50%,-100%) scale(1.2)', offset: 0.4 },
        { opacity: 0, transform: 'translate(-50%,-150%) scale(0.8)' }
      ], { duration: 1200, fill: 'forwards' }).onfinish = function() { label.remove(); };

      var coin = document.createElement('div');
      coin.style.cssText = 'position:absolute;left:' + srcX + 'px;top:' + srcY + 'px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe066,#f5a623,#c87800);border:2px solid #f5d742;z-index:99;pointer-events:none;transform:translate(-50%,-50%);';
      slotSkin.appendChild(coin);
      coin.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: 'translate(-50%,-50%) scale(1.3)', opacity: 1, offset: 0.2 },
        { transform: 'translate(' + (endX - srcX) + 'px,' + (endY - srcY) + 'px) scale(0.5)', opacity: 0.7 }
      ], { duration: 1000, easing: 'cubic-bezier(0.2,0.8,0.3,1)', fill: 'forwards' }).onfinish = function() { coin.remove(); };
    }, idx * 500);
  });
}
