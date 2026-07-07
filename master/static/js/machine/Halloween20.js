// ---------------------------------------------------------------------------
// Halloween20 Machine Plugin (Slot)
// 3x5 slot, 10 icons, 20 lines.
// Features: PumpkinJarFeature — 2-step bonus jar selection game.
// ---------------------------------------------------------------------------
MachineRegistry.register('Halloween20', {
  type: 'slot',

  onSpinResponse: function(resp) {
    // If pumpkin jar bonus triggered, defer round over
    if (resp.pumpkin_jar_bonus_caldeirao && resp.pumpkin_jar_bonus_caldeirao.length > 0) {
      _playBonusPending = true;
    }
    // If strawberry bonus triggered, defer round over
    if (resp.strawberry_bonus && resp.strawberry_bonus.length > 0) {
      _playBonusPending = true;
    }

    // Default slot handling
    slotHandleSpinResponse(resp);

    // Show pumpkin jar bonus after reels stop
    if (resp.pumpkin_jar_bonus_caldeirao && resp.pumpkin_jar_bonus_caldeirao.length > 0) {
      setTimeout(function() {
        halloweenShowPumpkinBonus(resp);
      }, 3800);
    }
    // Show strawberry bonus after reels stop
    if (resp.strawberry_bonus && resp.strawberry_bonus.length > 0) {
      setTimeout(function() {
        halloweenShowStrawberryBonus(resp);
      }, 3800);
    }
  }
});

// ===========================================================================
// Halloween Pumpkin Jar Bonus
// ===========================================================================
var _hwBonus = {
  caldeirao: [],       // step 1 jars
  abobora: [],         // step 2 jars
  caldeiraoResult: 0,  // actual result for step 1
  aboboraResult: 0,    // actual result for step 2
  multi: 0,            // display multiplier
  totalPrize: 0,       // total prize
  step: 1
};

function halloweenShowPumpkinBonus(resp) {
  _hwBonus.caldeirao = resp.pumpkin_jar_bonus_caldeirao || [];
  _hwBonus.abobora = resp.pumpkin_jar_bonus_abobora || [];
  _hwBonus.caldeiraoResult = resp.pumpkin_jar_caldeirao || 0;
  _hwBonus.aboboraResult = resp.pumpkin_jar_abobora || 0;
  _hwBonus.multi = resp.pumpkin_multi || 0;
  _hwBonus.totalPrize = resp.pumpkin_jar_prize || 0;
  _hwBonus.step = 1;

  halloweenShowJarModal();
}

function halloweenShowJarModal() {
  var old = document.getElementById('hwBonusModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'hwBonusModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var step = _hwBonus.step;
  var jars = step === 1 ? _hwBonus.caldeirao : _hwBonus.abobora;
  var title = step === 1 ? '🎃 Pick a Cauldron!' : '🎃 Pick a Pumpkin!';

  var html = '<div style="background:linear-gradient(135deg,#1a0a2e,#2d1654);border-radius:16px;padding:28px;border:2px solid #f39c12;text-align:center;max-width:90vw;min-width:400px;">';

  // Title + multiplier
  html += '<div style="color:#f39c12;font-size:20px;font-weight:800;margin-bottom:6px;">' + title + '</div>';
  html += '<div style="color:#e74c3c;font-size:16px;font-weight:700;margin-bottom:20px;">Multiplier: X' + _hwBonus.multi + '</div>';

  // Jars
  html += '<div id="hwJarsGrid" style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">';
  for (var i = 0; i < jars.length; i++) {
    html += '<div class="hw-jar" data-idx="' + i + '" onclick="halloweenPickJar(' + i + ')" style="width:80px;height:100px;background:linear-gradient(to bottom,#8e44ad,#6c3483);border-radius:12px;border:3px solid #f39c12;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.15s;box-shadow:0 4px 12px rgba(0,0,0,0.4);">';
    html += '<span style="font-size:36px;">' + (step === 1 ? '🎁' : '🎃') + '</span>';
    html += '<span style="font-size:9px;color:#ddd;margin-top:4px;">?</span>';
    html += '</div>';
  }
  html += '</div>';

  // Status
  html += '<div id="hwBonusStatus" style="margin-top:16px;color:#aaa;font-size:12px;">Choose one!</div>';
  html += '</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  playLog('🎃 [PUMPKIN JAR] step ' + step + ', jars: ' + jars.length);
}

function halloweenPickJar(idx) {
  var step = _hwBonus.step;
  var result = step === 1 ? _hwBonus.caldeiraoResult : _hwBonus.aboboraResult;

  // Send bonus_spin request
  halloweenSendBonusSpin(idx, 2);

  // Disable all jars
  document.querySelectorAll('.hw-jar').forEach(function(jar) {
    jar.style.pointerEvents = 'none';
    jar.style.opacity = '0.5';
  });

  // Reveal selected jar
  var selectedJar = document.querySelector('.hw-jar[data-idx="' + idx + '"]');
  if (selectedJar) {
    selectedJar.style.opacity = '1';
    selectedJar.style.background = 'linear-gradient(to bottom,#27ae60,#1a8a4a)';
    selectedJar.style.borderColor = '#2ecc71';
    selectedJar.style.transform = 'scale(1.1)';
    selectedJar.innerHTML = '<span style="font-size:24px;color:#fff;font-weight:800;">' + result + '</span><span style="font-size:10px;color:#aff;margin-top:4px;">BONUS</span>';
    selectedJar.style.boxShadow = '0 0 20px rgba(46,204,113,0.6),0 4px 12px rgba(0,0,0,0.4)';
  }

  // Update status with animation
  var status = document.getElementById('hwBonusStatus');
  if (status) {
    status.style.color = '#2ecc71';
    status.textContent = (step === 1 ? 'Cauldron' : 'Pumpkin') + ' reveals: ' + result + '!';
  }

  // After reveal animation, proceed to next step or finish
  setTimeout(function() {
    if (step === 1 && _hwBonus.caldeiraoResult === 0) {
      // caldeiraoResult is 0, proceed to step 2
      _hwBonus.step = 2;
      halloweenShowJarModal();
    } else {
      // Bonus complete
      halloweenBonusComplete();
    }
  }, 1800);
}

function halloweenBonusComplete() {
  var modal = document.getElementById('hwBonusModal');
  if (!modal) return;

  // Show total prize overlay
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:10;animation:jpScale 0.8s ease-out;';
  overlay.innerHTML =
    '<div style="color:#f39c12;font-size:18px;font-weight:700;margin-bottom:8px;">🎃 PUMPKIN BONUS! 🎃</div>' +
    '<div style="color:#fff;font-size:40px;font-weight:900;text-shadow:0 0 20px #f39c12,0 2px 8px rgba(0,0,0,0.8);margin-bottom:8px;">+ ' + _hwBonus.totalPrize.toFixed(2) + '</div>' +
    '<div style="color:#e74c3c;font-size:14px;font-weight:700;">X' + _hwBonus.multi + ' Multiplier</div>';
  modal.querySelector('div').style.position = 'relative';
  modal.querySelector('div').appendChild(overlay);

  // Close after delay, send round over
  setTimeout(function() {
    var m = document.getElementById('hwBonusModal');
    if (m) m.remove();
    _playBonusPending = false;
    slotRoundOver();
    playLog('🎃 [PUMPKIN JAR] complete, prize: ' + _hwBonus.totalPrize);
  }, 2500);
}

// ===========================================================================
// Halloween Strawberry Bonus
// ===========================================================================
var _hwStrawberry = {
  bonuses: [],      // [1, 4, 2] — prizes for each pick
  prize: 0,         // total prize
  multi: 0,         // multiplier
  picked: 0         // how many picked so far
};

function halloweenShowStrawberryBonus(resp) {
  _hwStrawberry.bonuses = resp.strawberry_bonus || [];
  _hwStrawberry.prize = resp.strawberry_prize || 0;
  _hwStrawberry.multi = resp.strawberry_multi || 0;
  _hwStrawberry.picked = 0;

  var old = document.getElementById('hwStrawberryModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'hwStrawberryModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var html = '<div style="background:linear-gradient(135deg,#1a2e1a,#2d5e2d);border-radius:16px;padding:28px;border:2px solid #e74c3c;text-align:center;max-width:90vw;min-width:420px;">';
  html += '<div style="color:#e74c3c;font-size:20px;font-weight:800;margin-bottom:6px;">🍓 Strawberry Bonus! 🍓</div>';
  html += '<div style="color:#f39c12;font-size:14px;font-weight:700;margin-bottom:16px;">Multiplier: X' + _hwStrawberry.multi + '</div>';

  // 3x4 strawberry grid
  html += '<div id="hwStrawberryGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-width:320px;margin:0 auto;">';
  for (var i = 0; i < 12; i++) {
    html += '<div class="hw-berry" data-idx="' + i + '" onclick="halloweenPickBerry(' + i + ')" style="width:65px;height:65px;background:linear-gradient(135deg,#c0392b,#e74c3c);border-radius:12px;border:2px solid #f39c12;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:32px;transition:all 0.15s;box-shadow:0 4px 8px rgba(0,0,0,0.3);">🍓</div>';
  }
  html += '</div>';

  html += '<div id="hwBerryStatus" style="margin-top:16px;color:#aaa;font-size:12px;">Pick a strawberry!</div>';
  html += '<div id="hwBerryRunning" style="margin-top:6px;color:#2ecc71;font-size:13px;font-weight:700;">Won: 0</div>';
  html += '</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  playLog('🍓 [STRAWBERRY] started, picks available: ' + _hwStrawberry.bonuses.length);
}

function halloweenPickBerry(idx) {
  var el = document.querySelector('.hw-berry[data-idx="' + idx + '"]');
  if (!el || el.getAttribute('data-opened') === '1') return;

  // Send bonus_spin request
  halloweenSendBonusSpin(idx, 3);

  el.setAttribute('data-opened', '1');
  el.style.cursor = 'default';
  el.style.pointerEvents = 'none';

  var pickIdx = _hwStrawberry.picked;

  if (pickIdx < _hwStrawberry.bonuses.length) {
    // Reveal prize
    var prize = _hwStrawberry.bonuses[pickIdx];
    el.style.background = 'linear-gradient(135deg,#27ae60,#2ecc71)';
    el.style.borderColor = '#2ecc71';
    el.style.transform = 'scale(1.1)';
    el.style.boxShadow = '0 0 16px rgba(46,204,113,0.6)';
    el.innerHTML = '<span style="font-size:16px;font-weight:800;color:#fff;">' + prize + '</span>';

    _hwStrawberry.picked++;

    // Update running total
    var runningTotal = 0;
    for (var i = 0; i < _hwStrawberry.picked; i++) runningTotal += _hwStrawberry.bonuses[i];
    var runEl = document.getElementById('hwBerryRunning');
    if (runEl) runEl.textContent = 'Won: ' + runningTotal;

    var status = document.getElementById('hwBerryStatus');
    if (status) status.textContent = 'Got ' + prize + '! Pick another...';
  } else {
    // Game over — this is the extra pick that ends the game
    el.style.background = '#333';
    el.style.borderColor = '#666';
    el.innerHTML = '<span style="font-size:20px;">❌</span>';

    // Disable all remaining
    document.querySelectorAll('.hw-berry').forEach(function(b) {
      b.style.pointerEvents = 'none';
    });

    var status = document.getElementById('hwBerryStatus');
    if (status) { status.style.color = '#e74c3c'; status.textContent = 'Game Over!'; }

    // Show total prize and close
    setTimeout(function() {
      halloweenStrawberryComplete();
    }, 1500);
  }
}

function halloweenStrawberryComplete() {
  var modal = document.getElementById('hwStrawberryModal');
  if (!modal) return;

  // Show total prize overlay
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:10;animation:jpScale 0.8s ease-out;';
  overlay.innerHTML =
    '<div style="color:#e74c3c;font-size:18px;font-weight:700;margin-bottom:8px;">🍓 STRAWBERRY BONUS! 🍓</div>' +
    '<div style="color:#fff;font-size:40px;font-weight:900;text-shadow:0 0 20px #e74c3c,0 2px 8px rgba(0,0,0,0.8);margin-bottom:8px;">+ ' + _hwStrawberry.prize.toFixed(2) + '</div>' +
    '<div style="color:#f39c12;font-size:14px;font-weight:700;">X' + _hwStrawberry.multi + ' Multiplier</div>';
  modal.querySelector('div').style.position = 'relative';
  modal.querySelector('div').appendChild(overlay);

  setTimeout(function() {
    var m = document.getElementById('hwStrawberryModal');
    if (m) m.remove();
    _playBonusPending = false;
    slotRoundOver();
    playLog('🍓 [STRAWBERRY] complete, prize: ' + _hwStrawberry.prize);
  }, 2500);
}


// ===========================================================================
// Shared: Send bonus_spin request for Halloween features
// ===========================================================================
function halloweenSendBonusSpin(position, featureId) {
  if (!_playWs || _playWs.readyState !== WebSocket.OPEN) return;
  var st = _slotState;
  var cmd = {
    cmd: 'bonus_spin',
    session_token: st.sessionToken,
    game_id: st.machineId,
    currency: st.currency,
    opt_id: st.loginResp.opt_id || '',
    username: st.loginResp.username || '',
    position: position,
    feature_id: featureId
  };
  playLog('>>> [HW BONUS SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}
