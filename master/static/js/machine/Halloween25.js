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
