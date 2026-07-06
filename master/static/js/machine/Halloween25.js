// ---------------------------------------------------------------------------
// Halloween25 Machine Plugin (Slot)
// Same pumpkin jar and strawberry bonus features as Halloween20.
// Reuses Halloween20's bonus functions directly.
// ---------------------------------------------------------------------------
MachineRegistry.register('Halloween25', {
  type: 'slot',

  afterRender: function(resp, config) {
    halloween25PlaceVerticalLineNumbers();
  },

  onSpinResponse: function(resp) {
    // If pumpkin jar bonus triggered, defer round over
    if (resp.pumpkin_jar_bonus_caldeirao && resp.pumpkin_jar_bonus_caldeirao.length > 0) {
      _playBonusPending = true;
    }
    // If strawberry bonus triggered, defer round over
    if (resp.strawberry_bonus && resp.strawberry_bonus.length > 0) {
      _playBonusPending = true;
    }
    // If wheel bonus triggered, defer round over
    if (resp.wheel_bonus && resp.wheel_bonus.length > 0) {
      _playBonusPending = true;
    }
    // If dice bonus triggered, defer round over
    if (resp.dice_bonus && resp.dice_bonus.length > 0) {
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
    // Show wheel bonus after reels stop
    if (resp.wheel_bonus && resp.wheel_bonus.length > 0) {
      setTimeout(function() {
        halloween25ShowWheelBonus(resp.wheel_bonus, resp.wheel_prize || 0, resp.wheel_multi || 0);
      }, 3800);
    }
    // Show dice bonus after reels stop
    if (resp.dice_bonus && resp.dice_bonus.length > 0) {
      setTimeout(function() {
        halloween25ShowDiceBonus(resp);
      }, 3800);
    }
  }
});


// ---------------------------------------------------------------------------
// Place line 21-25 numbers directly below each reel column
// ---------------------------------------------------------------------------
function halloween25PlaceVerticalLineNumbers() {
  var st = _slotState;
  var totalLines = st.maxLines || 25;
  var colCount = st.colCount || 5;
  var verticalStartIdx = totalLines - colCount; // 20

  // Remove these line numbers from left/right side panels
  for (var i = verticalStartIdx; i < totalLines; i++) {
    var existing = document.querySelector('.slot-line-num[data-line="' + i + '"]');
    if (existing) existing.remove();
  }

  // Get the reels container to position below it
  var reelsContainer = document.getElementById('slotReelsContainer');
  var slotSkin = document.getElementById('slotSkin');
  if (!reelsContainer || !slotSkin) return;

  var old = document.getElementById('hw25VerticalLines');
  if (old) old.remove();

  // Create a row positioned just below the reels container
  var reelTop = parseFloat(reelsContainer.style.top) || 20;
  var reelH = parseFloat(reelsContainer.style.height) || 52;
  var reelLeft = parseFloat(reelsContainer.style.left) || 17;
  var reelW = parseFloat(reelsContainer.style.width) || 66;
  var rowTop = reelTop + reelH + 1; // 1% below reels bottom

  var row = document.createElement('div');
  row.id = 'hw25VerticalLines';
  row.style.cssText = 'position:absolute;top:' + rowTop + '%;left:' + reelLeft + '%;width:' + reelW + '%;display:flex;justify-content:space-around;';

  var SLOT_LINE_COLORS = window.SLOT_LINE_COLORS || ['#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6','#1abc9c','#e91e63','#ff9800','#4caf50','#2196f3','#673ab7','#00bcd4','#f44336','#ffc107','#8bc34a','#03a9f4','#ff5722','#795548','#607d8b','#cddc39','#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6'];

  for (var col = 0; col < colCount; col++) {
    var lineIdx = verticalStartIdx + col;
    var color = SLOT_LINE_COLORS[lineIdx] || '#888';
    var isActive = lineIdx < st.activeLines;
    row.innerHTML += '<div class="slot-line-num" data-line="' + lineIdx + '" onclick="slotToggleLine(' + lineIdx + ')" style="width:18px;height:12px;border-radius:8px;background:' + color + ';color:#fff;font-size:6px;font-weight:700;text-align:center;line-height:12px;cursor:pointer;opacity:' + (isActive ? '1' : '0.4') + ';">' + (lineIdx + 1) + '</div>';
  }

  slotSkin.appendChild(row);
}


// ===========================================================================
// Halloween25 Wheel Bonus — auto-spinning wheel
// ===========================================================================
function halloween25ShowWheelBonus(segments, prize, multi) {
  var old = document.getElementById('hw25WheelModal');
  if (old) old.remove();

  var segCount = segments.length;
  var size = 320;
  var colors = ['#e74c3c','#f39c12','#27ae60','#3498db','#9b59b6','#1abc9c','#e91e63','#ff9800','#4caf50','#2196f3','#673ab7','#00bcd4'];

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
    svgParts += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + largeArc + ',1 ' + x2 + ',' + y2 + ' Z" fill="' + color + '" stroke="#fff" stroke-width="0.5"/>';
    // Text label
    var midAngle = (startAngle + endAngle) / 2;
    var midRad = (midAngle - 90) * Math.PI / 180;
    var tx = cx + (r * 0.7) * Math.cos(midRad);
    var ty = cy + (r * 0.7) * Math.sin(midRad);
    svgParts += '<text x="' + tx + '" y="' + ty + '" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="8" font-weight="700" transform="rotate(' + midAngle + ',' + tx + ',' + ty + ')">' + segments[i] + '</text>';
  }

  var modal = document.createElement('div');
  modal.id = 'hw25WheelModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  var html = '<div style="color:#f39c12;font-size:18px;font-weight:700;margin-bottom:8px;">🎡 WHEEL BONUS!</div>';
  if (multi > 0) html += '<div style="color:#e74c3c;font-size:14px;font-weight:700;margin-bottom:12px;">Multiplier: X' + multi + '</div>';

  // Wheel with pointer
  html += '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;">';
  html += '<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);z-index:5;font-size:24px;">▼</div>';
  html += '<div id="hw25WheelDisc" style="width:100%;height:100%;transition:transform 5s cubic-bezier(0.17,0.67,0.12,0.99);">';
  html += '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + svgParts + '</svg>';
  html += '</div></div>';

  html += '<div id="hw25WheelStatus" style="color:#aaa;font-size:12px;margin-top:12px;">Spinning...</div>';

  modal.innerHTML = html;
  document.body.appendChild(modal);

  // Calculate target angle to land on prize segment
  var targetIdx = -1;
  for (var i = 0; i < segments.length; i++) {
    if (Math.abs(segments[i] - prize) < 0.001) { targetIdx = i; break; }
  }
  if (targetIdx < 0) targetIdx = 0;

  var targetSegCenter = targetIdx * anglePerSeg + anglePerSeg / 2;
  var stopAngle = 360 - targetSegCenter;
  var fullSpins = (6 + Math.floor(Math.random() * 3)) * 360;
  var totalAngle = fullSpins + stopAngle;

  // Start spinning after short delay
  setTimeout(function() {
    var disc = document.getElementById('hw25WheelDisc');
    if (disc) disc.style.transform = 'rotate(' + totalAngle + 'deg)';
  }, 300);

  // After spin completes (5s transition + buffer)
  setTimeout(function() {
    var status = document.getElementById('hw25WheelStatus');
    if (status) {
      status.style.color = '#2ecc71';
      status.textContent = '🎉 Won: ' + prize.toFixed(2) + (multi > 0 ? ' (X' + multi + ')' : '');
    }

    // Show prize overlay and close
    setTimeout(function() {
      var m = document.getElementById('hw25WheelModal');
      if (m) m.remove();
      _playBonusPending = false;
      slotRoundOver();
      playLog('🎡 [WHEEL BONUS] complete, prize: ' + prize);
    }, 2000);
  }, 5500);
}


// ===========================================================================
// Halloween25 Dice Bonus
// ===========================================================================
function halloween25ShowDiceBonus(resp) {
  var dicePrize = resp.dice_prize || 0;
  var diceMulti = resp.dice_multi || 1;
  var bet = (_slotState.betList && _slotState.betList[_slotState.betIndex]) || 0.01;

  // Calculate base dots: base = dice_prize / bet / dice_multi
  var base = Math.round(dicePrize / bet / diceMulti);
  if (base < 1) base = 1;
  if (base > 6) base = 6;

  var old = document.getElementById('hw25DiceModal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'hw25DiceModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;';

  var html = '<div style="color:#f39c12;font-size:20px;font-weight:800;margin-bottom:6px;">🎲 Dice Bonus! 🎲</div>';
  html += '<div style="color:#e74c3c;font-size:14px;font-weight:700;margin-bottom:20px;">Multiplier: X' + diceMulti + '</div>';

  // 4 dice to choose from
  html += '<div id="hw25DiceGrid" style="display:flex;gap:20px;justify-content:center;">';
  for (var i = 0; i < 4; i++) {
    html += '<div class="hw25-dice" data-idx="' + i + '" onclick="halloween25PickDice(' + i + ',' + base + ',' + dicePrize + ')" style="width:80px;height:80px;background:#fff;border-radius:12px;border:3px solid #f39c12;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:40px;box-shadow:0 4px 12px rgba(0,0,0,0.4);transition:all 0.15s;">🎲</div>';
  }
  html += '</div>';

  html += '<div id="hw25DiceStatus" style="margin-top:16px;color:#aaa;font-size:12px;">Pick a dice!</div>';
  modal.innerHTML = html;
  document.body.appendChild(modal);

  playLog('🎲 [DICE BONUS] prize: ' + dicePrize + ', multi: ' + diceMulti + ', base: ' + base);
}

function halloween25PickDice(idx, base, prize) {
  // Disable all dice
  document.querySelectorAll('.hw25-dice').forEach(function(d) {
    d.style.pointerEvents = 'none';
    d.style.opacity = '0.5';
  });

  var selected = document.querySelector('.hw25-dice[data-idx="' + idx + '"]');
  if (selected) {
    selected.style.opacity = '1';
    selected.style.transform = 'scale(1.1)';
    selected.style.borderColor = '#2ecc71';
  }

  var status = document.getElementById('hw25DiceStatus');
  if (status) status.textContent = 'Rolling...';

  // Dice rolling animation
  var rollCount = 0;
  var faces = ['⚀','⚁','⚂','⚃','⚄','⚅'];
  var rollTimer = setInterval(function() {
    if (selected) {
      selected.innerHTML = '<span style="font-size:48px;">' + faces[Math.floor(Math.random() * 6)] + '</span>';
    }
    rollCount++;
    if (rollCount >= 15) {
      clearInterval(rollTimer);
      // Show final face (base value: 1=⚀, 2=⚁, ... 6=⚅)
      if (selected) {
        selected.innerHTML = '<span style="font-size:48px;">' + faces[base - 1] + '</span>';
        selected.style.boxShadow = '0 0 20px rgba(46,204,113,0.6),0 4px 12px rgba(0,0,0,0.4)';
        selected.style.background = 'linear-gradient(135deg,#d4efdf,#fff)';
      }
      if (status) {
        status.style.color = '#2ecc71';
        status.textContent = '🎉 Rolled ' + base + '! Prize: ' + prize.toFixed(2);
      }
      // Close after delay
      setTimeout(function() {
        var m = document.getElementById('hw25DiceModal');
        if (m) m.remove();
        _playBonusPending = false;
        slotRoundOver();
        playLog('🎲 [DICE BONUS] complete, base: ' + base + ', prize: ' + prize);
      }, 2000);
    }
  }, 100);
}
