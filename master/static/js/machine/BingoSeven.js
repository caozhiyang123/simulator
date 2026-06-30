// ---------------------------------------------------------------------------
// BingoSeven Machine Plugin (Slot)
// 3x5 slot, 10 icons, 20 lines.
// Features: BingoMiniFeature (mini bingo game triggered by scatter icons)
// Displays single bingo card in a white panel to the right of the slot.
// ---------------------------------------------------------------------------
MachineRegistry.register('BingoSeven', {
  type: 'slot',

  assets: {
    pattern: '/static/machine/BingoSeven/pattern/BingoSeven.PNG',
    icons: '/static/machine/BingoSeven/icon/'
  },

  afterRender: function(resp, config) {
    // Widen the game area to make room for the bingo panel (slot 2/3, bingo 1/3)
    var gameArea = document.getElementById('playGameArea');
    if (gameArea) gameArea.style.maxWidth = '960px';

    // Render BingoMini card in a separate panel to the right
    bingoSevenRenderMiniPanel(resp, config);
  },

  onSpinResponse: function(resp) {
    // Clear bingo mini card markings and ball area on each spin
    bingoSevenResetMiniCard();

    // If BingoMini feature triggered, set pending flag to defer round over
    if (resp.base_ball_numbers_per_cage && resp.base_ball_numbers_per_cage.length > 0) {
      _playBonusPending = true;
    }

    // Default slot spin handling
    slotHandleSpinResponse(resp);

    // Start cage animation after reels stop
    if (resp.base_ball_numbers_per_cage && resp.base_ball_numbers_per_cage.length > 0) {
      setTimeout(function() {
        bingoSevenStartCageAnimation(resp.base_ball_numbers_per_cage, resp.bingo_mini_prize || 0);
      }, 3500);
    }
  }
});

// ---------------------------------------------------------------------------
// BingoSeven Mini Bingo Panel (right of slot, white background)
// ---------------------------------------------------------------------------
var _bsPatCycleTimer = null;

function bingoSevenRenderMiniPanel(resp, config) {
  var cardsNumber = resp.cardsNumber || [];
  if (cardsNumber.length === 0) return;

  // Get BingoMiniFeature config
  var mathModel = (config.math_model && config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  var miniConfig = null;
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('BingoMiniFeature') >= 0) {
      miniConfig = features[i].config;
      break;
    }
  }
  if (!miniConfig) return;

  var cardWidth = miniConfig.card_width || 5;
  var cardHeight = miniConfig.card_height || 3;
  var patterns = miniConfig.pattern || [];

  // Remove existing
  var old = document.getElementById('bsMiniPanel');
  if (old) old.remove();

  // Create panel next to slotSkin (not inside it)
  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;

  // Make slotSkin parent a flex container
  var parent = slotSkin.parentElement;
  if (parent) {
    parent.style.display = 'flex';
    parent.style.alignItems = 'stretch';
    parent.style.gap = '0';
    parent.style.justifyContent = 'center';
  }

  // Slot takes 2/3 width
  slotSkin.style.flex = '2';
  slotSkin.style.minWidth = '0';

  var panel = document.createElement('div');
  panel.id = 'bsMiniPanel';
  panel.style.cssText = 'flex:1;background:#1a1a2e;border-radius:0 10px 10px 0;padding:12px;display:flex;flex-direction:column;gap:10px;';

  // === Patterns section (grouped by id, auto-cycle like bingo) ===
  var pGroups = [], pSeen = {};
  patterns.forEach(function(p) {
    var pid = String(p.id);
    if (!pSeen[pid]) { pSeen[pid] = []; pGroups.push({ id: pid, patterns: pSeen[pid] }); }
    pSeen[pid].push(p);
  });

  var patHtml = '<div style="font-size:11px;color:#aaa;font-weight:600;margin-bottom:4px;">Patterns (' + patterns.length + ')</div>';
  patHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
  pGroups.forEach(function(group, gIdx) {
    var first = group.patterns[0];
    var hasMulti = group.patterns.length > 1;
    var fmt = first.format || '';
    patHtml += '<div style="text-align:center;">';
    patHtml += '<div class="bs-pat-grid" data-group="' + gIdx + '" data-idx="0" style="display:grid;grid-template-columns:repeat(' + cardWidth + ',10px);gap:1px;border:1px solid #555;border-radius:2px;padding:1px;background:#555;cursor:' + (hasMulti ? 'pointer' : 'default') + ';">';
    for (var i = 0; i < fmt.length; i++) {
      var isReq = fmt[i] === '1';
      patHtml += '<div style="width:10px;height:7px;background:' + (isReq ? '#e6e600' : '#2a2a4e') + ';"></div>';
    }
    patHtml += '</div>';
    patHtml += '<div style="font-size:8px;color:#888;margin-top:1px;">x' + (first.value || 0) + (hasMulti ? ' (' + group.patterns.length + ')' : '') + '</div>';
    patHtml += '</div>';
  });
  patHtml += '</div>';

  // === Card section (5x3) ===
  var cardHtml = '<div style="font-size:11px;color:#aaa;font-weight:600;margin-bottom:4px;">Bingo Card</div>';
  cardHtml += '<div style="display:grid;grid-template-columns:repeat(' + cardWidth + ',1fr);gap:2px;background:#333;border-radius:4px;padding:2px;">';
  for (var i = 0; i < cardsNumber.length; i++) {
    var num = cardsNumber[i];
    cardHtml += '<div class="bs-mini-cell" data-idx="' + i + '" data-num="' + num + '" style="background:#f5f5f5;text-align:center;font-size:12px;font-weight:700;color:#333;padding:6px 0;border-radius:2px;">' + (num < 10 ? '0' + num : num) + '</div>';
  }
  cardHtml += '</div>';

  panel.innerHTML = patHtml + cardHtml;
  // Insert after slotSkin
  slotSkin.insertAdjacentElement('afterend', panel);

  // Store groups for auto-cycle and start timer
  window._bsPatGroups = pGroups.map(function(g) { return g.patterns; });
  window._bsPatWidth = cardWidth;
  bingoSevenStartPatCycle();
}

// ---------------------------------------------------------------------------
// Auto-cycle patterns with same id (like bingo pattern display)
// ---------------------------------------------------------------------------
function bingoSevenStartPatCycle() {
  if (_bsPatCycleTimer) clearInterval(_bsPatCycleTimer);
  _bsPatCycleTimer = setInterval(function() {
    if (!window._bsPatGroups) return;
    window._bsPatGroups.forEach(function(group, idx) {
      if (group.length <= 1) return;
      var gridEl = document.querySelector('.bs-pat-grid[data-group="' + idx + '"]');
      if (!gridEl) return;
      var cur = (parseInt(gridEl.getAttribute('data-idx')) || 0);
      var next = (cur + 1) % group.length;
      var fmt = group[next].format || '';
      var cardWidth = window._bsPatWidth || 5;
      var cells = '';
      for (var i = 0; i < fmt.length; i++) {
        var isReq = fmt[i] === '1';
        cells += '<div style="width:10px;height:7px;background:' + (isReq ? '#e6e600' : '#2a2a4e') + ';"></div>';
      }
      gridEl.innerHTML = cells;
      gridEl.setAttribute('data-idx', next);
    });
  }, 1500);
}

// ===========================================================================
// BingoSeven Cage Animation — balls fall from trigger icons (i10)
// ===========================================================================
var _bsCage = {
  cages: [],        // [[55,85],[52,57,12],...]
  prize: 0,
  currentCage: 0,
  allBalls: [],     // all balls released so far
  waitingResponse: false
};

/**
 * Start the cage animation. Show cage buttons in bingo panel.
 */
function bingoSevenStartCageAnimation(cages, prize) {
  _bsCage.cages = cages;
  _bsCage.prize = prize;
  _bsCage.currentCage = 0;
  _bsCage.allBalls = [];

  playLog('🎱 [BINGO MINI] triggered: ' + cages.length + ' cages, prize: ' + prize);

  var panel = document.getElementById('bsMiniPanel');
  if (!panel) return;

  // Remove old cage UI
  var oldCage = document.getElementById('bsCageArea');
  if (oldCage) oldCage.remove();

  // Create cage control area at top of panel
  var cageArea = document.createElement('div');
  cageArea.id = 'bsCageArea';
  cageArea.style.cssText = 'background:rgba(245,215,66,0.1);border:1px solid #f5d742;border-radius:6px;padding:8px;';

  var html = '<div style="color:#f5d742;font-size:11px;font-weight:700;text-align:center;margin-bottom:6px;">🎱 Bingo Mini - ' + cages.length + ' Cages</div>';
  html += '<div id="bsCageButtons" style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin-bottom:6px;">';
  for (var i = 0; i < cages.length; i++) {
    html += '<div class="bs-cage-btn" data-cage="' + i + '" onclick="bingoSevenClickCage(' + i + ')" style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#f5d742,#c8960c);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:9px;font-weight:700;color:#333;border:2px solid #f5d742;box-shadow:0 2px 6px rgba(0,0,0,0.3);' + (i === 0 ? 'animation:bsCagePulse 1s infinite;' : 'opacity:0.5;pointer-events:none;') + '">' + (i + 1) + '</div>';
  }
  html += '</div>';
  html += '<div id="bsCageStatus" style="color:#aaa;font-size:10px;text-align:center;">Click cage 1 to release balls</div>';
  html += '<div id="bsBallArea" style="display:flex;flex-wrap:wrap;gap:3px;padding:4px;background:rgba(0,0,0,0.3);border-radius:4px;min-height:24px;margin-top:6px;"></div>';

  cageArea.innerHTML = html;
  panel.insertBefore(cageArea, panel.firstChild);
}

/**
 * Player clicks a cage button — send bonus_spin request to server.
 */
function bingoSevenClickCage(cageIdx) {
  if (cageIdx !== _bsCage.currentCage) return;
  if (_bsCage.waitingResponse) return; // prevent double click

  var balls = _bsCage.cages[cageIdx];
  if (!balls || balls.length === 0) return;

  _bsCage.waitingResponse = true;

  // Mark this cage button as processing
  var btn = document.querySelector('.bs-cage-btn[data-cage="' + cageIdx + '"]');
  if (btn) {
    btn.style.animation = 'none';
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';
  }

  // Update status
  var status = document.getElementById('bsCageStatus');
  if (status) status.textContent = 'Sending cage ' + (cageIdx + 1) + '...';

  // Send bonus_spin command
  var st = _slotState;
  var miniFeatureId = bingoSevenGetMiniFeatureId();
  var cmd = {
    cmd: 'bonus_spin',
    session_token: st.sessionToken,
    game_id: st.machineId,
    currency: st.currency,
    opt_id: st.loginResp.opt_id || '',
    username: st.loginResp.username || '',
    position: cageIdx,
    feature_id: miniFeatureId
  };
  playLog('>>> [BONUS SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
  // Response handled by bingoSevenHandleBonusSpinResponse via WS routing
}

/**
 * Release balls one by one — show in panel, mark on card.
 */
function bingoSevenReleaseBalls(balls, onComplete) {
  var idx = 0;

  function releaseNext() {
    if (idx >= balls.length) {
      if (onComplete) onComplete();
      return;
    }
    var ballNum = balls[idx];
    _bsCage.allBalls.push(ballNum);

    // Mark on bingo card
    bingoSevenMarkBall(ballNum);

    // Show ball in ball area
    var ballArea = document.getElementById('bsBallArea');
    if (ballArea) {
      ballArea.innerHTML += '<div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#4fc3f7,#0288d1);display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:#fff;animation:bsBallDrop 0.4s ease;">' + ballNum + '</div>';
    }

    idx++;
    setTimeout(releaseNext, 400);
  }
  releaseNext();
}

/**
 * Mark a ball on the bingo mini card.
 */
function bingoSevenMarkBall(ballNum) {
  var cells = document.querySelectorAll('#bsMiniPanel .bs-mini-cell');
  cells.forEach(function(cell) {
    if (parseInt(cell.getAttribute('data-num')) === ballNum) {
      cell.style.background = '#222';
      cell.style.color = '#fff';
      cell.style.boxShadow = '0 0 6px rgba(79,195,247,0.8)';
      setTimeout(function() { cell.style.boxShadow = ''; }, 600);
    }
  });
}

/**
 * All cages released — check patterns and show prize, then send round over.
 */
function bingoSevenCageComplete() {
  playLog('🎱 [BINGO MINI] all cages done, checking patterns');

  // Check patterns on the bingo card
  bingoSevenCheckPatterns();

  // Update status
  var status = document.getElementById('bsCageStatus');
  if (status) {
    status.style.color = '#27ae60';
    status.textContent = '🎉 Bingo Mini Complete! Prize: ' + _bsCage.prize.toFixed(2);
  }

  // Clear bonus pending flag and send round over
  _playBonusPending = false;
  slotRoundOver();
}

/**
 * Handle bonus_spin response from server.
 */
function bingoSevenHandleBonusSpinResponse(resp) {
  playLog('<<< [BONUS SPIN] response: ' + JSON.stringify(resp));
  _bsCage.waitingResponse = false;

  var cageIdx = _bsCage.currentCage;
  var balls = _bsCage.cages[cageIdx];

  // Mark cage button as done
  var btn = document.querySelector('.bs-cage-btn[data-cage="' + cageIdx + '"]');
  if (btn) {
    btn.style.background = '#27ae60';
    btn.style.borderColor = '#27ae60';
    btn.style.color = '#fff';
    btn.style.opacity = '1';
  }

  // Update status
  var status = document.getElementById('bsCageStatus');
  if (status) status.textContent = 'Releasing balls from cage ' + (cageIdx + 1) + '...';

  // Release balls one by one
  bingoSevenReleaseBalls(balls, function() {
    _bsCage.currentCage++;
    if (_bsCage.currentCage >= _bsCage.cages.length) {
      bingoSevenCageComplete();
    } else {
      // Enable next cage button
      var nextBtn = document.querySelector('.bs-cage-btn[data-cage="' + _bsCage.currentCage + '"]');
      if (nextBtn) {
        nextBtn.style.opacity = '1';
        nextBtn.style.pointerEvents = '';
        nextBtn.style.animation = 'bsCagePulse 1s infinite';
      }
      var st = document.getElementById('bsCageStatus');
      if (st) st.textContent = 'Click cage ' + (_bsCage.currentCage + 1) + ' to release balls';
    }
  });
}

/**
 * Get BingoMiniFeature feature_id from config.
 */
function bingoSevenGetMiniFeatureId() {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return 2;
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('BingoMiniFeature') >= 0) {
      return (features[i].config && features[i].config.feature_id) || 2;
    }
  }
  return 2;
}

/**
 * Reset bingo mini card (clear markings and ball area) on each new spin.
 */
function bingoSevenResetMiniCard() {
  // Reset card cell styles
  var cells = document.querySelectorAll('#bsMiniPanel .bs-mini-cell');
  cells.forEach(function(cell) {
    cell.style.background = '#f5f5f5';
    cell.style.color = '#333';
    cell.style.textDecoration = '';
    cell.style.boxShadow = '';
  });
  // Clear ball area
  var ballArea = document.getElementById('bsBallArea');
  if (ballArea) ballArea.innerHTML = '';
  // Remove cage area
  var cageArea = document.getElementById('bsCageArea');
  if (cageArea) cageArea.remove();
}

/**
 * Check bingo mini patterns against marked balls.
 */
function bingoSevenCheckPatterns() {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return;
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  var miniConfig = null;
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('BingoMiniFeature') >= 0) {
      miniConfig = features[i].config;
      break;
    }
  }
  if (!miniConfig) return;

  var patterns = miniConfig.pattern || [];
  var numPerCard = miniConfig.num_per_card || 15;
  var ballSet = new Set(_bsCage.allBalls);

  // Get card numbers from DOM
  var cardNums = [];
  document.querySelectorAll('#bsMiniPanel .bs-mini-cell').forEach(function(cell) {
    cardNums.push(parseInt(cell.getAttribute('data-num')) || 0);
  });

  // Check hits
  var cardHits = [];
  for (var i = 0; i < cardNums.length; i++) {
    cardHits.push(ballSet.has(cardNums[i]));
  }

  // Sort patterns by value desc
  var sorted = patterns.slice().sort(function(a, b) { return (b.value || 0) - (a.value || 0); });

  // Find winning pattern (highest_win: first match wins)
  for (var pi = 0; pi < sorted.length; pi++) {
    var p = sorted[pi];
    var fmt = p.format || '';
    if (fmt.length !== numPerCard) continue;
    var allMatch = true;
    for (var i = 0; i < numPerCard; i++) {
      if (fmt[i] === '1' && !cardHits[i]) { allMatch = false; break; }
    }
    if (allMatch) {
      // Mark winning cells with line-through
      for (var i = 0; i < numPerCard; i++) {
        if (fmt[i] === '1') {
          var cells = document.querySelectorAll('#bsMiniPanel .bs-mini-cell');
          if (cells[i]) {
            cells[i].style.textDecoration = 'line-through';
            cells[i].style.textDecorationColor = '#e74c3c';
            cells[i].style.textDecorationThickness = '2px';
          }
        }
      }
      playLog('🎱 [BINGO MINI] pattern hit: ' + p.name + ' x' + p.value);
      break; // highest_win: only first match
    }
  }
}
