// ---------------------------------------------------------------------------
// CarnavalBingo Machine Plugin (Bingo)
// 5x3 cards, max 4 cards, overlap_win pattern matching.
// Features: BuffDoubleFreeEBFeature, BuffCalaWildEBFeature, BuffLightningEBFeature
// Lucky Ball: same as SuperRich — magic_available_balls triggers coin picker.
// Lightning EB: free bonus balls marked on cards with lightning effect.
// ---------------------------------------------------------------------------
MachineRegistry.register('CarnavalBingo', {
  type: 'bingo',

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
      // Check for wheel bonus triggered during EB phase
      if (resp.carnaval_bonus && resp.carnaval_bonus.length > 0) {
        playDisableEbButton();
        setTimeout(function() {
          carnavalWheelShow(resp.carnaval_bonus, resp.carnaval_prize || 0);
        }, 600);
      }
    } else {
      // Normal spin response
      playHandleSpinResponse(resp);
      // Lightning can also trigger on initial spin
      if (resp.lightning_ebs && resp.lightning_ebs.length > 0) {
        setTimeout(function() {
          carnavalLightningEb(resp.lightning_ebs);
        }, 400);
      }
      // Wheel bonus can trigger on spin too
      if (resp.carnaval_bonus && resp.carnaval_bonus.length > 0) {
        setTimeout(function() {
          carnavalWheelShow(resp.carnaval_bonus, resp.carnaval_prize || 0);
        }, 600);
      }
    }
  }
});

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
// CarnavalBingo Bonus Wheel
// ===========================================================================
var _carnavalWheel = {
  segments: [],       // from config bonus_wheel
  results: [],       // server-determined stop values [2, 3, 150]
  prize: 0,          // total prize
  currentSpin: 0,    // current spin index
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
    if (features[i].reference && features[i].reference.indexOf('CarnavalBonusFeature') >= 0) {
      return (features[i].config && features[i].config.bonus_wheel) || [];
    }
  }
  return [];
}

/**
 * Show the wheel bonus modal.
 */
function carnavalWheelShow(results, prize) {
  _carnavalWheel.segments = carnavalWheelGetSegments();
  _carnavalWheel.results = results;
  _carnavalWheel.prize = prize;
  _carnavalWheel.currentSpin = 0;
  _carnavalWheel.spinning = false;
  _carnavalWheel.angle = 0;

  if (_carnavalWheel.segments.length === 0) return;

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
  html += '<div style="color:#f5d742;font-size:18px;font-weight:700;margin-bottom:12px;">🎡 BONUS WHEEL</div>';
  html += '<div id="carnavalWheelStatus" style="color:#ccc;font-size:12px;margin-bottom:12px;">Spin ' + (_carnavalWheel.currentSpin + 1) + ' of ' + _carnavalWheel.results.length + '</div>';

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
  html += '<div id="carnavalWheelPrize" style="color:#fff;font-size:14px;font-weight:700;margin-top:12px;">Prize: 0</div>';
  html += '</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  playLog('🎡 [WHEEL] showing: results=' + JSON.stringify(results) + ', prize=' + prize);
}

/**
 * Player clicks PLAY — spin the wheel.
 */
function carnavalWheelSpin() {
  if (_carnavalWheel.spinning) return;
  if (_carnavalWheel.currentSpin >= _carnavalWheel.results.length) return;

  _carnavalWheel.spinning = true;
  var btn = document.getElementById('carnavalWheelPlayBtn');
  if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }

  var targetValue = _carnavalWheel.results[_carnavalWheel.currentSpin];
  var segments = _carnavalWheel.segments;
  var segCount = segments.length;
  var anglePerSeg = 360 / segCount;

  // Find the index of the target value segment
  var targetIdx = -1;
  for (var i = 0; i < segCount; i++) {
    if (segments[i] === targetValue) { targetIdx = i; break; }
  }
  if (targetIdx < 0) targetIdx = 0;

  // Calculate target angle: wheel spins clockwise, pointer at top (0 degrees)
  // Target segment center should align with top (0 deg) after rotation
  var targetSegCenter = targetIdx * anglePerSeg + anglePerSeg / 2;
  // The wheel needs to rotate so that this segment is at the top (360 - targetSegCenter)
  var stopAngle = 360 - targetSegCenter;
  // Add full rotations (5-8 spins)
  var fullSpins = (5 + Math.floor(Math.random() * 3)) * 360;
  var totalAngle = _carnavalWheel.angle + fullSpins + stopAngle - (_carnavalWheel.angle % 360);
  _carnavalWheel.angle = totalAngle;

  var disc = document.getElementById('carnavalWheelDisc');
  if (disc) {
    disc.style.transform = 'rotate(' + totalAngle + 'deg)';
  }

  // After spin completes (4s transition)
  setTimeout(function() {
    _carnavalWheel.spinning = false;
    _carnavalWheel.currentSpin++;

    // Update status
    var statusEl = document.getElementById('carnavalWheelStatus');
    if (statusEl) {
      if (_carnavalWheel.currentSpin >= _carnavalWheel.results.length) {
        statusEl.textContent = 'All spins complete!';
      } else {
        statusEl.textContent = 'Spin ' + (_carnavalWheel.currentSpin + 1) + ' of ' + _carnavalWheel.results.length;
      }
    }

    // Update prize display
    var prizeEl = document.getElementById('carnavalWheelPrize');
    var runningPrize = 0;
    for (var i = 0; i < _carnavalWheel.currentSpin; i++) {
      runningPrize += _carnavalWheel.results[i];
    }
    if (prizeEl) prizeEl.textContent = 'Result: ' + targetValue + ' | Total: ' + runningPrize;

    if (_carnavalWheel.currentSpin >= _carnavalWheel.results.length) {
      // All spins done — show final prize and close
      setTimeout(function() {
        carnavalWheelFinish();
      }, 1500);
    } else {
      // Re-enable PLAY button for next spin
      var btn2 = document.getElementById('carnavalWheelPlayBtn');
      if (btn2) { btn2.style.opacity = '1'; btn2.style.pointerEvents = ''; }
    }
  }, 4200);
}

/**
 * Finish the wheel bonus — show total prize and close.
 */
function carnavalWheelFinish() {
  var modal = document.getElementById('carnavalWheelModal');
  if (modal) {
    // Show final prize overlay
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);border-radius:16px;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:10;';
    overlay.innerHTML = '<div style="color:#f5d742;font-size:16px;font-weight:700;margin-bottom:8px;">🎉 WHEEL BONUS</div>' +
      '<div style="color:#fff;font-size:32px;font-weight:900;text-shadow:0 2px 8px rgba(245,215,66,0.6);">+ ' + _carnavalWheel.prize.toFixed(2) + '</div>';
    modal.querySelector('div').appendChild(overlay);

    setTimeout(function() {
      var m = document.getElementById('carnavalWheelModal');
      if (m) m.remove();
      // Update balance
      var newBal = playGetCurrentBalance() + _carnavalWheel.prize;
      playAnimateBalance(newBal, 1000);
      // Re-enable EB button
      playEnableEbButton();
    }, 2000);
  }
}
