// ---------------------------------------------------------------------------
// CalacaBingo Machine Plugin (Bingo)
// Features: FreeEBFeature, CalacaWildEBFeature, LightningEBFeature
// Same handling as CarnavalBingo — reuses its functions.
// ---------------------------------------------------------------------------
MachineRegistry.register('CalacaBingo', {
  type: 'bingo',

  onSpinResponse: function(resp) {
    // Lucky ball (magic_available_balls)
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
      // Lightning EB
      if (resp.lightning_ebs && resp.lightning_ebs.length > 0) {
        setTimeout(function() {
          carnavalLightningEb(resp.lightning_ebs);
        }, 400);
      }
      // Wheel bonus
      if (resp.carnaval_bonus && resp.carnaval_bonus.length > 0) {
        playDisableEbButton();
        setTimeout(function() {
          carnavalWheelShow(resp.carnaval_bonus, resp.carnaval_prize || 0);
        }, 600);
      }
    } else {
      // Normal spin response
      playHandleSpinResponse(resp);
      // Lightning on spin
      if (resp.lightning_ebs && resp.lightning_ebs.length > 0) {
        setTimeout(function() {
          carnavalLightningEb(resp.lightning_ebs);
        }, 400);
      }
      // Wheel on spin
      if (resp.carnaval_bonus && resp.carnaval_bonus.length > 0) {
        setTimeout(function() {
          carnavalWheelShow(resp.carnaval_bonus, resp.carnaval_prize || 0);
        }, 600);
      }
      // Skeleton bonus on spin
      if (resp.skeleton_bonus && resp.skeleton_bonus.length > 0) {
        _playBonusPending = true;
        setTimeout(function() {
          calacaShowSkeletonBonus(resp.skeleton_bonus, resp.skeleton_prize || 0);
        }, 800);
      }
    }
  }
});


// ===========================================================================
// CalacaBingo Skeleton Bonus
// ===========================================================================
var _calacaSkeleton = {
  bonuses: [],     // [0.06, 0.03, 0.15, ..., 0]
  prize: 0,        // total prize
  picked: 0        // how many picked so far
};

function calacaShowSkeletonBonus(bonuses, prize) {
  _calacaSkeleton.bonuses = bonuses;
  _calacaSkeleton.prize = prize;
  _calacaSkeleton.picked = 0;

  var old = document.getElementById('calacaSkeletonModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'calacaSkeletonModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var html = '<div style="background:linear-gradient(135deg,#1a1a2e,#2d2d4e);border-radius:16px;padding:24px;border:2px solid #9b59b6;text-align:center;max-width:90vw;min-width:380px;">';
  html += '<div style="color:#9b59b6;font-size:20px;font-weight:800;margin-bottom:6px;">💀 Skeleton Bonus! 💀</div>';
  html += '<div style="color:#aaa;font-size:11px;margin-bottom:16px;">Pick skulls to reveal prizes!</div>';

  // 4x4 skull grid
  html += '<div id="calacaSkullGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-width:300px;margin:0 auto;">';
  for (var i = 0; i < 16; i++) {
    html += '<div class="calaca-skull" data-idx="' + i + '" onclick="calacaPickSkull(' + i + ')" style="width:60px;height:60px;background:linear-gradient(135deg,#444,#222);border-radius:10px;border:2px solid #9b59b6;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:28px;transition:all 0.15s;box-shadow:0 3px 8px rgba(0,0,0,0.4);">💀</div>';
  }
  html += '</div>';

  html += '<div id="calacaSkeletonStatus" style="margin-top:14px;color:#aaa;font-size:11px;">Pick a skull!</div>';
  html += '<div id="calacaSkeletonRunning" style="margin-top:4px;color:#2ecc71;font-size:13px;font-weight:700;">Won: 0</div>';
  html += '</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  playLog('💀 [SKELETON] started, picks: ' + bonuses.length);
}

function calacaPickSkull(idx) {
  var el = document.querySelector('.calaca-skull[data-idx="' + idx + '"]');
  if (!el || el.getAttribute('data-opened') === '1') return;

  el.setAttribute('data-opened', '1');
  el.style.pointerEvents = 'none';

  // Send bonus_spin request
  calacaSendBonusSpin(idx);

  var pickIdx = _calacaSkeleton.picked;
  var reward = _calacaSkeleton.bonuses[pickIdx];

  if (reward > 0) {
    // Prize revealed
    el.style.background = 'linear-gradient(135deg,#27ae60,#2ecc71)';
    el.style.borderColor = '#2ecc71';
    el.style.transform = 'scale(1.05)';
    el.style.boxShadow = '0 0 12px rgba(46,204,113,0.5)';
    el.innerHTML = '<span style="font-size:14px;font-weight:800;color:#fff;">' + reward.toFixed(2) + '</span>';

    _calacaSkeleton.picked++;
    // Update running total
    var runningTotal = 0;
    for (var i = 0; i < _calacaSkeleton.picked; i++) runningTotal += _calacaSkeleton.bonuses[i];
    var runEl = document.getElementById('calacaSkeletonRunning');
    if (runEl) runEl.textContent = 'Won: ' + runningTotal.toFixed(2);
    var status = document.getElementById('calacaSkeletonStatus');
    if (status) status.textContent = 'Got ' + reward.toFixed(2) + '! Pick another...';
  } else {
    // Game over (reward === 0)
    el.style.background = '#333';
    el.style.borderColor = '#666';
    el.innerHTML = '<span style="font-size:14px;color:#e74c3c;font-weight:800;">OVER</span>';

    _calacaSkeleton.picked++;
    // Disable all remaining skulls
    document.querySelectorAll('.calaca-skull').forEach(function(s) { s.style.pointerEvents = 'none'; });

    var status = document.getElementById('calacaSkeletonStatus');
    if (status) { status.style.color = '#e74c3c'; status.textContent = 'Game Over!'; }

    // Show total and close
    setTimeout(function() { calacaSkeletonComplete(); }, 1500);
  }
}

function calacaSkeletonComplete() {
  var modal = document.getElementById('calacaSkeletonModal');
  if (!modal) return;

  // Send bonus_over to server
  calacaSendBonusOver();

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:10;animation:jpScale 0.8s ease-out;';
  overlay.innerHTML =
    '<div style="color:#9b59b6;font-size:18px;font-weight:700;margin-bottom:8px;">💀 SKELETON BONUS! 💀</div>' +
    '<div style="color:#fff;font-size:36px;font-weight:900;text-shadow:0 0 16px #9b59b6,0 2px 8px rgba(0,0,0,0.8);">+ ' + _calacaSkeleton.prize.toFixed(2) + '</div>';
  modal.querySelector('div').style.position = 'relative';
  modal.querySelector('div').appendChild(overlay);

  setTimeout(function() {
    var m = document.getElementById('calacaSkeletonModal');
    if (m) m.remove();
    _playBonusPending = false;
    // Send round over for bingo
    if (_playSpinState === 'waiting_roundover') {
      playRoundOver();
    }
    playLog('💀 [SKELETON] complete, prize: ' + _calacaSkeleton.prize);
  }, 2500);
}

function calacaSendBonusSpin(position) {
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) return;
  var resp = _playCurrentMachine.response;
  var cmd = {
    cmd: 'bonus_spin',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    position: position,
    feature_id: 8
  };
  playLog('>>> [CALACA BONUS SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

function calacaSendBonusOver() {
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) return;
  var resp = _playCurrentMachine.response;
  var cmd = {
    cmd: 'bonus_over',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    position: 0,
    feature_id: 3
  };
  playLog('>>> [CALACA BONUS OVER] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}
