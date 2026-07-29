// ---------------------------------------------------------------------------
// WildWestBingo Machine Plugin (Bingo)
// 5x3 cards, max 16 cards, overlap_win pattern matching.
// Features: SlotBonusFeature (deferred bonus game with bonus_start),
//           BuffDoubleFreeEBFeature (free extra balls — same as CalacaBingo lightning_ebs),
//           BuffCalaWildEBFeature (wild/lucky ball — same as CalacaBingo magic_available_balls),
//           GoldenBadgeFeature (golden badge multiplier wheel),
//           MoreRepeatNumberFeature (repeated numbers across cards)
// ---------------------------------------------------------------------------
MachineRegistry.register('WildWestBingo', {
  type: 'bingo',

  // Handle reconnection state from login response (bonus_slot in login data)
  afterRender: function(resp, machineConfig) {
    wildWestHandleLoginBonusState(resp);
  },

  onSpinResponse: function(resp) {
    // Always update slot bonus state from latest server response (spin or EB)
    wildWestUpdateBonusState(resp);

    // Lucky ball (BuffCalaWildEBFeature) — same handling as CalacaBingo
    if (resp.extra !== undefined && resp.magic_available_balls && resp.magic_available_balls.length > 0) {
      _superRichMagicBalls = resp.magic_available_balls;
      _superRichLastEb = resp.extra;
      playHandleBuyEbResponse(resp);
      playDisableEbButton();
      setTimeout(function() {
        superRichShowLuckyBallModal(_superRichMagicBalls);
      }, 600);
    } else if (resp.extra !== undefined) {
      // Normal EB response
      playHandleBuyEbResponse(resp);

      // Free EB (BuffDoubleFreeEBFeature) — same as CalacaBingo lightning_ebs
      if (resp.lightning_ebs && resp.lightning_ebs.length > 0) {
        setTimeout(function() {
          carnavalLightningEb(resp.lightning_ebs);
        }, 400);
      }

      // Check for golden badge collection during EB
      if (resp.golden_badge) {
        wildWestUpdateGoldenBadge(resp.golden_badge);
      }
    } else {
      // Normal spin response
      playHandleSpinResponse(resp);

      // Free EB on initial spin
      if (resp.lightning_ebs && resp.lightning_ebs.length > 0) {
        setTimeout(function() {
          carnavalLightningEb(resp.lightning_ebs);
        }, 400);
      }

      // Check for golden badge collection during spin
      if (resp.golden_badge) {
        wildWestUpdateGoldenBadge(resp.golden_badge);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// WildWestBingo Slot Bonus State (same pattern as DoubleMania)
// ---------------------------------------------------------------------------
var _wwBonusHasBonus = false;   // true when bonus_slot is present in response
var _wwBonusMultiplier = 0;     // multiplier from bonus_slot JSON
var _wwBonusRemainingSpins = 0; // bonus_remaining_spins from bonus_slot JSON
var _wwBonus = {
  active: false,
  totalWon: 0,
  totalBonusPrize: 0,
  spinning: false,
  spinsLeft: 0,
  totalSpins: 0
};

// ---------------------------------------------------------------------------
// Update bonus state from every spin/EB response (always overwrite with latest)
// Data comes via "bonus_slot" field as a JSON string.
// ---------------------------------------------------------------------------
function wildWestUpdateBonusState(resp) {
  if (resp.bonus_slot) {
    // Parse bonus_slot JSON string
    var bonusData = {};
    try {
      bonusData = (typeof resp.bonus_slot === 'string') ? JSON.parse(resp.bonus_slot) : resp.bonus_slot;
    } catch (e) {
      playLog('[WildWestBingo] ERROR parsing bonus_slot: ' + e);
      bonusData = {};
    }
    _wwBonusHasBonus = true;
    _wwBonusMultiplier = bonusData.multiplier || 0;
    _wwBonusRemainingSpins = bonusData.bonus_remaining_spins || 8;
    _playBonusPending = true;
    playLog('[WildWestBingo] bonus_slot detected: multiplier=' + _wwBonusMultiplier + ', remaining_spins=' + _wwBonusRemainingSpins);
  } else {
    _wwBonusHasBonus = false;
    _playBonusPending = false;
  }
}

// ---------------------------------------------------------------------------
// Handle bonus state from login response (reconnection scenario)
// Login returns bonus_slot with bonus_start flag:
//   bonus_start=false: player disconnected before entering bonus game
//     -> if has_extra_ball, allow EB purchase; bonus deferred as normal
//   bonus_start=true: player disconnected after entering bonus game
//     -> skip EB, directly enter bonus game if bonus_remaining_spins > 0
//     -> otherwise just round over
// ---------------------------------------------------------------------------
function wildWestHandleLoginBonusState(resp) {
  if (!resp.bonus_slot) return;

  var bonusData = {};
  try {
    bonusData = (typeof resp.bonus_slot === 'string') ? JSON.parse(resp.bonus_slot) : resp.bonus_slot;
  } catch (e) {
    playLog('[WildWestBingo] ERROR parsing login bonus_slot: ' + e);
    return;
  }

  var bonusStart = bonusData.bonus_start === true;
  var remainingSpins = bonusData.bonus_remaining_spins || 0;
  var multiplier = bonusData.multiplier || 0;

  playLog('[WildWestBingo] login bonus_slot: bonus_start=' + bonusStart + ', remaining_spins=' + remainingSpins + ', multiplier=' + multiplier);

  // Store bonus state
  _wwBonusMultiplier = multiplier;
  _wwBonusRemainingSpins = remainingSpins;

  if (bonusStart) {
    // Player was already inside bonus game before disconnect
    // Do NOT allow EB purchase — go directly into bonus game or round over
    _wwBonusHasBonus = true;
    _playBonusPending = true;

    if (remainingSpins > 0) {
      // Resume bonus game after a short delay for UI to render
      setTimeout(function() {
        wildWestOpenBonusGame();
      }, 1000);
    } else {
      // No spins left — just send round over
      _playBonusPending = false;
      _wwBonusHasBonus = false;
      setTimeout(function() {
        _playSpinState = 'waiting_roundover';
        playRoundOver();
      }, 1000);
    }
  } else {
    // Player disconnected before entering bonus game
    // Allow normal EB purchase flow; bonus will be triggered at round end as usual
    if (remainingSpins > 0) {
      _wwBonusHasBonus = true;
      _playBonusPending = true;
    }
    // If has_extra_ball is true, the normal UI will show EB buttons
  }
}

// ---------------------------------------------------------------------------
// Trigger bonus game (called when round is about to end and has_bonus is true)
// Sends bonus_start first, then opens the modal after server confirms.
// ---------------------------------------------------------------------------
function wildWestTriggeredBonusBeforeRoundOver() {
  if (_wwBonusHasBonus) {
    wildWestSendBonusStart(6); // SlotBonusFeature feature_id = 6
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Send bonus_start command to server
// ---------------------------------------------------------------------------
function wildWestSendBonusStart(featureId) {
  var resp = _playCurrentMachine.response;
  var cmd = {
    cmd: 'bonus_start',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    feature_id: featureId || 6
  };
  playLog('>>> [WW BONUS START] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

// ---------------------------------------------------------------------------
// Handle bonus_start response from server
// ---------------------------------------------------------------------------
function wildWestHandleBonusStartResponse(resp) {
  playLog('[WildWestBingo] bonus_start confirmed: ' + JSON.stringify(resp));
  if (resp.bonus_start === true) {
    wildWestOpenBonusGame();
  } else {
    playLog('[WildWestBingo] bonus_start rejected, proceeding with round over');
    _playBonusPending = false;
    _wwBonusHasBonus = false;
    if (_playSpinState === 'waiting_roundover') {
      playRoundOver();
    }
  }
}

// ---------------------------------------------------------------------------
// Open the Slot Bonus Game Modal
// ---------------------------------------------------------------------------
function wildWestOpenBonusGame() {
  var config = wildWestGetBonusConfig();
  var spins = _wwBonusRemainingSpins || config.base_bonus_spins || 8;

  _wwBonus.active = true;
  _wwBonus.totalWon = 0;
  _wwBonus.totalBonusPrize = 0;
  _wwBonus.spinning = false;
  _wwBonus.spinsLeft = spins;
  _wwBonus.totalSpins = spins;

  // Remove existing modal if any
  var old = document.getElementById('wwBonusModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'wwBonusModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var container = document.createElement('div');
  container.id = 'wwBonusContainer';
  container.style.cssText = 'width:680px;max-width:95vw;background:linear-gradient(135deg,#3d1f00,#6b3a1a,#3d1f00);border-radius:12px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.6);position:relative;border:2px solid #c8860a;';

  // === TOP SECTION: Spins left + Won display + Multiplier ===
  var topHtml = '<div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;">';

  // Pattern prize table
  topHtml += '<div style="flex:1;background:rgba(255,255,200,0.9);border-radius:8px;padding:6px;text-align:center;">';
  topHtml += '<div style="color:#8b4513;font-size:11px;font-weight:700;margin-bottom:4px;">Prize</div>';
  topHtml += '<img src="/static/machine/WildWestBingo/BonusGame/pattern/pattern1.PNG" style="width:100%;max-width:180px;height:auto;border-radius:4px;">';
  topHtml += '</div>';

  // Spins left
  topHtml += '<div style="flex:1;background:rgba(0,0,0,0.5);border-radius:8px;padding:10px;text-align:center;border:1px solid #c8860a;">';
  topHtml += '<div style="color:#c8860a;font-size:11px;font-weight:700;">SPINS LEFT</div>';
  topHtml += '<div id="wwBonusSpinsLeft" style="color:#fff;font-size:24px;font-weight:700;">' + _wwBonus.spinsLeft + '</div>';
  topHtml += '</div>';

  // Won display
  topHtml += '<div style="flex:1;background:rgba(0,0,0,0.5);border-radius:8px;padding:10px;text-align:center;border:1px solid #c8860a;">';
  topHtml += '<div style="color:#c8860a;font-size:11px;font-weight:700;">WON</div>';
  topHtml += '<div id="wwBonusWonDisplay" style="color:#fff;font-size:24px;font-weight:700;">0</div>';
  topHtml += '</div>';

  // Multiplier display
  if (_wwBonusMultiplier > 0) {
    topHtml += '<div style="flex:1;background:rgba(0,0,0,0.5);border-radius:8px;padding:10px;text-align:center;border:1px solid #2ecc71;">';
    topHtml += '<div style="color:#2ecc71;font-size:11px;font-weight:700;">MULTIPLIER</div>';
    topHtml += '<div id="wwBonusMultiplierDisplay" style="color:#2ecc71;font-size:24px;font-weight:700;text-shadow:0 0 8px #2ecc71;">x' + _wwBonusMultiplier + '</div>';
    topHtml += '</div>';
  }

  topHtml += '</div>';

  // === MIDDLE SECTION: Slot reels (1x4) ===
  var midHtml = '<div style="background:linear-gradient(to bottom,#1a1a1a,#333,#1a1a1a);border-radius:10px;padding:20px 16px;margin-bottom:16px;border:3px solid #c8860a;">';
  midHtml += '<div id="wwBonusReels" style="display:flex;gap:4px;justify-content:center;align-items:center;">';
  for (var r = 0; r < 4; r++) {
    midHtml += '<div class="ww-reel-frame" style="width:130px;height:130px;background:#fff;border:4px solid #8b4513;border-radius:4px;overflow:hidden;position:relative;">';
    midHtml += '<div id="wwReel' + r + '" class="ww-reel-strip" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">';
    midHtml += '<img src="/static/machine/WildWestBingo/BonusGame/icon/i1.png" style="width:100%;height:100%;object-fit:cover;">';
    midHtml += '</div>';
    midHtml += '</div>';
  }
  midHtml += '</div>';
  midHtml += '</div>';

  // === BOTTOM SECTION: Status + PLAY button ===
  var botHtml = '<div style="display:flex;justify-content:flex-end;align-items:center;padding:4px 0;">';
  botHtml += '<div style="color:#fff;font-size:12px;margin-right:auto;" id="wwBonusStatus">🤠 Press PLAY to spin!</div>';
  botHtml += '<div id="wwBonusPlayBtn" onclick="wildWestSpinBonus()" style="width:110px;height:44px;border-radius:22px;cursor:pointer;user-select:none;background:linear-gradient(to bottom,#daa520 0%,#b8860b 40%,#8b6914 60%,#6b4e0a 100%);border:2px solid #ffd700;box-shadow:0 4px 0 #4a3000,0 6px 12px rgba(0,0,0,0.4),inset 0 1px 2px rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.5);letter-spacing:1px;">PLAY</div>';
  botHtml += '</div>';

  container.innerHTML = topHtml + midHtml + botHtml;
  modal.appendChild(container);
  document.body.appendChild(modal);

  playLog('🤠 [WW BONUS GAME] opened (multiplier: x' + _wwBonusMultiplier + ', spins: ' + spins + ')');
}

// ---------------------------------------------------------------------------
// Get SlotBonusFeature config
// ---------------------------------------------------------------------------
function wildWestGetBonusConfig() {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return {};
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('SlotBonusFeature') >= 0) {
      return features[i].config || {};
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Spin the Bonus Game reels
// ---------------------------------------------------------------------------
function wildWestSpinBonus() {
  if (_wwBonus.spinning || !_wwBonus.active || _wwBonus.spinsLeft <= 0) return;
  _wwBonus.spinning = true;

  var btn = document.getElementById('wwBonusPlayBtn');
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
  var status = document.getElementById('wwBonusStatus');
  if (status) status.textContent = '🤠 Spinning...';

  // Start reel spin animation
  wildWestAnimateReels();

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
  playLog('>>> [WW BONUS GAME] send: ' + JSON.stringify(bonusCmd));
  _playWs.send(JSON.stringify(bonusCmd));
}

// ---------------------------------------------------------------------------
// Animate reels spinning
// ---------------------------------------------------------------------------
var _wwReelTimers = [];

function wildWestAnimateReels() {
  for (var r = 0; r < 4; r++) {
    (function(reelIdx) {
      var offset = 0;
      var iconCount = 6; // 6 icons for WildWestBingo
      _wwReelTimers[reelIdx] = setInterval(function() {
        var reelEl = document.getElementById('wwReel' + reelIdx);
        if (!reelEl) return;
        offset -= 20;
        if (offset <= -130) offset = 0;
        var icons = '';
        for (var k = 0; k < 4; k++) {
          var iconId = ((reelIdx + k + Math.floor(Math.abs(offset) / 30)) % iconCount) + 1;
          icons += '<img src="/static/machine/WildWestBingo/BonusGame/icon/i' + iconId + '.png" style="width:100%;height:130px;object-fit:cover;display:block;flex-shrink:0;">';
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
// Stop reels with result icons
// ---------------------------------------------------------------------------
function wildWestStopReels(icons) {
  for (var r = 0; r < 4; r++) {
    (function(reelIdx) {
      setTimeout(function() {
        if (_wwReelTimers[reelIdx]) {
          clearInterval(_wwReelTimers[reelIdx]);
          _wwReelTimers[reelIdx] = null;
        }
        var iconId = icons[reelIdx] || 1;
        var reelEl = document.getElementById('wwReel' + reelIdx);
        if (reelEl) {
          reelEl.style.top = '0';
          reelEl.style.display = 'flex';
          reelEl.style.flexDirection = 'column';
          reelEl.style.alignItems = 'center';
          reelEl.style.justifyContent = 'center';
          reelEl.innerHTML = '<img src="/static/machine/WildWestBingo/BonusGame/icon/i' + iconId + '.png" style="width:100%;height:100%;object-fit:cover;animation:wwReelBounce 0.3s ease;">';
        }
      }, 400 + reelIdx * 300);
    })(r);
  }
}

// ---------------------------------------------------------------------------
// Handle bonus_game response from server
// Data comes via "bonus_slot" JSON string + "total_won" at top level.
// bonus_slot: {"multiplier":0.6,"bonus_remaining_spins":8,"icons":[1,2,3,4],"bonus":0.0,"total_bonus_prize":0.0}
// ---------------------------------------------------------------------------
function wildWestHandleBonusResponse(resp) {
  playLog('<<< [WW BONUS GAME] response: ' + JSON.stringify(resp));

  if (!_wwBonus.active) return;

  // Parse bonus_slot JSON string
  var bonusData = {};
  try {
    bonusData = (typeof resp.bonus_slot === 'string') ? JSON.parse(resp.bonus_slot) : (resp.bonus_slot || {});
  } catch (e) {
    playLog('[WildWestBingo] ERROR parsing bonus_slot in bonus_game response: ' + e);
    bonusData = {};
  }

  var icons = bonusData.icons || [];
  var bonusPrize = bonusData.bonus || 0;
  var totalBonusPrize = bonusData.total_bonus_prize || 0;
  var totalWon = resp.total_won || 0;
  var remainingSpins = bonusData.bonus_remaining_spins;
  var multiplier = bonusData.multiplier || _wwBonusMultiplier;

  // Update multiplier if changed
  _wwBonusMultiplier = multiplier;

  _wwBonus.totalWon = totalWon;
  _wwBonus.totalBonusPrize = totalBonusPrize;

  // Stop reels with result icons
  wildWestStopReels(icons);

  // After reels stop, update display
  var stopDelay = 400 + 4 * 300 + 200;
  setTimeout(function() {
    // Update spins from server remaining_spins
    if (remainingSpins !== undefined) {
      _wwBonus.spinsLeft = remainingSpins;
    } else {
      _wwBonus.spinsLeft--;
    }

    var spinsEl = document.getElementById('wwBonusSpinsLeft');
    if (spinsEl) spinsEl.textContent = _wwBonus.spinsLeft;

    // Update Won display
    var wonEl = document.getElementById('wwBonusWonDisplay');
    if (wonEl) wonEl.textContent = totalBonusPrize.toLocaleString();

    // Update multiplier display if changed
    var multiEl = document.getElementById('wwBonusMultiplierDisplay');
    if (multiEl) multiEl.textContent = 'x' + _wwBonusMultiplier;

    if (_wwBonus.spinsLeft <= 0) {
      // Game over
      _wwBonus.spinning = false;
      var status = document.getElementById('wwBonusStatus');
      if (status) status.textContent = '🤠 Bonus Over! Won: ' + totalBonusPrize.toFixed(2);
      var btn = document.getElementById('wwBonusPlayBtn');
      if (btn) {
        btn.textContent = 'CLOSE';
        btn.style.opacity = '1';
        btn.style.pointerEvents = '';
        btn.onclick = function() { wildWestCloseBonusGame(); };
      }
      // Update main game balance
      playSetBalanceImmediate(resp.balance || playGetCurrentBalance());
      document.getElementById('playWinDisplay').textContent = 'WIN: ' + totalWon.toFixed(2);
    } else {
      // Can continue spinning
      _wwBonus.spinning = false;
      var btn = document.getElementById('wwBonusPlayBtn');
      if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = ''; }
      var status = document.getElementById('wwBonusStatus');
      if (status) {
        if (bonusPrize > 0) {
          status.textContent = '🎉 Won ' + bonusPrize.toFixed(2) + '! ' + _wwBonus.spinsLeft + ' spins left.';
        } else {
          status.textContent = '🤠 ' + _wwBonus.spinsLeft + ' spins left. Press PLAY!';
        }
      }
    }
  }, stopDelay);
}

// ---------------------------------------------------------------------------
// Close the Bonus Game Modal
// ---------------------------------------------------------------------------
function wildWestCloseBonusGame() {
  _wwBonus.active = false;
  _wwBonusHasBonus = false;
  for (var i = 0; i < _wwReelTimers.length; i++) {
    if (_wwReelTimers[i]) { clearInterval(_wwReelTimers[i]); _wwReelTimers[i] = null; }
  }
  var modal = document.getElementById('wwBonusModal');
  if (modal) modal.remove();
  playLog('🤠 [WW BONUS GAME] closed');

  // Now send round over
  _playBonusPending = false;
  if (_playSpinState === 'waiting_roundover') {
    playRoundOver();
  }
}

// ---------------------------------------------------------------------------
// Golden Badge (from GoldenBadgeFeature)
// ---------------------------------------------------------------------------
var _wwGoldenBadges = 0;

function wildWestUpdateGoldenBadge(badgeData) {
  if (!badgeData) return;

  var count = badgeData.count || badgeData;
  _wwGoldenBadges = count;
  playLog('⭐ [WW GOLDEN BADGE] count: ' + _wwGoldenBadges);

  // Update badge display if exists
  var badgeEl = document.getElementById('wwGoldenBadgeCount');
  if (badgeEl) {
    badgeEl.textContent = _wwGoldenBadges;
  }
}
