// ---------------------------------------------------------------------------
// Halloween25 Machine Plugin (Slot)
// Same pumpkin jar and strawberry bonus features as Halloween20.
// Reuses Halloween20's bonus functions directly.
// ---------------------------------------------------------------------------
MachineRegistry.register('Halloween25', {
  type: 'slot',

  afterRender: function(resp, config) {
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
// Move last 5 line numbers (vertical lines 21-25) to bottom of each reel column
// ---------------------------------------------------------------------------
function halloween25MoveVerticalLineNumbers() {
  var st = _slotState;
  var totalLines = st.maxLines || 25;
  var colCount = st.colCount || 5;
  // Last 5 lines (index 20-24) are vertical, one per column
  var verticalStartIdx = totalLines - colCount; // 20

  var reelsContainer = document.getElementById('slotReelsContainer');
  if (!reelsContainer) return;

  // Remove these line numbers from left/right side panels
  for (var i = verticalStartIdx; i < totalLines; i++) {
    var existing = document.querySelector('.slot-line-num[data-line="' + i + '"]');
    if (existing) existing.remove();
  }

  // Add them below each reel column
  var bottomBar = document.getElementById('hw25VerticalLines');
  if (bottomBar) bottomBar.remove();

  bottomBar = document.createElement('div');
  bottomBar.id = 'hw25VerticalLines';
  bottomBar.style.cssText = 'position:absolute;bottom:-20px;left:0;width:100%;display:flex;justify-content:space-around;padding:0 4%;z-index:5;';

  var SLOT_LINE_COLORS = window.SLOT_LINE_COLORS || ['#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6','#1abc9c','#e91e63','#ff9800','#4caf50','#2196f3','#673ab7','#00bcd4','#f44336','#ffc107','#8bc34a','#03a9f4','#ff5722','#795548','#607d8b','#cddc39','#e74c3c','#3498db','#27ae60','#f39c12','#9b59b6'];

  for (var col = 0; col < colCount; col++) {
    var lineIdx = verticalStartIdx + col;
    var color = SLOT_LINE_COLORS[lineIdx] || '#888';
    var isActive = lineIdx < st.activeLines;
    bottomBar.innerHTML += '<div class="slot-line-num" data-line="' + lineIdx + '" onclick="slotToggleLine(' + lineIdx + ')" style="width:18px;height:12px;border-radius:8px;background:' + color + ';color:#fff;font-size:6px;font-weight:700;text-align:center;line-height:12px;cursor:pointer;opacity:' + (isActive ? '1' : '0.4') + ';">' + (lineIdx + 1) + '</div>';
  }

  reelsContainer.style.position = 'relative';
  reelsContainer.appendChild(bottomBar);
}
