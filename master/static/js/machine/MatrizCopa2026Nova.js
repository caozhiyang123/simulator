// ---------------------------------------------------------------------------
// MatrizCopa2026Nova Machine Plugin (Slot)
// 3x5 slot, 30 lines. Line direction from config determines left/right placement.
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
 */
function matrizCopaRebuildLineNumbers(lineDir) {
  // Remove existing line number containers
  var existing = document.querySelectorAll('.mc-line-container');
  existing.forEach(function(el) { el.remove(); });

  // Also remove the default line number divs
  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;
  var absDivs = slotSkin.querySelectorAll('div[style*="position:absolute"]');
  absDivs.forEach(function(div) {
    if (div.querySelector('.slot-line-num')) {
      div.remove();
    }
  });

  var st = _slotState;
  var leftLines = [];
  var rightLines = [];
  for (var i = 0; i < lineDir.length; i++) {
    if (lineDir[i] === 1) leftLines.push(i);
    else rightLines.push(i);
  }

  // Create left container
  var leftDiv = document.createElement('div');
  leftDiv.className = 'mc-line-container';
  leftDiv.style.cssText = 'position:absolute;top:26%;left:1%;height:48%;display:flex;flex-direction:column;justify-content:space-between;';
  leftLines.forEach(function(i) {
    var opacity = i < st.activeLines ? '1' : '0.4';
    leftDiv.innerHTML += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:18px;height:12px;border-radius:8px;background:' + SLOT_LINE_COLORS[i] + ';color:#fff;font-size:6px;font-weight:700;text-align:center;line-height:12px;cursor:pointer;opacity:' + opacity + ';">' + (i + 1) + '</div>';
  });
  slotSkin.appendChild(leftDiv);

  // Create right container
  var rightDiv = document.createElement('div');
  rightDiv.className = 'mc-line-container';
  rightDiv.style.cssText = 'position:absolute;top:26%;right:1%;height:48%;display:flex;flex-direction:column;justify-content:space-between;';
  rightLines.forEach(function(i) {
    var opacity = i < st.activeLines ? '1' : '0.4';
    rightDiv.innerHTML += '<div class="slot-line-num" data-line="' + i + '" onclick="slotToggleLine(' + i + ')" style="width:18px;height:12px;border-radius:8px;background:' + SLOT_LINE_COLORS[i] + ';color:#fff;font-size:6px;font-weight:700;text-align:center;line-height:12px;cursor:pointer;opacity:' + opacity + ';">' + (i + 1) + '</div>';
  });
  slotSkin.appendChild(rightDiv);
}
