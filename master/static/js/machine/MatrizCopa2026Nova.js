// ---------------------------------------------------------------------------
// MatrizCopa2026Nova Machine Plugin (Slot)
// 3x5 slot, 30 lines. Line direction from config determines left/right placement.
// Line numbers displayed as golden balls flush against the reels.
// ---------------------------------------------------------------------------
MachineRegistry.register('MatrizCopa2026Nova', {
  type: 'slot',

  afterRender: function(resp, config) {
    // Extend SLOT_LINE_COLORS to support 30 lines
    var extraColors = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa','#00acc1','#d81b60','#ff6d00','#26a69a','#c0ca33'];
    while (SLOT_LINE_COLORS.length < 30) {
      SLOT_LINE_COLORS.push(extraColors[SLOT_LINE_COLORS.length % extraColors.length]);
    }
    // Override line number positions based on line_direction from config
    var mathModel = (config.math_model && config.math_model[0]) || {};
    var lineDir = mathModel.line_direction || [];
    if (lineDir.length > 0) {
      matrizCopaRebuildLineNumbers(lineDir);
    }
  }
});

/**
 * Rebuild line number labels based on line_direction array.
 * direction 1 = left side, direction 2 = right side.
 * Line numbers are flush against the reels (tight spacing).
 */
function matrizCopaRebuildLineNumbers(lineDir) {
  // Remove existing line number containers
  var existing = document.querySelectorAll('.mc-line-container');
  existing.forEach(function(el) { el.remove(); });

  // Remove the default line number divs
  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;
  var absDivs = slotSkin.querySelectorAll('div[style*="position:absolute"]');
  absDivs.forEach(function(div) {
    if (div.querySelector('.slot-line-num')) div.remove();
  });

  // Widen the reels area and push line numbers tight against it
  var reelsContainer = document.getElementById('slotReelsContainer');
  if (reelsContainer) {
    reelsContainer.style.left = '7%';
    reelsContainer.style.width = '86%';
  }

  var st = _slotState;
  var leftLines = [];
  var rightLines = [];
  for (var i = 0; i < lineDir.length; i++) {
    if (lineDir[i] === 1) leftLines.push(i);
    else rightLines.push(i);
  }

  var ballImg = '/static/machine/MatrizCopa2026Nova/item/golden_ball.png';
  var ballSize = 28;

  // Left container - flush against left edge of reels
  var leftDiv = document.createElement('div');
  leftDiv.className = 'mc-line-container';
  leftDiv.style.cssText = 'position:absolute;top:20%;left:0;width:' + (ballSize + 2) + 'px;height:52%;display:flex;flex-direction:column;justify-content:space-around;align-items:center;';
  leftLines.forEach(function(i) {
    var opacity = i < st.activeLines ? '1' : '0.4';
    leftDiv.innerHTML += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:' + ballSize + 'px;height:' + ballSize + 'px;border-radius:50%;background:url(' + ballImg + ') center/cover no-repeat;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:' + ballSize + 'px;cursor:pointer;opacity:' + opacity + ';text-shadow:0 1px 3px rgba(0,0,0,0.9);">' + (i + 1) + '</div>';
  });
  slotSkin.appendChild(leftDiv);

  // Right container - flush against right edge of reels
  var rightDiv = document.createElement('div');
  rightDiv.className = 'mc-line-container';
  rightDiv.style.cssText = 'position:absolute;top:20%;right:0;width:' + (ballSize + 2) + 'px;height:52%;display:flex;flex-direction:column;justify-content:space-around;align-items:center;';
  rightLines.forEach(function(i) {
    var opacity = i < st.activeLines ? '1' : '0.4';
    rightDiv.innerHTML += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:' + ballSize + 'px;height:' + ballSize + 'px;border-radius:50%;background:url(' + ballImg + ') center/cover no-repeat;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:' + ballSize + 'px;cursor:pointer;opacity:' + opacity + ';text-shadow:0 1px 3px rgba(0,0,0,0.9);">' + (i + 1) + '</div>';
  });
  slotSkin.appendChild(rightDiv);
}
