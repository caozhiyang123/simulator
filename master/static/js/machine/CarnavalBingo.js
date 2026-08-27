// ---------------------------------------------------------------------------
// CarnavalBingo Machine Plugin (Bingo)
// 5x3 cards, max 4 cards, overlap_win pattern matching.
// Features: BuffDoubleFreeEBFeature, BuffCalaWildEBFeature, BuffLightningEBFeature,
//           SuperCarnavalBonusFeature (deferred wheel bonus with bonus_start/bonus_spin)
// Lucky Ball: same as SuperRich — magic_available_balls triggers coin picker.
// Lightning EB: free bonus balls marked on cards with lightning effect.
// ---------------------------------------------------------------------------
MachineRegistry.register('CarnavalBingo', {
  type: 'bingo',

  // Handle reconnection state from login response (super_carnaval_bonus in login data)
  afterRender: function(resp, machineConfig) {
    carnavalHandleLoginBonusState(resp);
  },

  onSpinResponse: function(resp) {
    // Check if this is an EB response with magic_available_balls (lucky ball)
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
      // Check for lightning EB
      if (resp.lightning_ebs && resp.lightning_ebs.length > 0) {
        setTimeout(function() {
          carnavalLightningEb(resp.lightning_ebs);
        }, 400);
      }
      // Check for SuperCarnavalBonus triggered during EB phase
      carnavalUpdateBonusState(resp);
    } else {
      // Normal spin response
      playHandleSpinResponse(resp);
      // Lightning can also trigger on initial spin
      if (resp.lightning_ebs && resp.lightning_ebs.length > 0) {
        setTimeout(function() {
          carnavalLightningEb(resp.lightning_ebs);
        }, 400);
      }
      // Check for SuperCarnavalBonus triggered on spin
      carnavalUpdateBonusState(resp);
    }
  }
});

// ---------------------------------------------------------------------------
// SuperCarnavalBonus State (deferred wheel bonus — same pattern as WildWestBingo)
// ---------------------------------------------------------------------------
var _carnavalBonusHasBonus = false;    // true when super_carnaval_bonus is present
var _carnavalBonusPrize = 0;           // carnaval_prize from response
var _carnavalBonusMultiplier = 0;      // multiplier from response
var _carnavalBonusResults = [];        // carnaval_bonus array (wheel values per spin)
var _carnavalBonusPositions = [];      // carnaval_bonus_positions (results of completed spins)
var _carnavalBonusStarted = false;     // bonus_start flag from server
var _carnavalBonusCurrentSpin = 0;     // client-tracked spin index (0-based)

// ---------------------------------------------------------------------------
// Update bonus state from every spin/EB response.
// Data comes via "super_carnaval_bonus" field as a JSON string.
// Server response format:
// "super_carnaval_bonus": "{\"carnaval_prize\":1.8,\"multiplier\":1.2,
//   \"carnaval_bonus\":[150],\"carnaval_bonus_positions\":[],\"bonus_start\":true}"
// ---------------------------------------------------------------------------
function carnavalUpdateBonusState(resp) {
  if (resp.super_carnaval_bonus) {
    var bonusData = {};
    try {
      bonusData = (typeof resp.super_carnaval_bonus === 'string') ? JSON.parse(resp.super_carnaval_bonus) : resp.super_carnaval_bonus;
    } catch (e) {
      playLog('[CarnavalBingo] ERROR parsing super_carnaval_bonus: ' + e);
      bonusData = {};
    }

    _carnavalBonusHasBonus = true;
    _carnavalBonusPrize = bonusData.carnaval_prize || 0;
    _carnavalBonusMultiplier = bonusData.multiplier || 0;
    _carnavalBonusResults = bonusData.carnaval_bonus || [];
    _carnavalBonusPositions = bonusData.carnaval_bonus_positions || [];
    _carnavalBonusStarted = bonusData.bonus_start === true;
    _playBonusPending = true;

    playLog('[CarnavalBingo] super_carnaval_bonus detected: prize=' + _carnavalBonusPrize +
      ', multiplier=' + _carnavalBonusMultiplier +
      ', bonus=' + JSON.stringify(_carnavalBonusResults) +
      ', positions=' + JSON.stringify(_carnavalBonusPositions) +
      ', bonus_start=' + _carnavalBonusStarted);
  }
}

// ---------------------------------------------------------------------------
// Handle bonus state from login response (reconnection scenario)
// Login returns super_carnaval_bonus with bonus_start flag:
//   bonus_start=false: player disconnected before entering wheel bonus
//     -> if has_extra_ball, allow EB purchase; bonus deferred as normal
//     -> if no EB available, immediately send bonus_start and enter wheel
//   bonus_start=true: player disconnected after entering wheel bonus
//     -> skip EB, directly enter wheel bonus flow
//     -> if carnaval_bonus_positions is empty: no spins done yet, start from beginning
//     -> if carnaval_bonus_positions.length < carnaval_bonus.length: resume from where left off
//     -> if carnaval_bonus_positions.length == carnaval_bonus.length: wheel done, round over
// ---------------------------------------------------------------------------
function carnavalHandleLoginBonusState(resp) {
  if (!resp.super_carnaval_bonus) return;

  var bonusData = {};
  try {
    bonusData = (typeof resp.super_carnaval_bonus === 'string') ? JSON.parse(resp.super_carnaval_bonus) : resp.super_carnaval_bonus;
  } catch (e) {
    playLog('[CarnavalBingo] ERROR parsing login super_carnaval_bonus: ' + e);
    return;
  }

  var bonusStart = bonusData.bonus_start === true;
  var carnavalBonus = bonusData.carnaval_bonus || [];
  var carnavalPositions = bonusData.carnaval_bonus_positions || [];
  var multiplier = bonusData.multiplier || 0;
  var prize = bonusData.carnaval_prize || 0;

  playLog('[CarnavalBingo] login super_carnaval_bonus: bonus_start=' + bonusStart +
    ', bonus=' + JSON.stringify(carnavalBonus) +
    ', positions=' + JSON.stringify(carnavalPositions) +
    ', multiplier=' + multiplier + ', prize=' + prize);

  // Store bonus state
  _carnavalBonusPrize = prize;
  _carnavalBonusMultiplier = multiplier;
  _carnavalBonusResults = carnavalBonus;
  _carnavalBonusPositions = carnavalPositions;
  _carnavalBonusStarted = bonusStart;

  if (bonusStart) {
    // Player was already inside wheel bonus before disconnect
    // Do NOT allow EB purchase — go directly into wheel bonus or round over
    _carnavalBonusHasBonus = true;
    _playBonusPending = true;
    _playSpinState = 'waiting_roundover';

    // Hide EB buttons and collect button
    setTimeout(function() {
      playRemoveEbButtons();
      var collectBtn = document.getElementById('playCollectBtn');
      if (collectBtn) collectBtn.style.display = 'none';
      var spinBtn = document.getElementById('playSpinBtn');
      if (spinBtn) { spinBtn.style.opacity = '0.5'; spinBtn.style.pointerEvents = 'none'; }
    }, 100);

    if (carnavalPositions.length < carnavalBonus.length) {
      // Resume wheel bonus — still has spins to do
      setTimeout(function() {
        carnavalOpenWheelBonus();
      }, 1000);
    } else {
      // All spins already done — just send round over
      _playBonusPending = false;
      _carnavalBonusHasBonus = false;
      setTimeout(function() {
        _playSpinState = 'waiting_roundover';
        playRoundOver();
      }, 1000);
    }
  } else {
    // Player disconnected before entering wheel bonus (bonus_start=false)
    // Check if EB is available
    _carnavalBonusHasBonus = true;
    _playBonusPending = true;

    if (carnavalBonus.length > 0) {
      if (!resp.has_extra_ball) {
        // No EB available — immediately send bonus_start and enter wheel
        _playSpinState = 'waiting_roundover';
        setTimeout(function() {
          playRemoveEbButtons();
          var collectBtn = document.getElementById('playCollectBtn');
          if (collectBtn) collectBtn.style.display = 'none';
          var spinBtn = document.getElementById('playSpinBtn');
          if (spinBtn) { spinBtn.style.opacity = '0.5'; spinBtn.style.pointerEvents = 'none'; }
          carnavalSendBonusStart();
        }, 1000);
      }
      // If has_extra_ball is true, normal UI will show EB buttons.
      // Bonus will be triggered when player clicks COLLECT or runs out of EB.
    }
  }
}

// ---------------------------------------------------------------------------
// Trigger bonus game (called when round is about to end and bonus is pending)
// Same pattern as wildWestTriggeredBonusBeforeRoundOver
// ---------------------------------------------------------------------------
function carnavalTriggeredBonusBeforeRoundOver() {
  if (_carnavalBonusHasBonus) {
    carnavalSendBonusStart();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Send bonus_start command to server (feature_id = 6 for SuperCarnavalBonusFeature)
// ---------------------------------------------------------------------------
function carnavalSendBonusStart() {
  var resp = _playCurrentMachine.response;
  var cmd = {
    cmd: 'bonus_start',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    feature_id: 6
  };
  playLog('>>> [CARNAVAL BONUS START] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

// ---------------------------------------------------------------------------
// Handle bonus_start response from server
// ---------------------------------------------------------------------------
function carnavalHandleBonusStartResponse(resp) {
  playLog('[CarnavalBingo] bonus_start response: ' + JSON.stringify(resp));

  if (resp.bonus_start === true || resp.super_carnaval_bonus) {
    // Server acknowledged bonus session started — open wheel
    _carnavalBonusStarted = true;

    // Update state from response if provided
    if (resp.super_carnaval_bonus) {
      var bonusData = {};
      try {
        bonusData = (typeof resp.super_carnaval_bonus === 'string') ? JSON.parse(resp.super_carnaval_bonus) : resp.super_carnaval_bonus;
      } catch (e) {
        playLog('[CarnavalBingo] ERROR parsing bonus_start super_carnaval_bonus: ' + e);
        bonusData = {};
      }
      _carnavalBonusPrize = bonusData.carnaval_prize || _carnavalBonusPrize;
      _carnavalBonusMultiplier = bonusData.multiplier || _carnavalBonusMultiplier;
      _carnavalBonusResults = bonusData.carnaval_bonus || _carnavalBonusResults;
      _carnavalBonusPositions = bonusData.carnaval_bonus_positions || _carnavalBonusPositions;
    }

    carnavalOpenWheelBonus();
  } else {
    playLog('[CarnavalBingo] bonus_start rejected, proceeding with round over');
    _playBonusPending = false;
    _carnavalBonusHasBonus = false;
    if (_playSpinState === 'waiting_roundover') {
      playRoundOver();
    }
  }
}

// ---------------------------------------------------------------------------
// Send bonus_spin command to server (one spin of the wheel)
// position: index of the current spin (0-based)
// ---------------------------------------------------------------------------
function carnavalSendBonusSpin() {
  var resp = _playCurrentMachine.response;
  var position = _carnavalBonusCurrentSpin; // current spin index (0-based)
  var cmd = {
    cmd: 'bonus_spin',
    session_token: _playSessionToken,
    game_id: _playCurrentMachine.machine_id,
    currency: _playCurrency,
    opt_id: resp.opt_id || '',
    username: resp.username || '',
    position: position
  };
  playLog('>>> [CARNAVAL BONUS SPIN] send: ' + JSON.stringify(cmd));
  _playWs.send(JSON.stringify(cmd));
}

// ---------------------------------------------------------------------------
// Handle bonus_spin response from server
// Server returns updated carnaval_bonus_positions after each spin.
// ---------------------------------------------------------------------------
function carnavalHandleBonusSpinResponse(resp) {
  playLog('[CarnavalBingo] bonus_spin response: ' + JSON.stringify(resp));

  var bonusData = {};
  if (resp.super_carnaval_bonus) {
    try {
      bonusData = (typeof resp.super_carnaval_bonus === 'string') ? JSON.parse(resp.super_carnaval_bonus) : resp.super_carnaval_bonus;
    } catch (e) {
      playLog('[CarnavalBingo] ERROR parsing bonus_spin super_carnaval_bonus: ' + e);
      bonusData = {};
    }
  } else {
    bonusData = resp;
  }

  // Update prize from server if provided
  if (bonusData.carnaval_prize !== undefined) {
    _carnavalBonusPrize = bonusData.carnaval_prize;
  }

  // Update positions from server if provided
  if (bonusData.carnaval_bonus_positions && bonusData.carnaval_bonus_positions.length > 0) {
    _carnavalBonusPositions = bonusData.carnaval_bonus_positions;
  }

  // Determine the target value for this spin.
  // Use _carnavalBonusCurrentSpin as the definitive spin index (client-tracked).
  // The target value is carnaval_bonus[currentSpinIndex].
  var spinIndex = _carnavalBonusCurrentSpin;
  var latestResult = 0;

  if (_carnavalBonusResults.length > spinIndex) {
    latestResult = _carnavalBonusResults[spinIndex];
  }

  // Fallback: try carnaval_bonus_positions last element from server
  if ((latestResult === 0 || latestResult === undefined) && _carnavalBonusPositions.length > 0) {
    latestResult = _carnavalBonusPositions[_carnavalBonusPositions.length - 1];
  }

  // Increment the local spin counter
  _carnavalBonusCurrentSpin++;

  // Also update _carnavalBonusPositions locally if server didn't provide it
  if (!bonusData.carnaval_bonus_positions || bonusData.carnaval_bonus_positions.length === 0) {
    _carnavalBonusPositions.push(latestResult);
  }

  playLog('[CarnavalBingo] wheel spin result: ' + latestResult + ' (spinIndex=' + spinIndex + ', totalSpins=' + _carnavalBonusResults.length + ')');

  // Animate the wheel to the result
  carnavalWheelAnimateToResult(latestResult, function() {
    // After animation completes, check if more spins remain
    var totalSpins = _carnavalBonusResults.length;
    var completedSpins = _carnavalBonusCurrentSpin;

    // Update status
    var statusEl = document.getElementById('carnavalWheelStatus');
    if (statusEl) {
      if (completedSpins >= totalSpins) {
        statusEl.textContent = 'All spins complete!';
      } else {
        statusEl.textContent = 'Spin ' + (completedSpins + 1) + ' of ' + totalSpins;
      }
    }

    // Update prize display
    var prizeEl = document.getElementById('carnavalWheelPrize');
    if (prizeEl) {
      var runningTotal = 0;
      for (var i = 0; i < _carnavalBonusPositions.length; i++) {
        runningTotal += _carnavalBonusPositions[i];
      }
      prizeEl.textContent = 'Result: ' + latestResult + ' | Total: ' + runningTotal;
    }

    if (completedSpins >= totalSpins) {
      // All spins done — show final prize and close
      setTimeout(function() {
        carnavalWheelFinish();
      }, 1500);
    } else {
      // Re-enable PLAY button for next spin
      _carnavalWheel.spinning = false;
      var btn = document.getElementById('carnavalWheelPlayBtn');
      if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = ''; }
    }
  });
}

// ---------------------------------------------------------------------------
// Lightning EB — mark free balls on cards with lightning effect
// ---------------------------------------------------------------------------
function carnavalLightningEb(lightningBalls) {
  if (!lightningBalls || lightningBalls.length === 0) return;

  playLog('⚡ [LIGHTNING EB] free balls: ' + JSON.stringify(lightningBalls));

  // Add lightning balls to ball area and mark on cards
  var ballArea = document.getElementById('playBallArea');

  lightningBalls.forEach(function(ballNum, idx) {
    setTimeout(function() {
      // Add ball to ball area with lightning style
      if (ballArea) {
        ballArea.innerHTML += '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#fff176,#ffeb3b,#f9a825);border:2px solid #ff6f00;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#333;box-shadow:0 0 8px rgba(255,235,59,0.8);animation:carnavalLightningPulse 0.6s ease;">' + ballNum + '</div>';
      }

      // Mark on cards
      playMarkBallOnCards(ballNum);

      // Show lightning effect on the card cells that match
      carnavalShowLightningOnCells(ballNum);

      // Re-check patterns after all lightning balls are added
      if (idx === lightningBalls.length - 1) {
        setTimeout(function() {
          playRecheckPatternsAfterEb();
        }, 300);
      }
    }, idx * 500); // stagger each lightning ball by 500ms
  });
}

// ---------------------------------------------------------------------------
// Show lightning bolt effect on card cells that contain the ball number
// ---------------------------------------------------------------------------
function carnavalShowLightningOnCells(ballNum) {
  var cells = document.querySelectorAll('.play-card-cell');
  cells.forEach(function(cell) {
    if (parseInt(cell.getAttribute('data-num')) === ballNum) {
      // Create lightning overlay on this cell
      var rect = cell.getBoundingClientRect();
      var bolt = document.createElement('div');
      bolt.className = 'carnaval-lightning-bolt';
      bolt.style.cssText = 'position:fixed;left:' + (rect.left + rect.width / 2 - 30) + 'px;top:' + (rect.top - 50) + 'px;z-index:9000;pointer-events:none;';
      bolt.innerHTML = '<svg width="60" height="100" viewBox="0 0 60 100"><polygon points="30,0 15,40 35,40 8,100 40,50 22,50 45,10" fill="#ffeb3b" stroke="#ff6f00" stroke-width="2"><animate attributeName="opacity" values="1;0.4;1;0.6;1" dur="0.3s" repeatCount="4"/></polygon><polygon points="30,0 15,40 35,40 8,100 40,50 22,50 45,10" fill="#fff" opacity="0.5"><animate attributeName="opacity" values="0.6;0;0.4;0;0.3;0" dur="1.5s" fill="freeze"/></polygon></svg>';
      document.body.appendChild(bolt);

      // Animate: flash and hold, then fade out
      bolt.animate([
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 1, transform: 'scale(1.2)', offset: 0.2 },
        { opacity: 1, transform: 'scale(1.1)', offset: 0.6 },
        { opacity: 0, transform: 'scale(0.9)' }
      ], { duration: 1800, easing: 'ease-out', fill: 'forwards' }).onfinish = function() {
        bolt.remove();
      };

      // Flash the cell for longer
      cell.style.boxShadow = '0 0 16px 6px rgba(255,235,59,1)';
      cell.style.background = '#fff176';
      setTimeout(function() {
        cell.style.boxShadow = '0 0 8px 3px rgba(255,235,59,0.5)';
      }, 800);
      setTimeout(function() {
        cell.style.boxShadow = '';
        cell.style.background = '#222';
        cell.style.color = '#fff';
      }, 1500);
    }
  });
}

// ===========================================================================
// CarnavalBingo Bonus Wheel (SuperCarnavalBonusFeature)
// Now uses deferred bonus_start/bonus_spin protocol instead of inline results.
// ===========================================================================
var _carnavalWheel = {
  segments: [],       // from config bonus_wheel
  spinning: false,
  angle: 0           // current wheel rotation angle
};

/**
 * Get bonus_wheel segments from machine config.
 */
function carnavalWheelGetSegments() {
  if (!_playCurrentMachine || !_playCurrentMachine.config) return [];
  var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && (features[i].reference.indexOf('SuperCarnavalBonusFeature') >= 0 || features[i].reference.indexOf('CarnavalBonusFeature') >= 0)) {
      return (features[i].config && features[i].config.bonus_wheel) || [];
    }
  }
  return [];
}

/**
 * Open the wheel bonus modal (called after bonus_start is acknowledged).
 */
function carnavalOpenWheelBonus() {
  _carnavalWheel.segments = carnavalWheelGetSegments();
  _carnavalWheel.spinning = false;
  _carnavalWheel.angle = 0;

  // Initialize current spin index from already-completed positions (for reconnection)
  _carnavalBonusCurrentSpin = _carnavalBonusPositions.length;

  if (_carnavalWheel.segments.length === 0) {
    playLog('[CarnavalBingo] ERROR: no bonus_wheel segments in config');
    _playBonusPending = false;
    _carnavalBonusHasBonus = false;
    playRoundOver();
    return;
  }

  var totalSpins = _carnavalBonusResults.length;
  var completedSpins = _carnavalBonusPositions.length;

  var old = document.getElementById('carnavalWheelModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'carnavalWheelModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var segCount = _carnavalWheel.segments.length;
  var size = 320;
  var colors = ['#e74c3c','#f39c12','#27ae60','#3498db','#9b59b6','#1abc9c','#e91e63','#ff9800','#4caf50','#2196f3','#673ab7','#00bcd4','#f44336','#ffc107','#8bc34a','#03a9f4'];

  // Build wheel SVG
  var svgParts = '';
  var anglePerSeg = 360 / segCount;
  for (var i = 0; i < segCount; i++) {
    var startAngle = i * anglePerSeg;
    var endAngle = (i + 1) * anglePerSeg;
    var startRad = (startAngle - 90) * Math.PI / 180;
    var endRad = (endAngle - 90) * Math.PI / 180;
    var r = size / 2 - 4;
    var cx = size / 2, cy = size / 2;
    var x1 = cx + r * Math.cos(startRad);
    var y1 = cy + r * Math.sin(startRad);
    var x2 = cx + r * Math.cos(endRad);
    var y2 = cy + r * Math.sin(endRad);
    var largeArc = anglePerSeg > 180 ? 1 : 0;
    var color = colors[i % colors.length];
    svgParts += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + largeArc + ',1 ' + x2 + ',' + y2 + ' Z" fill="' + color + '" stroke="#fff" stroke-width="1"/>';
    // Text label
    var midAngle = (startAngle + endAngle) / 2;
    var midRad = (midAngle - 90) * Math.PI / 180;
    var tx = cx + (r * 0.65) * Math.cos(midRad);
    var ty = cy + (r * 0.65) * Math.sin(midRad);
    svgParts += '<text x="' + tx + '" y="' + ty + '" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="11" font-weight="700" transform="rotate(' + midAngle + ',' + tx + ',' + ty + ')">' + _carnavalWheel.segments[i] + '</text>';
  }

  var html = '<div style="background:linear-gradient(135deg,#1a1a3e,#2a2a5e);border-radius:16px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,0.7);border:2px solid #f5d742;text-align:center;position:relative;">';
  html += '<div style="color:#f5d742;font-size:18px;font-weight:700;margin-bottom:12px;">🎡 SUPER CARNAVAL BONUS</div>';

  // Multiplier display
  if (_carnavalBonusMultiplier > 0) {
    html += '<div style="color:#2ecc71;font-size:12px;font-weight:700;margin-bottom:8px;">MULTIPLIER: x' + _carnavalBonusMultiplier + '</div>';
  }

  html += '<div id="carnavalWheelStatus" style="color:#ccc;font-size:12px;margin-bottom:12px;">Spin ' + (completedSpins + 1) + ' of ' + totalSpins + '</div>';

  // Wheel container with pointer
  html += '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;margin:0 auto;">';
  // Pointer (top center)
  html += '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);z-index:5;font-size:24px;">▼</div>';
  // Wheel
  html += '<div id="carnavalWheelDisc" style="width:100%;height:100%;transition:transform 4s cubic-bezier(0.17,0.67,0.12,0.99);">';
  html += '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + svgParts + '</svg>';
  html += '</div>';
  // Center PLAY button
  html += '<div id="carnavalWheelPlayBtn" onclick="carnavalWheelSpin()" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;height:60px;border-radius:50%;background:linear-gradient(to bottom,#e74c3c,#c0392b);border:3px solid #fff;box-shadow:0 4px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:3;"><span style="color:#fff;font-size:12px;font-weight:800;">PLAY</span></div>';
  html += '</div>';

  // Prize display
  var currentPrizeTotal = 0;
  for (var p = 0; p < _carnavalBonusPositions.length; p++) {
    currentPrizeTotal += _carnavalBonusPositions[p];
  }
  html += '<div id="carnavalWheelPrize" style="color:#fff;font-size:14px;font-weight:700;margin-top:12px;">Prize: ' + currentPrizeTotal + '</div>';
  html += '</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  playLog('🎡 [WHEEL] opened: totalSpins=' + totalSpins + ', completedSpins=' + completedSpins +
    ', multiplier=' + _carnavalBonusMultiplier + ', prize=' + _carnavalBonusPrize);
}

/**
 * Player clicks PLAY — send bonus_spin to server.
 * The wheel animation happens AFTER we get the server response.
 */
function carnavalWheelSpin() {
  if (_carnavalWheel.spinning) return;

  var totalSpins = _carnavalBonusResults.length;
  var completedSpins = _carnavalBonusCurrentSpin;
  if (completedSpins >= totalSpins) return;

  _carnavalWheel.spinning = true;
  var btn = document.getElementById('carnavalWheelPlayBtn');
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }

  // Send bonus_spin to server — wheel animation triggered by response
  carnavalSendBonusSpin();
}

/**
 * Animate wheel to a target result value.
 * @param {number} targetValue - The segment value to land on.
 * @param {function} callback - Called after animation completes.
 */
function carnavalWheelAnimateToResult(targetValue, callback) {
  var segments = _carnavalWheel.segments;
  var segCount = segments.length;
  var anglePerSeg = 360 / segCount;

  // Find ALL indices that match the target value, then pick one randomly
  // This handles duplicate values in the wheel (e.g. multiple 100 segments)
  var matchingIndices = [];
  for (var i = 0; i < segCount; i++) {
    if (Number(segments[i]) === Number(targetValue)) {
      matchingIndices.push(i);
    }
  }

  var targetIdx;
  if (matchingIndices.length > 0) {
    // Randomly pick one of the matching segments for visual variety
    targetIdx = matchingIndices[Math.floor(Math.random() * matchingIndices.length)];
  } else {
    // Should not happen — log warning and default to 0
    playLog('[CarnavalBingo] WARNING: targetValue ' + targetValue + ' not found in wheel segments');
    targetIdx = 0;
  }

  // Calculate target angle
  var targetSegCenter = targetIdx * anglePerSeg + anglePerSeg / 2;
  var stopAngle = 360 - targetSegCenter;
  // Add full rotations (5-8 spins)
  var fullSpins = (5 + Math.floor(Math.random() * 3)) * 360;
  var totalAngle = _carnavalWheel.angle + fullSpins + stopAngle - (_carnavalWheel.angle % 360);
  _carnavalWheel.angle = totalAngle;

  var disc = document.getElementById('carnavalWheelDisc');
  if (disc) {
    disc.style.transform = 'rotate(' + totalAngle + 'deg)';
  }

  // After spin animation completes (4s transition)
  setTimeout(function() {
    if (callback) callback();
  }, 4200);
}

/**
 * Finish the wheel bonus — show total prize, close modal, send round over.
 */
function carnavalWheelFinish() {
  var modal = document.getElementById('carnavalWheelModal');
  if (modal) {
    // Show final prize overlay
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:10;';
    overlay.innerHTML = '<div style="color:#f5d742;font-size:16px;font-weight:700;margin-bottom:8px;">🎉 SUPER CARNAVAL BONUS</div>' +
      '<div style="color:#fff;font-size:32px;font-weight:900;text-shadow:0 2px 8px rgba(245,215,66,0.6);">+ ' + _carnavalBonusPrize.toFixed(2) + '</div>';
    modal.querySelector('div').appendChild(overlay);

    setTimeout(function() {
      var m = document.getElementById('carnavalWheelModal');
      if (m) m.remove();

      // Reset bonus state
      _playBonusPending = false;
      _carnavalBonusHasBonus = false;
      _carnavalBonusStarted = false;
      _carnavalBonusCurrentSpin = 0;
      _carnavalBonusResults = [];
      _carnavalBonusPositions = [];
      _carnavalWheel.spinning = false;

      // Send round over
      _playSpinState = 'waiting_roundover';
      playRoundOver();
    }, 2000);
  } else {
    // No modal — just clean up and round over
    _playBonusPending = false;
    _carnavalBonusHasBonus = false;
    _carnavalBonusStarted = false;
    _carnavalBonusCurrentSpin = 0;
    _playSpinState = 'waiting_roundover';
    playRoundOver();
  }
}
