// ---------------------------------------------------------------------------
// WildWestBingo Machine Plugin (Bingo)
// 5x3 cards, max 16 cards, overlap_win pattern matching.
// Features: SlotBonusFeature (deferred bonus game with bonus_start),
//           BuffDoubleFreeEBFeature (free extra balls),
//           BuffCalaWildEBFeature (wild extra balls),
//           GoldenBadgeFeature (golden badge multiplier wheel),
//           MoreRepeatNumberFeature (repeated numbers across cards)
// ---------------------------------------------------------------------------
MachineRegistry.register('WildWestBingo', {
  type: 'bingo',

  onSpinResponse: function(resp) {
    // Always update slot bonus state from latest server response (spin or EB)
    wildWestUpdateBonusState(resp);

    // Check if this is an EB response
    if (resp.extra !== undefined) {
      playHandleBuyEbResponse(resp);

      // Check for free EB (lightning-style) from BuffDoubleFreeEBFeature
      if (resp.free_ebs && resp.free_ebs.length > 0) {
        setTimeout(function() {
          wildWestFreeEb(resp.free_ebs);
        }, 400);
      }

      // Check for wild EB from BuffCalaWildEBFeature
      if (resp.wild_eb) {
        setTimeout(function() {
          wildWestWildEb(resp.wild_eb);
        }, 400);
      }

      // Check for golden badge collection during EB
      if (resp.golden_badge) {
        wildWestUpdateGoldenBadge(resp.golden_badge);
      }
    } else {
      // Normal spin response
      playHandleSpinResponse(resp);

      // Check for free EB on initial spin
      if (resp.free_ebs && resp.free_ebs.length > 0) {
        setTimeout(function() {
          wildWestFreeEb(resp.free_ebs);
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
var _wwBonusHasBonus = false;   // latest has_bonus from server
var _wwBonusMultiplier = 0;     // latest multiplier from server
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
// ---------------------------------------------------------------------------
function wildWestUpdateBonusState(resp) {
  _wwBonusHasBonus = resp.has_bonus === true;
  _wwBonusMultiplier = resp.multiplier || 0;

  if (_wwBonusHasBonus) {
    _playBonusPending = true;
  } else {
    _playBonusPending = false;
  }

  playLog('[WildWestBingo] bonus state updated: has_bonus=' + _wwBonusHasBonus + ', multiplier=' + _wwBonusMultiplier);
}

// ---------------------------------------------------------------------------
// Trigger bonus game (called when round is about to end and has_bonus is true)
// Sends bonus_start first, then opens the modal after server confirms.
// ---------------------------------------------------------------------------
function wildWestTriggeredBonusBeforeRoundOver() {
  if (_wwBonusHasBonus) {
    wildWestSendBonusStart();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Send bonus_start command to server
// ---------------------------------------------------------------------------
function wildWestSendBonusStart() {
  var resp = _playCurrentMachine.response;
  var cmd = {
    cmd: 'bonus_start',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || ''
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
  var baseSpins = config.base_bonus_spins || 8;

  _wwBonus.active = true;
  _wwBonus.totalWon = 0;
  _wwBonus.totalBonusPrize = 0;
  _wwBonus.spinning = false;
  _wwBonus.spinsLeft = baseSpins;
  _wwBonus.totalSpins = baseSpins;

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
    midHtml += '<img src="/static/machine/WildWestBingo/BonusGame/icon/i1.PNG" style="width:100%;height:100%;object-fit:cover;">';
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

  playLog('🤠 [WW BONUS GAME] opened (multiplier: x' + _wwBonusMultiplier + ', spins: ' + baseSpins + ')');
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
          icons += '<img src="/static/machine/WildWestBingo/BonusGame/icon/i' + iconId + '.PNG" style="width:100%;height:130px;object-fit:cover;display:block;flex-shrink:0;">';
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
          reelEl.innerHTML = '<img src="/static/machine/WildWestBingo/BonusGame/icon/i' + iconId + '.PNG" style="width:100%;height:100%;object-fit:cover;animation:wwReelBounce 0.3s ease;">';
        }
      }, 400 + reelIdx * 300);
    })(r);
  }
}

// ---------------------------------------------------------------------------
// Handle bonus_game response from server
// ---------------------------------------------------------------------------
function wildWestHandleBonusResponse(resp) {
  playLog('<<< [WW BONUS GAME] response: ' + JSON.stringify(resp));

  if (!_wwBonus.active) return;

  var icons = resp.icons || [];
  var bonusPrize = resp.bonus_prize || 0;
  var totalBonusPrize = resp.total_bonus_prize || 0;
  var totalWon = resp.total_won || 0;
  var isOver = resp.is_bonus_over === true;
  var extraSpins = resp.extra_spins || 0;

  _wwBonus.totalWon = totalWon;
  _wwBonus.totalBonusPrize = totalBonusPrize;

  // Stop reels with result icons
  wildWestStopReels(icons);

  // After reels stop, update display
  var stopDelay = 400 + 4 * 300 + 200;
  setTimeout(function() {
    // Update spins
    _wwBonus.spinsLeft--;
    if (extraSpins > 0) {
      _wwBonus.spinsLeft += extraSpins;
      _wwBonus.totalSpins += extraSpins;
    }

    var spinsEl = document.getElementById('wwBonusSpinsLeft');
    if (spinsEl) spinsEl.textContent = _wwBonus.spinsLeft;

    // Update Won display
    var wonEl = document.getElementById('wwBonusWonDisplay');
    if (wonEl) wonEl.textContent = totalBonusPrize.toLocaleString();

    if (isOver || _wwBonus.spinsLeft <= 0) {
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
// Free EB (from BuffDoubleFreeEBFeature) — mark free balls on cards
// ---------------------------------------------------------------------------
function wildWestFreeEb(freeBalls) {
  if (!freeBalls || freeBalls.length === 0) return;

  playLog('🎯 [WW FREE EB] balls: ' + JSON.stringify(freeBalls));

  var ballArea = document.getElementById('playBallArea');

  freeBalls.forEach(function(ballNum, idx) {
    setTimeout(function() {
      if (ballArea) {
        ballArea.innerHTML += '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#ffd700,#ff8c00);border:2px solid #b8860b;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#333;box-shadow:0 0 8px rgba(255,215,0,0.8);">' + ballNum + '</div>';
      }
      playMarkBallOnCards(ballNum);

      if (idx === freeBalls.length - 1) {
        setTimeout(function() {
          playRecheckPatternsAfterEb();
        }, 300);
      }
    }, idx * 500);
  });
}

// ---------------------------------------------------------------------------
// Wild EB (from BuffCalaWildEBFeature) — wild ball marks a selected number
// ---------------------------------------------------------------------------
function wildWestWildEb(wildData) {
  if (!wildData) return;

  var ballNum = wildData.ball || wildData;
  playLog('🃏 [WW WILD EB] wild ball: ' + ballNum);

  var ballArea = document.getElementById('playBallArea');
  if (ballArea) {
    ballArea.innerHTML += '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#9b59b6,#8e44ad);border:2px solid #6c3483;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;box-shadow:0 0 8px rgba(155,89,182,0.8);">W</div>';
  }
  playMarkBallOnCards(ballNum);

  setTimeout(function() {
    playRecheckPatternsAfterEb();
  }, 300);
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
