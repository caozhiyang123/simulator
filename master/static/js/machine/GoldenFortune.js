// ---------------------------------------------------------------------------
// GoldenFortune Machine Plugin (Slot)
// 2x3 slot with features: MultiPrizeLineFeature, FreeSpinFeature, BonusFeature
// Custom background (.jpg), pattern path, and control positions.
// ---------------------------------------------------------------------------
MachineRegistry.register('GoldenFortune', {
  type: 'slot',

  // Custom assets paths
  assets: {
    background: '/static/machine/GoldenFortune/background/GoldenFortune.jpg',
    pattern: '/static/machine/GoldenFortune/pattern/GoldenFortune.PNG',
    icons: '/static/machine/GoldenFortune/icon/'
  },

  afterRender: function(resp, config) {
    // Reposition controls to match GoldenFortune background layout
    // GoldenFortune is a 2x3 slot - controls need different positions than the default Olympus skin

    // Balance display - move to lower-left area
    var balEl = document.getElementById('slotBalance');
    if (balEl) {
      balEl.style.top = '18%';
      balEl.style.left = '25%';
      balEl.style.width = '40%';
      balEl.style.height = '4%';
      balEl.style.fontSize = '14px';
    }

    // Jackpot display - move to upper-right area
    var jpEl = document.getElementById('slotJackpotDisplay');
    if (jpEl) {
      jpEl.style.top = '23%';
      jpEl.style.right = '25%';
      jpEl.style.width = '40%';
      jpEl.style.height = '4%';
      jpEl.style.fontSize = '14px';
    }

    // Reels container - adjust for 2-row layout (shorter height)
    var reelsEl = document.getElementById('slotReelsContainer');
    if (reelsEl) {
      reelsEl.style.top = '22%';
      reelsEl.style.left = '12%';
      reelsEl.style.width = '76%';
      reelsEl.style.height = '46%';
    }

    // Win display - center over reels
    var winEl = document.getElementById('slotWinDisplay');
    if (winEl) {
      winEl.style.top = '40%';
      winEl.style.left = '12%';
      winEl.style.width = '76%';
    }

    // BET controls - reposition controls bar
    // Balance at 18%, Reels at 22-68%, gap reduced to 50% of original (4% -> 2%). Controls at 67%.
    var controlsBar = document.getElementById('slotControlsBar');
    if (controlsBar) {
      controlsBar.style.top = '67%';
      // Wrap BET and LINE groups into a vertical column (left-aligned, LINE below BET)
      var children = controlsBar.children;
      if (children.length >= 2) {
        var betGroup = children[0];
        var lineGroup = children[1];
        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:flex-start;';
        controlsBar.insertBefore(wrapper, betGroup);
        wrapper.appendChild(betGroup);
        wrapper.appendChild(lineGroup);
      }
    }

    // COLLECT button — retro style
    var collectBtn = document.getElementById('slotCollectBtn');
    if (collectBtn) {
      collectBtn.className = 'gf-btn-retro';
    }

    // SPIN button - retro 3D rectangular
    var spinBtn = document.getElementById('slotSpinBtn');
    if (spinBtn) {
      spinBtn.className = 'gf-spin-retro';
      spinBtn.style.width = '80px';
      spinBtn.style.height = '44px';
      spinBtn.innerHTML = '<span style="font-size:14px;font-weight:900;color:#fff;text-shadow:0 -1px 0 #333,0 1px 0 #000,1px 0 0 #000,-1px 0 0 #000;letter-spacing:2px;z-index:1;">SPIN</span>';
    }

    // Override BET and LINE +/- buttons to retro 3D style
    var btns = document.querySelectorAll('#slotControlsBar .slot-btn-3d');
    btns.forEach(function(btn) {
      btn.className = 'gf-btn-retro';
    });

    // Free spin by bet: store data, auto-switch, hook bet change
    if (resp.left_free_spin_by_bet) {
      _gfFreeSpinByBet = resp.left_free_spin_by_bet;
    }
    gfAutoSwitchToFreeSpinBet();
    gfUpdateFreeSpinFromBet();
    gfHookBetChange();
  },

  onSpinResponse: function(resp) {
    // If locks triggered, set bonus pending to defer round over
    if (resp.locks && resp.locks.length > 0) {
      _playBonusPending = true;
    }

    // Update free spin count from response
    if (resp.left_free_spin_amount !== undefined) {
      _gfFreeSpinsLeft = resp.left_free_spin_amount;
    }

    // Default handling first
    slotHandleSpinResponse(resp);

    // After reels stop, adjust display and handle locks/free spin
    setTimeout(function() {
      goldenFortuneAdjustReelDisplay();
      goldenFortuneRedrawWinLines(resp);
      // Show lock selection modal if triggered
      if (resp.locks && resp.locks.length > 0) {
        gfShowLocksModal(resp.locks);
      }
      // Update SPIN button for free spin
      gfUpdateSpinBtnFreeSpin();
    }, 3500);
  }
});

// ---------------------------------------------------------------------------
// GoldenFortune: Adjust reel display after spin stops.
// For columns with only 1 non-zero icon: center it with half-icons above/below.
// For columns with all non-zero icons: ensure proper display (fix strip structure).
// ---------------------------------------------------------------------------
function goldenFortuneAdjustReelDisplay() {
  var st = _slotState;
  if (!st || !st.reelIcons) return;

  var rowCount = st.rowCount || 2;
  var colCount = st.colCount || 3;
  var allIcons = st.icons || [0,1,2,3,4,5,6];
  var cellHeight = 80;

  for (var col = 0; col < colCount; col++) {
    var wrapper = document.querySelector('#slotReelsContainer .slot-reel-wrapper[data-col="' + col + '"]');
    if (!wrapper) continue;

    // Collect icons for this column
    var colIcons = [];
    var nonZeroCount = 0;
    for (var row = 0; row < rowCount; row++) {
      var idx = row * colCount + col;
      var iconId = st.reelIcons[idx];
      colIcons.push(iconId);
      if (iconId > 0) nonZeroCount++;
    }

    var strip = wrapper.querySelector('.slot-reel-strip');
    if (!strip) continue;

    if (nonZeroCount === 1) {
      // Single non-zero icon: center it with half-icons above/below
      var mainIcon = 0;
      for (var r = 0; r < rowCount; r++) { if (colIcons[r] > 0) { mainIcon = colIcons[r]; break; } }
      var randTop = allIcons[Math.floor(Math.random() * allIcons.length)];
      var randBottom = allIcons[Math.floor(Math.random() * allIcons.length)];
      if (randTop === 0) randTop = 1;
      if (randBottom === 0) randBottom = 1;

      var totalHeight = rowCount * cellHeight;
      var halfSize = cellHeight / 2;

      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      strip.innerHTML =
        '<div style="width:100%;height:' + halfSize + 'px;overflow:hidden;display:flex;align-items:flex-end;justify-content:center;">' +
          '<img src="/static/machine/' + st.machineName + '/icon/i' + randTop + '.png" style="width:100%;height:' + cellHeight + 'px;object-fit:fill;opacity:0.4;">' +
        '</div>' +
        '<div style="width:100%;height:' + cellHeight + 'px;display:flex;align-items:center;justify-content:center;">' +
          '<img src="/static/machine/' + st.machineName + '/icon/i' + mainIcon + '.png" style="width:100%;height:100%;object-fit:fill;">' +
        '</div>' +
        '<div style="width:100%;height:' + halfSize + 'px;overflow:hidden;display:flex;align-items:flex-start;justify-content:center;">' +
          '<img src="/static/machine/' + st.machineName + '/icon/i' + randBottom + '.png" style="width:100%;height:' + cellHeight + 'px;object-fit:fill;opacity:0.4;">' +
        '</div>';
    } else {
      // Multiple non-zero icons: rebuild strip with proper icons showing
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      var html = '';
      for (var r = 0; r < rowCount; r++) {
        var iconId = colIcons[r];
        html += '<div style="width:100%;height:' + cellHeight + 'px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
        html += '<img src="/static/machine/' + st.machineName + '/icon/i' + iconId + '.png" style="width:100%;height:100%;object-fit:fill;">';
        html += '</div>';
      }
      strip.innerHTML = html;
    }
  }
}

// ---------------------------------------------------------------------------
// GoldenFortune: Redraw win lines to match actual icon positions after adjustment.
// The SVG uses the strip's actual rendered height, not the container's full height.
// ---------------------------------------------------------------------------
function goldenFortuneRedrawWinLines(resp) {
  if (!resp.total_won || resp.total_won <= 0) return;

  var st = _slotState;
  var svg = document.getElementById('slotLineSvg');
  var container = document.getElementById('slotReelsContainer');
  if (!svg || !container) return;

  // Clear existing lines
  svg.innerHTML = '';

  // Calculate actual icon area dimensions
  var cellHeight = 80;
  var rowCount = st.rowCount || 2;
  var colCount = st.colCount || 3;
  var containerW = container.offsetWidth;
  var containerH = container.offsetHeight;
  var colW = containerW / colCount;

  // Actual strip height = rowCount * cellHeight, centered in container
  var stripH = rowCount * cellHeight;
  var offsetY = (containerH - stripH) / 2; // vertical offset to center
  if (offsetY < 0) offsetY = 0;
  var rowH = cellHeight;

  // Parse won_pattern for winning lines
  var wonPattern = resp.won_pattern || '';
  var wonLines = [];
  var matches = wonPattern.match(/l(\d+)/g);
  if (matches) {
    for (var i = 0; i < matches.length; i++) {
      var lineNum = parseInt(matches[i].substring(1)) - 1;
      if (lineNum >= 0 && wonLines.indexOf(lineNum) < 0) wonLines.push(lineNum);
    }
  }
  if (wonLines.length === 0) return;

  // Draw each winning line
  for (var li = 0; li < wonLines.length; li++) {
    var lineIdx = wonLines[li];
    if (lineIdx >= st.lines.length) continue;
    var line = st.lines[lineIdx];
    var points = [];
    for (var i = 0; i < line.length; i++) {
      var pos = line[i];
      var col = pos % colCount;
      var row = Math.floor(pos / colCount);
      var cx = col * colW + colW / 2;
      var cy = offsetY + row * rowH + rowH / 2;
      points.push(cx + ',' + cy);
    }
    var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', SLOT_LINE_COLORS[lineIdx] || '#fff');
    polyline.setAttribute('stroke-width', '3');
    polyline.setAttribute('stroke-opacity', '0.9');
    polyline.setAttribute('data-line', lineIdx);
    svg.appendChild(polyline);
  }
}


// ===========================================================================
// GoldenFortune Free Spin By Bet
// ===========================================================================
var _gfFreeSpinByBet = []; // [{bet, lines, free_spin}]
var _gfFreeSpinsLeft = 0;

function gfAutoSwitchToFreeSpinBet() {
  var st = _slotState;
  if (!_gfFreeSpinByBet || _gfFreeSpinByBet.length === 0) return;
  var target = null;
  for (var i = 0; i < _gfFreeSpinByBet.length; i++) {
    if (_gfFreeSpinByBet[i].free_spin > 0) { target = _gfFreeSpinByBet[i]; break; }
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

function gfUpdateFreeSpinFromBet() {
  var st = _slotState;
  var bet = (st.betList && st.betList[st.betIndex]) || 0.01;
  var lines = st.activeLines || 1;
  _gfFreeSpinsLeft = 0;
  for (var i = 0; i < _gfFreeSpinByBet.length; i++) {
    var e = _gfFreeSpinByBet[i];
    if (Math.abs(e.bet - bet) < 0.0001 && e.lines === lines) {
      _gfFreeSpinsLeft = e.free_spin || 0; break;
    }
  }
  gfUpdateSpinBtnFreeSpin();
}

function gfUpdateSpinBtnFreeSpin() {
  var spinBtn = document.getElementById('slotSpinBtn');
  if (!spinBtn) return;
  if (_gfFreeSpinsLeft > 0) {
    spinBtn.innerHTML = '<span style="font-size:14px;font-weight:900;color:#fff;text-shadow:0 -1px 0 #333,0 1px 0 #000,1px 0 0 #000,-1px 0 0 #000;letter-spacing:1px;z-index:1;">' + _gfFreeSpinsLeft + ' FREE</span>';
    // Override onclick to send free_spin
    spinBtn.onclick = function() { gfSendFreeSpin(); };
  } else {
    spinBtn.innerHTML = '<span style="font-size:14px;font-weight:900;color:#fff;text-shadow:0 -1px 0 #333,0 1px 0 #000,1px 0 0 #000,-1px 0 0 #000;letter-spacing:2px;z-index:1;">SPIN</span>';
    spinBtn.onclick = function() { slotSpin(); };
  }
}

function gfHookBetChange() {
  var origBet = window.slotChangeBet;
  var origLines = window.slotChangeLines;
  window.slotChangeBet = function(dir) {
    if (_gfFreeSpinsLeft > 0) return; // block bet change during free spin
    origBet(dir);
    gfUpdateFreeSpinFromBet();
  };
  if (origLines) {
    window.slotChangeLines = function(dir) {
      if (_gfFreeSpinsLeft > 0) return; // block line change during free spin
      origLines(dir);
      gfUpdateFreeSpinFromBet();
    };
  }
}

function gfSendFreeSpin() {
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

  // Get spin tool overrides (same as normal spin)
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
  playLog('>>> [GF FREE SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

// ===========================================================================
// GoldenFortune Free Spin Lock Feature
// ===========================================================================
var _gfLocks = {
  locks: [],           // lock values [1,1,2,3,5]
  opened: [],          // opened positions
  maxOpens: 3,         // player can open 3 locks
  currentOpen: 0,      // how many opened so far
  nextPrice: 0         // price to open next lock (first is free)
};

/**
 * Show the lock selection modal.
 */
function gfShowLocksModal(locks) {
  _gfLocks.locks = locks;
  _gfLocks.opened = [];
  _gfLocks.currentOpen = 0;
  _gfLocks.maxOpens = 3;
  _gfLocks.nextPrice = 0; // first lock is free

  var old = document.getElementById('gfLocksModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'gfLocksModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var html = '<div style="background:linear-gradient(135deg,#1a1a3e,#2a2a5e);border-radius:16px;padding:24px;border:2px solid #f5d742;text-align:center;max-width:90vw;">';
  html += '<div style="color:#f5d742;font-size:18px;font-weight:700;margin-bottom:8px;">🔓 Free Spin Locks</div>';
  html += '<div style="color:#ccc;font-size:12px;margin-bottom:6px;">Choose 3 locks to open. First is FREE!</div>';
  html += '<div id="gfLockPrice" style="color:#4fc3f7;font-size:11px;margin-bottom:16px;">Next lock: FREE</div>';

  // Lock buttons
  html += '<div id="gfLocksGrid" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">';
  for (var i = 0; i < locks.length; i++) {
    html += '<div class="gf-lock-btn" data-idx="' + i + '" onclick="gfOpenLock(' + i + ')" style="width:60px;height:70px;background:linear-gradient(to bottom,#555,#333);border-radius:8px;border:2px solid #888;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.15s;">';
    html += '<span style="font-size:24px;">🔒</span>';
    html += '<span style="font-size:9px;color:#888;margin-top:2px;">Lock ' + (i + 1) + '</span>';
    html += '</div>';
  }
  html += '</div>';

  // Status
  html += '<div id="gfLockStatus" style="margin-top:12px;color:#aaa;font-size:11px;">Opened: 0/3</div>';
  html += '</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  playLog('🔓 [LOCKS] showing: ' + JSON.stringify(locks));
}

/**
 * Player clicks a lock to open it.
 */
function gfOpenLock(idx) {
  if (_gfLocks.currentOpen >= _gfLocks.maxOpens) return;
  if (_gfLocks.opened.indexOf(idx) >= 0) return; // already opened

  // Disable all lock buttons while waiting
  document.querySelectorAll('.gf-lock-btn').forEach(function(btn) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.6';
  });

  var status = document.getElementById('gfLockStatus');
  if (status) status.textContent = 'Opening lock ' + (idx + 1) + '...';

  // Send bonus_spin.open_lock command
  var st = _slotState;
  var cmd = {
    cmd: 'bonus_spin.open_lock',
    session_token: st.sessionToken,
    game_id: st.machineId,
    currency: st.currency,
    opt_id: st.loginResp.opt_id || '',
    username: st.loginResp.username || '',
    position: idx,
    feature_id: 3,
    bonus_unique_id: '',
    is_bonus: false,
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [OPEN LOCK] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

/**
 * Handle bonus_spin.open_lock response.
 */
function gfHandleOpenLockResponse(resp) {
  playLog('<<< [OPEN LOCK] response');

  var position = resp.position;
  var currentLock = resp.current_lock || 0;
  var continueOpen = resp.continue_open_next_lock;
  var nextPrice = resp.next_lock_price || 0;
  var balance = resp.balance;
  var leftFreeSpin = resp.left_free_spin_amount;

  _gfLocks.opened.push(position);
  _gfLocks.currentOpen++;
  _gfLocks.nextPrice = nextPrice;

  // Update balance
  if (balance !== undefined) {
    slotUpdateBalance(balance, false);
  }

  // Reveal the opened lock value
  var lockBtn = document.querySelector('.gf-lock-btn[data-idx="' + position + '"]');
  if (lockBtn) {
    lockBtn.style.background = 'linear-gradient(to bottom,#27ae60,#1a8a4a)';
    lockBtn.style.borderColor = '#2ecc71';
    lockBtn.innerHTML = '<span style="font-size:18px;font-weight:800;color:#fff;">' + currentLock + '</span><span style="font-size:8px;color:#aff;margin-top:2px;">FREE SPIN</span>';
  }

  // Update status
  var status = document.getElementById('gfLockStatus');
  if (status) status.textContent = 'Opened: ' + _gfLocks.currentOpen + '/3 | Got ' + currentLock + ' free spin(s)!';

  // Update next price display
  var priceEl = document.getElementById('gfLockPrice');
  if (priceEl) {
    if (continueOpen && _gfLocks.currentOpen < _gfLocks.maxOpens) {
      priceEl.textContent = 'Next lock cost: ' + (nextPrice > 0 ? nextPrice.toFixed(2) : 'FREE');
    } else {
      priceEl.textContent = '';
    }
  }

  if (continueOpen && _gfLocks.currentOpen < _gfLocks.maxOpens) {
    // Re-enable unopened lock buttons
    document.querySelectorAll('.gf-lock-btn').forEach(function(btn) {
      var btnIdx = parseInt(btn.getAttribute('data-idx'));
      if (_gfLocks.opened.indexOf(btnIdx) < 0) {
        btn.style.pointerEvents = '';
        btn.style.opacity = '1';
      }
    });
  } else {
    // All opens done — close modal and update free spin button
    setTimeout(function() {
      gfLocksComplete(leftFreeSpin);
    }, 1500);
  }
}

/**
 * Lock bonus complete — close modal, update SPIN button, send round over.
 */
function gfLocksComplete(leftFreeSpin) {
  var modal = document.getElementById('gfLocksModal');
  if (modal) modal.remove();

  // Update SPIN button to show free spin count
  if (leftFreeSpin && leftFreeSpin > 0) {
    var spinBtn = document.getElementById('slotSpinBtn');
    if (spinBtn) {
      var span = spinBtn.querySelector('span');
      if (span) span.textContent = leftFreeSpin + ' FREE';
    }
  }

  // Clear bonus pending and send round over
  _playBonusPending = false;
  slotRoundOver();

  playLog('🔓 [LOCKS] complete, free spins: ' + leftFreeSpin);
}
