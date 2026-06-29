// ---------------------------------------------------------------------------
// SuperRich Machine Plugin (Bingo)
// 5x3 cards, max 20 cards, overlap_win pattern matching.
// Features: MoreRepeatNumberFeature, BuffDoubleFreeEBFeature,
//           BuffCalaWildEBFeature, ManageBuffFeature, SuperRichBonusFeature
// Lucky Ball (magic_available_balls): after buying EB, player picks a replacement ball.
// ---------------------------------------------------------------------------
MachineRegistry.register('SuperRich', {
  type: 'bingo',

  onSpinResponse: function(resp) {
    // Check if this is an EB response with magic_available_balls
    if (resp.extra !== undefined && resp.magic_available_balls && resp.magic_available_balls.length > 0) {
      // Handle EB first (normal flow), then show lucky ball picker
      _superRichMagicBalls = resp.magic_available_balls;
      _superRichLastEb = resp.extra;
      playHandleBuyEbResponse(resp);
      // Show lucky ball modal after a short delay for the EB ball to appear
      setTimeout(function() {
        superRichShowLuckyBallModal(_superRichMagicBalls);
      }, 600);
    } else {
      // Normal spin/EB handling
      playHandleSpinResponse(resp);
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
