// ---------------------------------------------------------------------------
// SuperRich Machine Plugin (Bingo)
// 5x3 cards, max 20 cards, overlap_win pattern matching.
// Features: MoreRepeatNumberFeature, BuffDoubleFreeEBFeature,
//           BuffCalaWildEBFeature, ManageBuffFeature, SuperRichBonusFeature
// Lucky Ball (magic_available_balls): after buying EB, player picks a replacement ball.
// ---------------------------------------------------------------------------
MachineRegistry.register('SuperRich', {
  type: 'bingo',

  afterRender: function(resp, config) {
    // Initialize SuperRichBonus completion display
    superRichBonusInit(resp);
  },

  onSpinResponse: function(resp) {
    // Check if this is an EB response with magic_available_balls
    if (resp.extra !== undefined && resp.magic_available_balls && resp.magic_available_balls.length > 0) {
      // Handle EB first (normal flow), then show lucky ball picker
      _superRichMagicBalls = resp.magic_available_balls;
      _superRichLastEb = resp.extra;
      playHandleBuyEbResponse(resp);
      // Disable EB button while lucky ball modal is active
      playDisableEbButton();
      // Show lucky ball modal after a short delay for the EB ball to appear
      setTimeout(function() {
        superRichShowLuckyBallModal(_superRichMagicBalls);
      }, 600);
    } else {
      // Normal spin/EB handling
      playHandleSpinResponse(resp);
    }
  },

  onRoundOver: function(resp) {
    // Default round over handling
    playHandleRoundOverResponse(resp);
    // Update bonus completion from round over response
    if (resp.super_rich_bonus_target_pattern_ids && resp.super_rich_bonus_completion) {
      superRichBonusUpdateCompletion(resp.super_rich_bonus_target_pattern_ids, resp.super_rich_bonus_completion);
    }
    // Check if golden coins bonus triggered
    if (resp.super_rich_bonus_triggered === true) {
      setTimeout(function() {
        superRichGoldenCoinsShow(resp);
      }, 500);
    }
  }
});

// ---------------------------------------------------------------------------
// SuperRich Lucky Ball State
// ---------------------------------------------------------------------------
var _superRichMagicBalls = [];
var _superRichLastEb = 0;

// ---------------------------------------------------------------------------
// Show Lucky Ball Selection Modal
// ---------------------------------------------------------------------------
function superRichShowLuckyBallModal(balls) {
  // Remove existing modal
  var old = document.getElementById('srLuckyModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'srLuckyModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var container = document.createElement('div');
  container.style.cssText = 'background:linear-gradient(135deg,#1a1a3e,#2a2a5e);border-radius:16px;padding:24px 32px;box-shadow:0 8px 32px rgba(0,0,0,0.7);border:2px solid #f5d742;text-align:center;max-width:90vw;';

  // Title
  var title = '<div style="color:#f5d742;font-size:18px;font-weight:700;margin-bottom:6px;">🍀 Lucky Ball</div>';
  title += '<div style="color:#ccc;font-size:12px;margin-bottom:20px;">Choose a ball to replace the last EB (ball ' + _superRichLastEb + ')</div>';

  // Ball options
  var ballsHtml = '<div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">';
  balls.forEach(function(b) {
    var ballNum = b.ball;
    var value = b.value;
    ballsHtml += '<div class="sr-lucky-ball-option" onclick="superRichSelectBall(' + ballNum + ')" style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px;border-radius:10px;border:2px solid transparent;transition:all 0.15s;">';
    ballsHtml += '<div style="width:52px;height:52px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ff9,#f5d742,#c8960c);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#3a2200;box-shadow:0 4px 8px rgba(0,0,0,0.4),inset 0 2px 4px rgba(255,255,255,0.4);">' + ballNum + '</div>';
    ballsHtml += '<div style="color:#4fc3f7;font-size:12px;font-weight:600;">+' + value + '</div>';
    ballsHtml += '</div>';
  });
  ballsHtml += '</div>';

  container.innerHTML = title + ballsHtml;
  modal.appendChild(container);
  document.body.appendChild(modal);

  playLog('🍀 [LUCKY BALL] showing picker: ' + JSON.stringify(balls));
}

// ---------------------------------------------------------------------------
// Player selects a lucky ball
// ---------------------------------------------------------------------------
function superRichSelectBall(ballNum) {
  // Close modal
  var modal = document.getElementById('srLuckyModal');
  if (modal) modal.remove();

  playLog('🍀 [LUCKY BALL] selected: ' + ballNum);

  // Send magic_ball command
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) { showAlert('Not connected'); return; }
  var resp = _playCurrentMachine.response;
  var cmd = {
    cmd: 'magic_ball',
    select_ball_num: ballNum,
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    bonus_unique_id: '',
    is_bonus: false,
    payload_data: "[{'key':'value'}]"
  };
  playLog('>>> [MAGIC BALL] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

// ---------------------------------------------------------------------------
// Handle magic_ball response from server
// Response format:
// {"eb_price":0.17,"balance":1196203.24,"has_extra_ball":true,
//  "balls":[...],"total_won":4.06,"selected_ball_num":4,"cmd":"magic_ball","game_id":198}
// ---------------------------------------------------------------------------
function superRichHandleMagicBallResponse(resp) {
  playLog('<<< [MAGIC BALL] handling response');

  var newBall = resp.selected_ball_num || 0;
  var totalWon = resp.total_won;
  var balance = resp.balance;
  var ebPrice = resp.eb_price;
  var hasEb = resp.has_extra_ball;

  // 1. Replace the last EB ball in ball area with the selected magic ball
  if (newBall && _superRichLastEb) {
    var ballArea = document.getElementById('playBallArea');
    if (ballArea) {
      var ballDivs = ballArea.querySelectorAll('div');
      var replaced = false;
      // Find the last EB ball (search from end, match by number)
      for (var i = ballDivs.length - 1; i >= 0; i--) {
        if (parseInt(ballDivs[i].textContent) === _superRichLastEb) {
          // Replace with magic ball (golden style)
          ballDivs[i].style.background = 'radial-gradient(circle at 35% 30%,#ff9,#f5d742,#c8960c)';
          ballDivs[i].style.color = '#3a2200';
          ballDivs[i].style.border = '2px solid #f5d742';
          ballDivs[i].textContent = newBall;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        ballArea.innerHTML += '<div style="width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ff9,#f5d742,#c8960c);border:2px solid #f5d742;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#3a2200;">' + newBall + '</div>';
      }
    }

    // 2. Unmark old EB ball on cards, mark the new selected ball
    superRichReplaceBallOnCards(_superRichLastEb, newBall);
  }

  // 3. Re-check patterns with all current balls
  playRecheckPatternsAfterEb();

  // 4. Update total_won display
  if (totalWon !== undefined) {
    document.getElementById('playWinDisplay').textContent = 'WIN: ' + totalWon.toFixed(2);
  }

  // 5. Update balance (animate if increased)
  if (balance !== undefined) {
    var prevBal = playGetCurrentBalance();
    if (balance > prevBal) {
      var allBalls = [];
      var ballAreaEl = document.getElementById('playBallArea');
      if (ballAreaEl) {
        ballAreaEl.querySelectorAll('div').forEach(function(d) { var n = parseInt(d.textContent); if (!isNaN(n)) allBalls.push(n); });
      }
      if (_playSpinResponse && _playSpinResponse.balls) {
        _playSpinResponse.balls.forEach(function(b) { if (allBalls.indexOf(b) < 0) allBalls.push(b); });
      }
      var winCards = playDetectWinningCards(allBalls);
      playSpawnCoinEffect(winCards, function() {
        playAnimateBalance(balance, 1200);
      });
    } else {
      playSetBalanceImmediate(balance);
    }
  }

  // 6. Update EB buttons (continue EB flow if has_extra_ball)
  if (hasEb === true && ebPrice !== undefined) {
    var ebBtn = document.getElementById('playEbPriceBtn');
    if (ebBtn) {
      ebBtn.textContent = 'EB ' + (ebPrice > 0 ? ebPrice.toFixed(2) : 'FREE');
    } else {
      playShowEbButtons(ebPrice);
    }
    // Re-enable EB button after magic ball is resolved
    playEnableEbButton();
  } else if (hasEb === false) {
    playRemoveEbButtons();
    _playSpinState = 'waiting_roundover';
    playRoundOver();
  }

  // Clear state
  _superRichLastEb = 0;
}

// ---------------------------------------------------------------------------
// Replace a ball on cards (unmark old, mark new)
// ---------------------------------------------------------------------------
function superRichReplaceBallOnCards(oldBall, newBall) {
  // Unmark old ball cells (revert to unhit state)
  var cells = document.querySelectorAll('.play-card-cell');
  cells.forEach(function(cell) {
    if (parseInt(cell.getAttribute('data-num')) === oldBall) {
      cell.style.background = '#f0f0f0';
      cell.style.color = '#333';
      cell.style.textDecoration = '';
      cell.innerHTML = oldBall < 10 ? '0' + oldBall : '' + oldBall;
    }
  });
  // Mark new ball cells as hit
  playMarkBallOnCards(newBall);
}

// ===========================================================================
// SuperRich Bonus Feature — Pattern Completion Tracking
// ===========================================================================
var _srBonus = {
  settings: [],       // [{pattern_id, count}] from login (target counts)
  targetIds: [],      // current target pattern_ids
  completion: [],     // current completion counts (same order as targetIds)
  timer: null         // pulsing animation timer
};

/**
 * Initialize bonus display from login response data.
 */
function superRichBonusInit(resp) {
  // Parse settings
  _srBonus.settings = resp.super_rich_bonus_pattern_completion_count || [];
  _srBonus.targetIds = resp.super_rich_bonus_target_pattern_ids || [];
  _srBonus.completion = resp.super_rich_bonus_completion || [];

  if (_srBonus.targetIds.length === 0) return;

  // Wait a tick for DOM to be ready
  setTimeout(function() {
    superRichBonusRenderOverlays();
    superRichBonusStartPulse();
  }, 200);
}

/**
 * Find the pattern group index for a given pattern_id.
 * Pattern groups in play.js are built by grouping patterns by their `id` field.
 */
function superRichBonusFindGroupIdx(patternId) {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return -1;
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var patterns = mathModel.pattern || [];
  // Build group order (same logic as playRenderGame)
  var pGroups = [], pSeen = {};
  patterns.forEach(function(p) {
    var pid = String(p.id);
    if (!pSeen[pid]) { pSeen[pid] = true; pGroups.push(p.id); }
  });
  for (var i = 0; i < pGroups.length; i++) {
    if (pGroups[i] === patternId) return i;
  }
  return -1;
}

/**
 * Get the target count for a pattern_id from settings.
 */
function superRichBonusGetTarget(patternId) {
  for (var i = 0; i < _srBonus.settings.length; i++) {
    if (_srBonus.settings[i].pattern_id === patternId) return _srBonus.settings[i].count;
  }
  return 0;
}

/**
 * Render completion overlay badges on the target pattern grids.
 */
function superRichBonusRenderOverlays() {
  // Remove old overlays
  document.querySelectorAll('.sr-bonus-overlay').forEach(function(el) { el.remove(); });

  for (var i = 0; i < _srBonus.targetIds.length; i++) {
    var patId = _srBonus.targetIds[i];
    var done = _srBonus.completion[i] || 0;
    var target = superRichBonusGetTarget(patId);
    var groupIdx = superRichBonusFindGroupIdx(patId);
    if (groupIdx < 0) continue;

    // Find the pattern grid element
    var gridEl = document.querySelector('.play-pat-grid[data-group="' + groupIdx + '"]');
    if (!gridEl) continue;

    // Make parent positioned for overlay
    var parent = gridEl.parentElement;
    if (parent) parent.style.position = 'relative';

    // Create overlay badge
    var badge = document.createElement('div');
    badge.className = 'sr-bonus-overlay';
    badge.setAttribute('data-pat-id', patId);
    badge.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:5;opacity:0;transition:opacity 0.3s;';
    badge.innerHTML = '<div style="background:rgba(0,0,0,0.75);border-radius:4px;padding:2px 5px;border:1px solid #f5d742;">' +
      '<span style="color:#f5d742;font-size:10px;font-weight:700;">' + done + '/' + target + '</span></div>';

    parent.appendChild(badge);
  }
}

/**
 * Start the pulsing animation — show overlay every 1.5s cycle.
 */
function superRichBonusStartPulse() {
  if (_srBonus.timer) clearInterval(_srBonus.timer);
  var visible = false;
  _srBonus.timer = setInterval(function() {
    visible = !visible;
    document.querySelectorAll('.sr-bonus-overlay').forEach(function(el) {
      el.style.opacity = visible ? '1' : '0';
    });
  }, 1500);
}

/**
 * Update completion counts (called from round over response).
 */
function superRichBonusUpdateCompletion(targetIds, completion) {
  _srBonus.targetIds = targetIds;
  _srBonus.completion = completion;
  // Re-render overlays with new values
  superRichBonusRenderOverlays();
}

// ===========================================================================
// SuperRich Golden Coins Bonus — Pick coins to reveal prizes
// ===========================================================================
var _srCoins = {
  selectedCoins: [],       // server-determined prizes for each pick
  availableCoins: [],      // total coins to display
  prize: 0,                // total bonus prize
  pickCount: 0,            // how many coins the player needs to pick
  picked: 0,              // how many have been picked so far
  countdown: 10,           // countdown seconds
  timer: null              // countdown timer
};

/**
 * Show the golden coins pick modal.
 */
function superRichGoldenCoinsShow(resp) {
  _srCoins.selectedCoins = resp.super_rich_bonus_selected_coins || [];
  _srCoins.availableCoins = resp.super_rich_bonus_available_coins || [];
  _srCoins.prize = resp.super_rich_bonus_prize || 0;
  _srCoins.pickCount = _srCoins.selectedCoins.length;
  _srCoins.picked = 0;

  // Get countdown from login response
  var loginResp = _playCurrentMachine && _playCurrentMachine.response;
  _srCoins.countdown = (loginResp && loginResp.super_rich_bonus_countdown_seconds) || 10;

  // Remove existing modal
  var old = document.getElementById('srCoinsModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'srCoinsModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var container = document.createElement('div');
  container.style.cssText = 'width:520px;max-width:95vw;background:linear-gradient(to bottom,#1a6aaa,#0d4a7a,#0a3a6a);border-radius:16px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.7);border:3px solid #4fc3f7;text-align:center;position:relative;';

  // Title
  var html = '<div style="color:#fff;font-size:20px;font-weight:900;text-shadow:0 2px 4px rgba(0,0,0,0.6);margin-bottom:8px;">PRESS COINS TO WIN PRIZES!</div>';

  // Subtitle with countdown
  html += '<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:20px;">';
  html += '<div style="background:#0a3a6a;border:2px solid #4fc3f7;border-radius:8px;padding:6px 14px;color:#4fc3f7;font-size:13px;font-weight:600;">Choose ' + _srCoins.pickCount + ' coins before time runs out</div>';
  html += '<div style="background:#0a3a6a;border:2px solid #4fc3f7;border-radius:8px;padding:6px 10px;display:flex;align-items:center;gap:4px;color:#4fc3f7;font-size:13px;font-weight:700;"><span>⏱</span><span id="srCoinsCountdown">' + _srCoins.countdown + '</span></div>';
  html += '</div>';

  // Coins grid (4 per row)
  var totalCoins = _srCoins.availableCoins.length;
  html += '<div id="srCoinsGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0 10px;">';
  for (var i = 0; i < totalCoins; i++) {
    html += '<div class="sr-coin-item" data-idx="' + i + '" onclick="superRichGoldenCoinPick(' + i + ')" style="width:90px;height:90px;margin:0 auto;border-radius:50%;cursor:pointer;background:radial-gradient(circle at 38% 32%,#ffe680,#f5d742,#c8960c,#8b6508);box-shadow:0 4px 12px rgba(0,0,0,0.4),inset 0 2px 6px rgba(255,255,255,0.4),inset 0 -3px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#8b6508;text-shadow:0 1px 2px rgba(255,255,255,0.5);transition:transform 0.15s,box-shadow 0.15s;user-select:none;">$</div>';
  }
  html += '</div>';

  container.innerHTML = html;
  modal.appendChild(container);
  document.body.appendChild(modal);

  // Start countdown
  superRichGoldenCoinsStartTimer();
  playLog('🪙 [GOLDEN COINS] showing picker: ' + totalCoins + ' coins, pick ' + _srCoins.pickCount);
}

/**
 * Start the countdown timer.
 */
function superRichGoldenCoinsStartTimer() {
  if (_srCoins.timer) clearInterval(_srCoins.timer);
  var remaining = _srCoins.countdown;
  _srCoins.timer = setInterval(function() {
    remaining--;
    var el = document.getElementById('srCoinsCountdown');
    if (el) el.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(_srCoins.timer);
      _srCoins.timer = null;
      // Auto-pick remaining coins randomly
      superRichGoldenCoinsAutoComplete();
    }
  }, 1000);
}

/**
 * Player clicks a coin.
 */
function superRichGoldenCoinPick(idx) {
  if (_srCoins.picked >= _srCoins.pickCount) return;

  var coinEl = document.querySelectorAll('#srCoinsGrid .sr-coin-item[data-idx="' + idx + '"]')[0];
  if (!coinEl || coinEl.getAttribute('data-picked') === '1') return;

  // Mark as picked
  coinEl.setAttribute('data-picked', '1');
  coinEl.style.cursor = 'default';
  coinEl.style.transform = 'scale(0.9)';
  coinEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3),inset 0 2px 8px rgba(0,0,0,0.4)';
  coinEl.style.background = 'radial-gradient(circle at 38% 32%,#c8960c,#8b6508,#5a3a00)';

  // Show the prize value from selectedCoins
  var prizeVal = _srCoins.selectedCoins[_srCoins.picked] || 0;
  coinEl.innerHTML = '<div style="text-align:center;"><div style="font-size:10px;color:#f5d742;font-weight:700;">WIN</div><div style="font-size:16px;color:#fff;font-weight:800;text-shadow:0 1px 3px #000;">' + prizeVal.toFixed(2) + '</div></div>';

  _srCoins.picked++;

  // Check if all picks done
  if (_srCoins.picked >= _srCoins.pickCount) {
    if (_srCoins.timer) { clearInterval(_srCoins.timer); _srCoins.timer = null; }
    // Show total and close after delay
    setTimeout(function() {
      superRichGoldenCoinsFinish();
    }, 1200);
  }
}

/**
 * Auto-complete remaining picks when timer runs out.
 */
function superRichGoldenCoinsAutoComplete() {
  var unpicked = [];
  document.querySelectorAll('#srCoinsGrid .sr-coin-item').forEach(function(el) {
    if (el.getAttribute('data-picked') !== '1') {
      unpicked.push(parseInt(el.getAttribute('data-idx')));
    }
  });

  // Shuffle and pick remaining needed
  for (var i = unpicked.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = unpicked[i]; unpicked[i] = unpicked[j]; unpicked[j] = t;
  }

  var remaining = _srCoins.pickCount - _srCoins.picked;
  var pickIdx = 0;

  function autoPickNext() {
    if (pickIdx >= remaining) {
      setTimeout(function() { superRichGoldenCoinsFinish(); }, 1000);
      return;
    }
    superRichGoldenCoinPick(unpicked[pickIdx]);
    pickIdx++;
    setTimeout(autoPickNext, 400);
  }
  autoPickNext();
}

/**
 * Finish the golden coins bonus — show total prize and close.
 */
function superRichGoldenCoinsFinish() {
  var modal = document.getElementById('srCoinsModal');
  if (!modal) return;

  // Show total prize overlay
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:10;';
  overlay.innerHTML = '<div style="color:#f5d742;font-size:16px;font-weight:700;margin-bottom:8px;">🎉 TOTAL BONUS PRIZE</div>' +
    '<div style="color:#fff;font-size:36px;font-weight:900;text-shadow:0 2px 8px rgba(245,215,66,0.6);">+ ' + _srCoins.prize.toFixed(2) + '</div>';
  modal.querySelector('div').appendChild(overlay);

  // Close modal after 2s
  setTimeout(function() {
    var m = document.getElementById('srCoinsModal');
    if (m) m.remove();
    // Update balance with the prize
    var newBal = playGetCurrentBalance() + _srCoins.prize;
    playAnimateBalance(newBal, 1000);
    // Re-enable EB button after bonus is resolved
    playEnableEbButton();
  }, 2000);
}
