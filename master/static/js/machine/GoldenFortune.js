// ---------------------------------------------------------------------------
// GoldenFortune Machine Plugin (Slot)
// 2x3 slot with features: MultiPrizeLineFeature, FreeSpinFeature, BonusFeature
// Custom background (.jpg), pattern path, and control positions.
// ---------------------------------------------------------------------------
MachineRegistry.register('GoldenFortune', {
  type: 'slot',

  // Custom assets paths
  assets: {
    background: '/static/machine/GoldenFortune/background/GoldenFortune.jpg',
    pattern: '/static/machine/GoldenFortune/pattern/GoldenFortune.PNG',
    icons: '/static/machine/GoldenFortune/icon/'
  },

  afterRender: function(resp, config) {
    // Reposition controls to match GoldenFortune background layout
    // GoldenFortune is a 2x3 slot - controls need different positions than the default Olympus skin

    // Balance display - move to lower-left area
    var balEl = document.getElementById('slotBalance');
    if (balEl) {
      balEl.style.top = '18%';
      balEl.style.left = '25%';
      balEl.style.width = '40%';
      balEl.style.height = '4%';
      balEl.style.fontSize = '14px';
    }

    // Jackpot display - move to upper-right area
    var jpEl = document.getElementById('slotJackpotDisplay');
    if (jpEl) {
      jpEl.style.top = '23%';
      jpEl.style.right = '25%';
      jpEl.style.width = '40%';
      jpEl.style.height = '4%';
      jpEl.style.fontSize = '14px';
    }

    // Reels container - adjust for 2-row layout (shorter height)
    var reelsEl = document.getElementById('slotReelsContainer');
    if (reelsEl) {
      reelsEl.style.top = '22%';
      reelsEl.style.left = '12%';
      reelsEl.style.width = '76%';
      reelsEl.style.height = '46%';
    }

    // Win display - center over reels
    var winEl = document.getElementById('slotWinDisplay');
    if (winEl) {
      winEl.style.top = '40%';
      winEl.style.left = '12%';
      winEl.style.width = '76%';
    }

    // BET controls - bottom left
    var betControls = balEl && balEl.parentElement.querySelector('[style*="top:80.5%"][style*="left:7%"]');
    // Use direct DOM query for bet controls area
    var allDivs = document.querySelectorAll('#slotSkin > div');
    allDivs.forEach(function(div) {
      var s = div.getAttribute('style') || '';
      // BET controls
      if (s.indexOf('top:80.5%') >= 0 && s.indexOf('left:7%') >= 0) {
        div.style.top = '67%';
        div.style.left = '16%';
      }
      // LINES controls
      if (s.indexOf('top:80.5%') >= 0 && s.indexOf('left:38%') >= 0) {
        div.style.top = '70%';
        div.style.left = '16%';
      }
    });

    // COLLECT button
    var collectBtn = document.getElementById('slotCollectBtn');
    if (collectBtn) {
      collectBtn.style.top = '68%';
      collectBtn.style.right = '32%';
      collectBtn.className = 'gf-btn-retro';
    }

    // SPIN button - retro 3D rectangular
    var spinBtn = document.getElementById('slotSpinBtn');
    if (spinBtn) {
      spinBtn.style.top = '68%';
      spinBtn.style.right = '18%';
      spinBtn.style.width = '80px';
      spinBtn.style.height = '44px';
      spinBtn.className = 'gf-spin-retro';
      spinBtn.style.display = 'flex';
      spinBtn.style.flexDirection = 'column';
      spinBtn.style.alignItems = 'center';
      spinBtn.style.justifyContent = 'center';
      spinBtn.style.position = 'absolute';
      spinBtn.innerHTML = '<span style="font-size:14px;font-weight:900;color:#fff;text-shadow:0 -1px 0 #333,0 1px 0 #000,1px 0 0 #000,-1px 0 0 #000;letter-spacing:2px;z-index:1;">SPIN</span>';
    }

    // Win label - align horizontally with BET
    var winLabel = document.getElementById('slotWinLabel');
    if (winLabel) {
      winLabel.style.top = '67%';
      winLabel.style.left = '45%';
    }

    // Override BET and LINE +/- buttons to retro 3D style
    var btns = document.querySelectorAll('#slotSkin .slot-btn-3d');
    btns.forEach(function(btn) {
      btn.className = 'gf-btn-retro';
    });
  },

  onSpinResponse: function(resp) {
    // Default handling first
    slotHandleSpinResponse(resp);
    // After reels stop, adjust display and redraw win lines to match icon positions
    setTimeout(function() {
      goldenFortuneAdjustReelDisplay();
      // Redraw win lines aligned to actual icon positions
      goldenFortuneRedrawWinLines(resp);
    }, 3500);
  }
});

// ---------------------------------------------------------------------------
// GoldenFortune: Adjust reel display after spin stops.
// For columns with only 1 non-zero icon: center it with half-icons above/below.
// For columns with all non-zero icons: ensure proper display (fix strip structure).
// ---------------------------------------------------------------------------
function goldenFortuneAdjustReelDisplay() {
  var st = _slotState;
  if (!st || !st.reelIcons) return;

  var rowCount = st.rowCount || 2;
  var colCount = st.colCount || 3;
  var allIcons = st.icons || [0,1,2,3,4,5,6];
  var cellHeight = 80;

  for (var col = 0; col < colCount; col++) {
    var wrapper = document.querySelector('#slotReelsContainer .slot-reel-wrapper[data-col="' + col + '"]');
    if (!wrapper) continue;

    // Collect icons for this column
    var colIcons = [];
    var nonZeroCount = 0;
    for (var row = 0; row < rowCount; row++) {
      var idx = row * colCount + col;
      var iconId = st.reelIcons[idx];
      colIcons.push(iconId);
      if (iconId > 0) nonZeroCount++;
    }

    var strip = wrapper.querySelector('.slot-reel-strip');
    if (!strip) continue;

    if (nonZeroCount === 1) {
      // Single non-zero icon: center it with half-icons above/below
      var mainIcon = 0;
      for (var r = 0; r < rowCount; r++) { if (colIcons[r] > 0) { mainIcon = colIcons[r]; break; } }
      var randTop = allIcons[Math.floor(Math.random() * allIcons.length)];
      var randBottom = allIcons[Math.floor(Math.random() * allIcons.length)];
      if (randTop === 0) randTop = 1;
      if (randBottom === 0) randBottom = 1;

      var totalHeight = rowCount * cellHeight;
      var halfSize = cellHeight / 2;

      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      strip.innerHTML =
        '<div style="width:100%;height:' + halfSize + 'px;overflow:hidden;display:flex;align-items:flex-end;justify-content:center;">' +
          '<img src="/static/machine/' + st.machineName + '/icon/i' + randTop + '.png" style="width:100%;height:' + cellHeight + 'px;object-fit:fill;opacity:0.4;">' +
        '</div>' +
        '<div style="width:100%;height:' + cellHeight + 'px;display:flex;align-items:center;justify-content:center;">' +
          '<img src="/static/machine/' + st.machineName + '/icon/i' + mainIcon + '.png" style="width:100%;height:100%;object-fit:fill;">' +
        '</div>' +
        '<div style="width:100%;height:' + halfSize + 'px;overflow:hidden;display:flex;align-items:flex-start;justify-content:center;">' +
          '<img src="/static/machine/' + st.machineName + '/icon/i' + randBottom + '.png" style="width:100%;height:' + cellHeight + 'px;object-fit:fill;opacity:0.4;">' +
        '</div>';
    } else {
      // Multiple non-zero icons: rebuild strip with proper icons showing
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      var html = '';
      for (var r = 0; r < rowCount; r++) {
        var iconId = colIcons[r];
        html += '<div style="width:100%;height:' + cellHeight + 'px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
        html += '<img src="/static/machine/' + st.machineName + '/icon/i' + iconId + '.png" style="width:100%;height:100%;object-fit:fill;">';
        html += '</div>';
      }
      strip.innerHTML = html;
    }
  }
}

// ---------------------------------------------------------------------------
// GoldenFortune: Redraw win lines to match actual icon positions after adjustment.
// The SVG uses the strip's actual rendered height, not the container's full height.
// ---------------------------------------------------------------------------
function goldenFortuneRedrawWinLines(resp) {
  if (!resp.total_won || resp.total_won <= 0) return;

  var st = _slotState;
  var svg = document.getElementById('slotLineSvg');
  var container = document.getElementById('slotReelsContainer');
  if (!svg || !container) return;

  // Clear existing lines
  svg.innerHTML = '';

  // Calculate actual icon area dimensions
  var cellHeight = 80;
  var rowCount = st.rowCount || 2;
  var colCount = st.colCount || 3;
  var containerW = container.offsetWidth;
  var containerH = container.offsetHeight;
  var colW = containerW / colCount;

  // Actual strip height = rowCount * cellHeight, centered in container
  var stripH = rowCount * cellHeight;
  var offsetY = (containerH - stripH) / 2; // vertical offset to center
  if (offsetY < 0) offsetY = 0;
  var rowH = cellHeight;

  // Parse won_pattern for winning lines
  var wonPattern = resp.won_pattern || '';
  var wonLines = [];
  var matches = wonPattern.match(/l(\d+)/g);
  if (matches) {
    for (var i = 0; i < matches.length; i++) {
      var lineNum = parseInt(matches[i].substring(1)) - 1;
      if (lineNum >= 0 && wonLines.indexOf(lineNum) < 0) wonLines.push(lineNum);
    }
  }
  if (wonLines.length === 0) return;

  // Draw each winning line
  for (var li = 0; li < wonLines.length; li++) {
    var lineIdx = wonLines[li];
    if (lineIdx >= st.lines.length) continue;
    var line = st.lines[lineIdx];
    var points = [];
    for (var i = 0; i < line.length; i++) {
      var pos = line[i];
      var col = pos % colCount;
      var row = Math.floor(pos / colCount);
      var cx = col * colW + colW / 2;
      var cy = offsetY + row * rowH + rowH / 2;
      points.push(cx + ',' + cy);
    }
    var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points.join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', SLOT_LINE_COLORS[lineIdx] || '#fff');
    polyline.setAttribute('stroke-width', '3');
    polyline.setAttribute('stroke-opacity', '0.9');
    polyline.setAttribute('data-line', lineIdx);
    svg.appendChild(polyline);
  }
}
