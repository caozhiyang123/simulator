// ---------------------------------------------------------------------------
// DoubleMania Machine Plugin
// BonusGameFeature: When spin response has has_bonus:true, open a slot mini-game.
// The bonus game is a 1x4 (1 row, 4 reels) slot with icon images.
// ---------------------------------------------------------------------------
MachineRegistry.register('DoubleMania', {
  type: 'bingo',

  onSpinResponse: function(resp) {
    // If bonus game triggered, set flag to defer round over
    if (resp.has_bonus === true) {
      _playBonusPending = true;
    }
    // Call default spin handler
    playHandleSpinResponse(resp);
    // Open bonus game modal after a short delay
    if (resp.has_bonus === true) {
      setTimeout(function() {
        doubleManiaOpenBonusGame();
      }, 800);
    }
  }
});

// ---------------------------------------------------------------------------
// DoubleMania Bonus Game State
// ---------------------------------------------------------------------------
var _dmBonus = {
  active: false,
  totalWon: 0,
  totalBonusPrize: 0,
  spinning: false,
  loseCount: 0,
  maxLose: 7
};

// ---------------------------------------------------------------------------
// Open the Bonus Game Modal
// ---------------------------------------------------------------------------
function doubleManiaOpenBonusGame() {
  _dmBonus.active = true;
  _dmBonus.totalWon = 0;
  _dmBonus.totalBonusPrize = 0;
  _dmBonus.spinning = false;
  _dmBonus.loseCount = 0;

  // Get feature config for patterns
  var config = doubleManiaGetBonusConfig();
  var patterns = config.patterns || [];
  var valueMap = config.pattern_mapping_value_per_icon || [];

  // Remove existing modal if any
  var old = document.getElementById('dmBonusModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'dmBonusModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var container = document.createElement('div');
  container.id = 'dmBonusContainer';
  container.style.cssText = 'width:680px;max-width:95vw;background:linear-gradient(135deg,#1a5c1a,#2d8a2d,#1a5c1a);border-radius:12px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.6);position:relative;';

  // === TOP SECTION: Prize patterns + Won display + Lose tracker ===
  var topHtml = '<div style="display:flex;gap:12px;margin-bottom:16px;">';

  // Prize pattern tables (left)
  topHtml += '<div style="flex:1;display:flex;gap:8px;">';
  topHtml += doubleManiaRenderPatternTable(config, 'left');
  topHtml += doubleManiaRenderPatternTable(config, 'right');
  topHtml += '</div>';

  // Won display (center)
  topHtml += '<div style="width:120px;background:#000;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-direction:column;border:2px solid #333;">';
  topHtml += '<div style="color:#f5d742;font-size:11px;font-weight:700;margin-bottom:4px;">Won</div>';
  topHtml += '<div id="dmBonusWonDisplay" style="color:#fff;font-size:24px;font-weight:700;">0</div>';
  topHtml += '</div>';

  // Lose tracker (right)
  topHtml += '<div style="width:80px;background:rgba(255,255,200,0.9);border-radius:8px;padding:8px;text-align:center;">';
  topHtml += '<div style="color:#c00;font-size:11px;font-weight:700;margin-bottom:4px;">Lose</div>';
  topHtml += '<div id="dmBonusLoseTracker">';
  for (var i = 0; i < _dmBonus.maxLose; i++) {
    topHtml += '<div style="display:flex;align-items:center;justify-content:center;gap:2px;margin:2px 0;">';
    topHtml += '<span class="dm-lose-mark" data-idx="' + i + '" style="color:#0a0;font-size:14px;font-weight:700;">—</span>';
    topHtml += '<span class="dm-lose-mark" data-idx="' + i + '" style="color:#0a0;font-size:14px;font-weight:700;">—</span>';
    topHtml += '</div>';
  }
  topHtml += '</div></div>';
  topHtml += '</div>';

  // === MIDDLE SECTION: Slot reels (1x4, no gap, icons fill red border) ===
  var midHtml = '<div style="background:linear-gradient(to bottom,#1a3a8a,#2a4aaa,#1a3a8a);border-radius:10px;padding:20px 16px;margin-bottom:16px;border:3px solid #f5d742;">';
  midHtml += '<div id="dmBonusReels" style="display:flex;gap:0;justify-content:center;align-items:center;">';
  for (var r = 0; r < 4; r++) {
    midHtml += '<div class="dm-reel-frame" style="width:130px;height:130px;background:#fff;border:5px solid #c00;overflow:hidden;position:relative;">';
    midHtml += '<div id="dmReel' + r + '" class="dm-reel-strip" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">';
    midHtml += '<img src="/static/machine/DoubleMania/BonusGame/icon/i1.PNG" style="width:100%;height:100%;object-fit:cover;">';
    midHtml += '</div>';
    midHtml += '</div>';
  }
  midHtml += '</div>';
  midHtml += '</div>';

  // === BOTTOM SECTION: Status + 3D PLAY button (right-aligned) ===
  var botHtml = '<div style="display:flex;justify-content:flex-end;align-items:center;padding:4px 0;">';
  botHtml += '<div style="color:#fff;font-size:12px;margin-right:auto;" id="dmBonusStatus">🎰 Press PLAY to spin!</div>';
  botHtml += '<div id="dmBonusPlayBtn" onclick="doubleManiaSpinBonus()" class="dm-play-btn" style="width:110px;height:44px;border-radius:22px;cursor:pointer;user-select:none;position:relative;background:linear-gradient(to bottom,#f66 0%,#e33 40%,#b00 60%,#900 100%);border:2px solid #faa;box-shadow:0 4px 0 #600,0 6px 12px rgba(0,0,0,0.4),inset 0 1px 2px rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.5);letter-spacing:1px;">PLAY</div>';
  botHtml += '</div>';

  container.innerHTML = topHtml + midHtml + botHtml;
  modal.appendChild(container);
  document.body.appendChild(modal);

  playLog('🎰 [BONUS GAME] opened');
}

// ---------------------------------------------------------------------------
// Render pattern prize table (left or right half)
// ---------------------------------------------------------------------------
function doubleManiaRenderPatternTable(config, side) {
  // Use the actual pattern images
  var imgIdx = (side === 'left') ? 1 : 2;
  var html = '<div style="flex:1;background:rgba(255,255,200,0.9);border-radius:8px;padding:6px;text-align:center;">';
  html += '<div style="color:#c60;font-size:11px;font-weight:700;margin-bottom:4px;">Prize</div>';
  html += '<img src="/static/machine/DoubleMania/BonusGame/pattern/pattern' + imgIdx + '.PNG" style="width:100%;max-width:200px;height:auto;border-radius:4px;">';
  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Get BonusGameFeature config
// ---------------------------------------------------------------------------
function doubleManiaGetBonusConfig() {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return {};
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('BonusGameFeature') >= 0) {
      return features[i].config || {};
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Spin the Bonus Game reels
// ---------------------------------------------------------------------------
function doubleManiaSpinBonus() {
  if (_dmBonus.spinning || !_dmBonus.active) return;
  _dmBonus.spinning = true;

  var btn = document.getElementById('dmBonusPlayBtn');
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
  var status = document.getElementById('dmBonusStatus');
  if (status) status.textContent = '🎰 Spinning...';

  // Start reel spin animation
  doubleManiaAnimateReels();

  // Send bonus_game command
  var resp = _playCurrentMachine.response;
  var bonusCmd = {
    cmd: 'bonus_game',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || ''
  };
  playLog('>>> [BONUS GAME] send: ' + JSON.stringify(bonusCmd));
  _playWs.send(JSON.stringify(bonusCmd));
}

// ---------------------------------------------------------------------------
// Animate reels spinning (fake spin until response arrives)
// ---------------------------------------------------------------------------
var _dmReelTimers = [];

function doubleManiaAnimateReels() {
  // Each reel scrolls icons vertically (3 icons visible, moving up)
  for (var r = 0; r < 4; r++) {
    (function(reelIdx) {
      var offset = 0;
      _dmReelTimers[reelIdx] = setInterval(function() {
        var reelEl = document.getElementById('dmReel' + reelIdx);
        if (!reelEl) return;
        // Build a tall strip of icons scrolling vertically
        offset -= 20;
        if (offset <= -130) offset = 0;
        var icons = '';
        for (var k = 0; k < 4; k++) {
          var iconId = ((reelIdx + k + Math.floor(Math.abs(offset) / 30)) % 4) + 1;
          icons += '<img src="/static/machine/DoubleMania/BonusGame/icon/i' + iconId + '.PNG" style="width:100%;height:130px;object-fit:cover;display:block;flex-shrink:0;">';
        }
        reelEl.style.display = 'flex';
        reelEl.style.flexDirection = 'column';
        reelEl.style.alignItems = 'stretch';
        reelEl.style.justifyContent = 'flex-start';
        reelEl.style.top = offset + 'px';
        reelEl.innerHTML = icons;
      }, 50 + reelIdx * 10);
    })(r);
  }
}

// ---------------------------------------------------------------------------
// Stop reels with the result icons
// ---------------------------------------------------------------------------
function doubleManiaStopReels(icons) {
  // Stop reels one by one with staggered delay
  for (var r = 0; r < 4; r++) {
    (function(reelIdx) {
      setTimeout(function() {
        if (_dmReelTimers[reelIdx]) {
          clearInterval(_dmReelTimers[reelIdx]);
          _dmReelTimers[reelIdx] = null;
        }
        var iconId = icons[reelIdx] || 1;
        var reelEl = document.getElementById('dmReel' + reelIdx);
        if (reelEl) {
          reelEl.style.top = '0';
          reelEl.style.display = 'flex';
          reelEl.style.flexDirection = 'column';
          reelEl.style.alignItems = 'center';
          reelEl.style.justifyContent = 'center';
          // Check if this is the "over" icon (game over icon = 5)
          var config = doubleManiaGetBonusConfig();
          var overIcon = config.over_icon || 5;
          if (iconId === overIcon) {
            // Show X mark for lose — fills the frame
            reelEl.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;font-size:70px;color:#c00;font-weight:700;">✕</div>';
          } else {
            reelEl.innerHTML = '<img src="/static/machine/DoubleMania/BonusGame/icon/i' + iconId + '.PNG" style="width:100%;height:100%;object-fit:cover;animation:dmReelBounce 0.3s ease;">';
          }
        }
      }, 400 + reelIdx * 300);
    })(r);
  }
}

// ---------------------------------------------------------------------------
// Handle bonus_game response from server
// ---------------------------------------------------------------------------
function doubleManiaHandleBonusResponse(resp) {
  playLog('<<< [BONUS GAME] response: ' + JSON.stringify(resp));

  if (!_dmBonus.active) return;

  var icons = resp.icons || [];
  var bonusPrize = resp.bonus_prize || 0;
  var totalBonusPrize = resp.total_bonus_prize || 0;
  var totalWon = resp.total_won || 0;
  var isOver = resp.is_bonus_over === true;

  _dmBonus.totalWon = totalWon;
  _dmBonus.totalBonusPrize = totalBonusPrize;

  // Stop reels with result icons
  doubleManiaStopReels(icons);

  // After reels stop, update display
  var stopDelay = 400 + 4 * 300 + 200; // wait for all 4 reels to stop
  setTimeout(function() {
    // Update Won display
    var wonEl = document.getElementById('dmBonusWonDisplay');
    if (wonEl) wonEl.textContent = totalBonusPrize.toLocaleString();

    // Check for lose icons (over_icon = 5)
    var config = doubleManiaGetBonusConfig();
    var overIcon = config.over_icon || 5;
    var hasLose = false;
    for (var i = 0; i < icons.length; i++) {
      if (icons[i] === overIcon) { hasLose = true; break; }
    }

    if (hasLose) {
      // Mark a lose entry
      doubleManiaMarkLose();
    }

    if (isOver) {
      // Game over
      _dmBonus.spinning = false;
      var status = document.getElementById('dmBonusStatus');
      if (status) status.textContent = '🎰 Bonus Game Over! Won: ' + totalBonusPrize.toFixed(2);
      var btn = document.getElementById('dmBonusPlayBtn');
      if (btn) {
        btn.textContent = 'CLOSE';
        btn.style.opacity = '1';
        btn.style.pointerEvents = '';
        btn.onclick = function() { doubleManiaCloseBonusGame(); };
      }
      // Update main game balance
      playSetBalanceImmediate(resp.balance || playGetCurrentBalance());
      // Update win display
      document.getElementById('playWinDisplay').textContent = 'WIN: ' + totalWon.toFixed(2);
    } else {
      // Can continue spinning
      _dmBonus.spinning = false;
      var btn = document.getElementById('dmBonusPlayBtn');
      if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = ''; }
      var status = document.getElementById('dmBonusStatus');
      if (status) {
        if (bonusPrize > 0) {
          status.textContent = '🎉 Won ' + bonusPrize.toFixed(2) + '! Press PLAY to continue.';
        } else {
          status.textContent = '🎰 Press PLAY to spin!';
        }
      }
    }
  }, stopDelay);
}

// ---------------------------------------------------------------------------
// Mark a lose entry in the lose tracker
// ---------------------------------------------------------------------------
function doubleManiaMarkLose() {
  _dmBonus.loseCount++;
  var marks = document.querySelectorAll('#dmBonusLoseTracker .dm-lose-mark[data-idx="' + (_dmBonus.loseCount - 1) + '"]');
  marks.forEach(function(m) {
    m.textContent = '✕';
    m.style.color = '#c00';
  });
}

// ---------------------------------------------------------------------------
// Close the Bonus Game Modal
// ---------------------------------------------------------------------------
function doubleManiaCloseBonusGame() {
  _dmBonus.active = false;
  // Clear any remaining reel timers
  for (var i = 0; i < _dmReelTimers.length; i++) {
    if (_dmReelTimers[i]) { clearInterval(_dmReelTimers[i]); _dmReelTimers[i] = null; }
  }
  var modal = document.getElementById('dmBonusModal');
  if (modal) modal.remove();
  playLog('🎰 [BONUS GAME] closed');

  // Now send round over (was deferred while bonus game was active)
  _playBonusPending = false;
  if (_playSpinState === 'waiting_roundover') {
    playRoundOver();
  }
}
