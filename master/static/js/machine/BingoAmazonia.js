// ---------------------------------------------------------------------------
// BingoAmazonia Machine Plugin (Slot)
// 3x5 slot, 9 icons, 20 lines.
// Features: BingoMiniFeature (mini bingo game triggered by scatter icons)
// Custom background (.jpg) and pattern path.
// ---------------------------------------------------------------------------
MachineRegistry.register('BingoAmazonia', {
  type: 'slot',

  assets: {
    background: '/static/machine/BingoAmazonia/background/BingoAmazonia.jpg',
    pattern: '/static/machine/BingoAmazonia/pattern/BingoAmazonia.PNG',
    icons: '/static/machine/BingoAmazonia/icon/'
  },

  afterRender: function(resp, config) {
    // Balance display — reposition
    var balEl = document.getElementById('slotBalance');
    if (balEl) {
      balEl.style.top = '14%';
      balEl.style.left = '15%';
      balEl.style.width = '35%';
      balEl.style.fontSize = '13px';
    }

    // Jackpot display — reposition
    var jpEl = document.getElementById('slotJackpotDisplay');
    if (jpEl) {
      jpEl.style.top = '14%';
      jpEl.style.right = '15%';
      jpEl.style.width = '35%';
      jpEl.style.fontSize = '13px';
    }

    // Reels container — adjust position, size, and remove gaps
    var reelsEl = document.getElementById('slotReelsContainer');
    if (reelsEl) {
      reelsEl.style.top = '24%';
      reelsEl.style.left = '24%';
      reelsEl.style.width = '35%';
      reelsEl.style.height = '22%';
      reelsEl.style.gap = '0';
    }
    // Remove gap between individual reel wrappers
    var reelWrappers = document.querySelectorAll('#slotReelsContainer .slot-reel-wrapper');
    reelWrappers.forEach(function(w) {
      w.style.marginLeft = '0';
      w.style.marginRight = '0';
      w.style.borderRadius = '0';
    });

    // Reposition controls bar — same horizontal line, equal spacing
    // Balance at 14%, Reels at 24%, gap = 10%. Reels bottom = 46%. Controls at 56%.
    var controlsBar = document.getElementById('slotControlsBar');
    if (controlsBar) {
      controlsBar.style.top = '56%';
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

    // Override BET and LINE +/- buttons to 3D box style
    var btns = document.querySelectorAll('#slotControlsBar .slot-btn-3d');
    btns.forEach(function(btn) {
      var text = btn.textContent;
      btn.className = 'ba-btn-silver';
      btn.innerHTML = '<div class="ba-face-top"></div><div class="ba-face-front"><span style="color:#fff;font-size:14px;font-weight:800;">' + text + '</span></div><div class="ba-face-right"></div>';
    });

    // SPIN button — 3D box
    var spinBtn = document.getElementById('slotSpinBtn');
    if (spinBtn) {
      spinBtn.className = 'ba-spin-btn';
      spinBtn.style.width = '50px';
      spinBtn.style.height = '30px';
      spinBtn.innerHTML = '<div class="ba-face-top"></div><div class="ba-face-front"><span style="font-size:12px;font-weight:900;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.6);letter-spacing:1px;">SPIN</span></div><div class="ba-face-right"></div>';
    }

    // COLLECT button — 3D box
    var collectBtn = document.getElementById('slotCollectBtn');
    if (collectBtn) {
      var collectText = collectBtn.textContent || 'COLLECT';
      collectBtn.className = 'ba-btn-silver';
      collectBtn.innerHTML = '<div class="ba-face-top"></div><div class="ba-face-front"><span style="color:#fff;font-size:9px;font-weight:800;">' + collectText + '</span></div><div class="ba-face-right"></div>';
    }

    // BingoMini card — render to the right of reels
    bingoAmazoniaRenderMiniCard(resp, config);
  },

  onSpinResponse: function(resp) {
    // Clear bingo mini card markings and ball area on each spin
    bingoAmazoniaResetMiniCard();

    // If BingoMini feature triggered, set pending flag to defer round over
    if (resp.base_ball_numbers_per_cage && resp.base_ball_numbers_per_cage.length > 0) {
      _playBonusPending = true;
    }

    // Default slot spin handling
    slotHandleSpinResponse(resp);

    // Start cage animation after reels stop
    if (resp.base_ball_numbers_per_cage && resp.base_ball_numbers_per_cage.length > 0) {
      setTimeout(function() {
        bingoAmazoniaStartCageAnimation(resp.base_ball_numbers_per_cage, resp.bingo_mini_prize || 0);
      }, 3500);
    }
  }
});

// ---------------------------------------------------------------------------
// BingoAmazonia Mini Card (5x3) with patterns above
// ---------------------------------------------------------------------------
function bingoAmazoniaRenderMiniCard(resp, config) {
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

  // Remove existing mini card
  var old = document.getElementById('baMiniCardArea');
  if (old) old.remove();

  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;

  // Container positioned to the right of reels, top aligned with reels top, bottom aligned with reels bottom
  var container = document.createElement('div');
  container.id = 'baMiniCardArea';
  container.style.cssText = 'position:absolute;top:24%;left:59%;width:19%;height:22%;display:flex;flex-direction:column;gap:0;';

  // Patterns area (fills top space, card at bottom) — auto-scale to fit container width
  var patHtml = '<div style="flex:1;display:flex;flex-wrap:wrap;gap:2px;align-content:flex-start;padding:2px;background:rgba(0,0,0,0.5);border-radius:3px 3px 0 0;overflow-y:auto;overflow-x:hidden;">';
  patterns.forEach(function(p) {
    var fmt = p.format || '';
    patHtml += '<div style="display:grid;grid-template-columns:repeat(' + cardWidth + ',1fr);gap:0px;width:30px;" title="' + p.name + ' x' + p.value + '">';
    for (var i = 0; i < fmt.length; i++) {
      patHtml += '<div style="aspect-ratio:1.5;background:' + (fmt[i] === '1' ? '#f5d742' : '#333') + ';"></div>';
    }
    patHtml += '</div>';
  });
  patHtml += '</div>';

  // Card area (5x3 grid, fixed at bottom)
  var cardHtml = '<div style="display:grid;grid-template-columns:repeat(' + cardWidth + ',1fr);gap:1px;background:#1a1a2e;border-radius:0 0 3px 3px;padding:1px;">';
  for (var i = 0; i < cardsNumber.length; i++) {
    var num = cardsNumber[i];
    cardHtml += '<div class="ba-mini-cell" data-idx="' + i + '" data-num="' + num + '" style="background:#f0f0f0;text-align:center;font-size:9px;font-weight:600;color:#333;padding:2px 0;line-height:1.2;">' + (num < 10 ? '0' + num : num) + '</div>';
  }
  cardHtml += '</div>';

  container.innerHTML = patHtml + cardHtml;
  slotSkin.appendChild(container);
}

// ===========================================================================
// BingoAmazonia Cage Animation (same logic as BingoSeven)
// ===========================================================================
var _baCage = {
  cages: [],
  prize: 0,
  currentCage: 0,
  allBalls: [],
  waitingResponse: false
};

function bingoAmazoniaResetMiniCard() {
  var cells = document.querySelectorAll('#baMiniCardArea .ba-mini-cell');
  cells.forEach(function(cell) {
    cell.style.background = '#f0f0f0';
    cell.style.color = '#333';
    cell.style.textDecoration = '';
    cell.style.boxShadow = '';
  });
  var ballArea = document.getElementById('baBallArea');
  if (ballArea) ballArea.innerHTML = '';
  var cageArea = document.getElementById('baCageArea');
  if (cageArea) cageArea.remove();
}

function bingoAmazoniaStartCageAnimation(cages, prize) {
  _baCage.cages = cages;
  _baCage.prize = prize;
  _baCage.currentCage = 0;
  _baCage.allBalls = [];
  _baCage.waitingResponse = false;

  playLog('🎱 [BA BINGO MINI] triggered: ' + cages.length + ' cages, prize: ' + prize);

  var container = document.getElementById('baMiniCardArea');
  if (!container) return;

  var oldCage = document.getElementById('baCageArea');
  if (oldCage) oldCage.remove();

  var cageArea = document.createElement('div');
  cageArea.id = 'baCageArea';
  cageArea.style.cssText = 'margin-bottom:4px;padding:4px;background:rgba(245,215,66,0.1);border:1px solid #f5d742;border-radius:4px;';

  var html = '<div style="display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-bottom:3px;">';
  for (var i = 0; i < cages.length; i++) {
    html += '<div class="ba-cage-btn" data-cage="' + i + '" onclick="bingoAmazoniaClickCage(' + i + ')" style="width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,#f5d742,#c8960c);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:7px;font-weight:700;color:#333;border:1px solid #f5d742;' + (i === 0 ? 'animation:bsCagePulse 1s infinite;' : 'opacity:0.5;pointer-events:none;') + '">' + (i + 1) + '</div>';
  }
  html += '</div>';
  html += '<div id="baCageStatus" style="color:#aaa;font-size:8px;text-align:center;">Click 1</div>';
  html += '<div id="baBallArea" style="display:flex;flex-wrap:wrap;gap:2px;padding:2px;background:rgba(0,0,0,0.3);border-radius:3px;min-height:16px;margin-top:3px;"></div>';

  cageArea.innerHTML = html;
  container.insertBefore(cageArea, container.firstChild);
}

function bingoAmazoniaClickCage(cageIdx) {
  if (cageIdx !== _baCage.currentCage) return;
  if (_baCage.waitingResponse) return;

  var balls = _baCage.cages[cageIdx];
  if (!balls || balls.length === 0) return;

  _baCage.waitingResponse = true;

  var btn = document.querySelector('.ba-cage-btn[data-cage="' + cageIdx + '"]');
  if (btn) { btn.style.animation = 'none'; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }

  var status = document.getElementById('baCageStatus');
  if (status) status.textContent = 'Sending...';

  var st = _slotState;
  var featureId = bingoAmazoniaGetMiniFeatureId();
  var cmd = {
    cmd: 'bonus_spin',
    session_token: st.sessionToken,
    game_id: st.machineId,
    currency: st.currency,
    opt_id: st.loginResp.opt_id || '',
    username: st.loginResp.username || '',
    position: cageIdx,
    feature_id: featureId
  };
  playLog('>>> [BA BONUS SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

function bingoAmazoniaHandleBonusSpinResponse(resp) {
  playLog('<<< [BA BONUS SPIN] response');
  _baCage.waitingResponse = false;

  var cageIdx = _baCage.currentCage;
  var balls = _baCage.cages[cageIdx];

  var btn = document.querySelector('.ba-cage-btn[data-cage="' + cageIdx + '"]');
  if (btn) { btn.style.background = '#27ae60'; btn.style.borderColor = '#27ae60'; btn.style.color = '#fff'; btn.style.opacity = '1'; }

  bingoAmazoniaReleaseBalls(balls, function() {
    _baCage.currentCage++;
    if (_baCage.currentCage >= _baCage.cages.length) {
      bingoAmazoniaCageComplete();
    } else {
      var nextBtn = document.querySelector('.ba-cage-btn[data-cage="' + _baCage.currentCage + '"]');
      if (nextBtn) { nextBtn.style.opacity = '1'; nextBtn.style.pointerEvents = ''; nextBtn.style.animation = 'bsCagePulse 1s infinite'; }
      var st = document.getElementById('baCageStatus');
      if (st) st.textContent = 'Click ' + (_baCage.currentCage + 1);
    }
  });
}

function bingoAmazoniaReleaseBalls(balls, onComplete) {
  var idx = 0;
  function next() {
    if (idx >= balls.length) { if (onComplete) onComplete(); return; }
    var ballNum = balls[idx];
    _baCage.allBalls.push(ballNum);
    bingoAmazoniaMarkBall(ballNum);
    var ballArea = document.getElementById('baBallArea');
    if (ballArea) {
      ballArea.innerHTML += '<div style="width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#4fc3f7,#0288d1);display:inline-flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:#fff;animation:bsBallDrop 0.4s ease;">' + ballNum + '</div>';
    }
    idx++;
    setTimeout(next, 350);
  }
  next();
}

function bingoAmazoniaMarkBall(ballNum) {
  var cells = document.querySelectorAll('#baMiniCardArea .ba-mini-cell');
  cells.forEach(function(cell) {
    if (parseInt(cell.getAttribute('data-num')) === ballNum) {
      cell.style.background = '#222';
      cell.style.color = '#fff';
      cell.style.boxShadow = '0 0 4px rgba(79,195,247,0.8)';
      setTimeout(function() { cell.style.boxShadow = ''; }, 500);
    }
  });
}

function bingoAmazoniaCageComplete() {
  playLog('🎱 [BA BINGO MINI] complete');
  bingoAmazoniaCheckPatterns();
  var status = document.getElementById('baCageStatus');
  if (status) { status.style.color = '#27ae60'; status.textContent = '🎉 +' + _baCage.prize.toFixed(2); }
  _playBonusPending = false;
  slotRoundOver();
}

function bingoAmazoniaCheckPatterns() {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return;
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  var miniConfig = null;
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('BingoMiniFeature') >= 0) { miniConfig = features[i].config; break; }
  }
  if (!miniConfig) return;

  var patterns = miniConfig.pattern || [];
  var numPerCard = miniConfig.num_per_card || 15;
  var ballSet = new Set(_baCage.allBalls);

  var cardNums = [];
  document.querySelectorAll('#baMiniCardArea .ba-mini-cell').forEach(function(cell) {
    cardNums.push(parseInt(cell.getAttribute('data-num')) || 0);
  });

  var cardHits = [];
  for (var i = 0; i < cardNums.length; i++) cardHits.push(ballSet.has(cardNums[i]));

  var sorted = patterns.slice().sort(function(a, b) { return (b.value || 0) - (a.value || 0); });
  for (var pi = 0; pi < sorted.length; pi++) {
    var p = sorted[pi];
    var fmt = p.format || '';
    if (fmt.length !== numPerCard) continue;
    var allMatch = true;
    for (var i = 0; i < numPerCard; i++) { if (fmt[i] === '1' && !cardHits[i]) { allMatch = false; break; } }
    if (allMatch) {
      var cells = document.querySelectorAll('#baMiniCardArea .ba-mini-cell');
      for (var i = 0; i < numPerCard; i++) {
        if (fmt[i] === '1' && cells[i]) {
          cells[i].style.textDecoration = 'line-through';
          cells[i].style.textDecorationColor = '#e74c3c';
          cells[i].style.textDecorationThickness = '2px';
        }
      }
      playLog('🎱 [BA BINGO MINI] pattern hit: ' + p.name + ' x' + p.value);
      break;
    }
  }
}

function bingoAmazoniaGetMiniFeatureId() {
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
