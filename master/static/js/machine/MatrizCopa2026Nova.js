// ---------------------------------------------------------------------------
// MatrizCopa2026Nova Machine Plugin (Slot)
// 3x5 slot, 30 lines. Line direction from config determines left/right placement.
// Line numbers displayed as golden balls flush against the reels.
// ---------------------------------------------------------------------------
MachineRegistry.register('MatrizCopa2026Nova', {
  type: 'slot',

  afterRender: function(resp, config) {
    // Show loading animation first
    matrizCopaShowLoadingAnim(function() {
      // After animation, set up the game
      var extraColors = ['#e53935','#1e88e5','#43a047','#fb8c00','#8e24aa','#00acc1','#d81b60','#ff6d00','#26a69a','#c0ca33'];
      while (SLOT_LINE_COLORS.length < 30) {
        SLOT_LINE_COLORS.push(extraColors[SLOT_LINE_COLORS.length % extraColors.length]);
      }
      var mathModel = (config.math_model && config.math_model[0]) || {};
      var lineDir = mathModel.line_direction || [];
      if (lineDir.length > 0) {
        matrizCopaRebuildLineNumbers(lineDir);
      }
    });
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

/**
 * Show loading animation:
 * 1. Background zooms from far to near
 * 2. loading1.jpg slides from right to center with zoom effect
 * 3. Golden ball rolls from left to center, growing from small to 2x size
 */
function matrizCopaShowLoadingAnim(onComplete) {
  var gameArea = document.getElementById('playGameArea');
  if (!gameArea) { onComplete(); return; }

  var overlay = document.createElement('div');
  overlay.id = 'mcLoadingOverlay';
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:9999;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;';

  overlay.innerHTML =
    '<img id="mcLoadBg" src="/static/machine/MatrizCopa2026Nova/item/loading.PNG" style="position:absolute;width:100%;height:100%;object-fit:cover;transform:scale(1.5);opacity:0;transition:transform 2s ease-out, opacity 0.5s ease-in;">' +
    '<img id="mcLoadScene" src="/static/machine/MatrizCopa2026Nova/item/loading1.png" style="position:absolute;width:80%;max-width:500px;height:auto;object-fit:contain;right:-600px;top:50%;transform:translateY(-50%) scale(1.5);opacity:0;transition:right 1.2s ease-out, transform 1.2s ease-out, opacity 0.3s;">' +
    '<img id="mcLoadBall" src="/static/machine/MatrizCopa2026Nova/item/golden_ball.png" style="position:absolute;width:40px;height:40px;object-fit:contain;left:-60px;top:calc(50% - 20px);opacity:0;transition:none;">' +
    '<div id="mcLoadText" style="position:absolute;left:50%;bottom:-60px;transform:translateX(-50%);opacity:0;transition:bottom 1s ease-out, opacity 0.5s;font-size:42px;font-weight:900;font-style:italic;color:transparent;background:linear-gradient(180deg,#ffd700,#ff8c00,#ffd700);-webkit-background-clip:text;background-clip:text;text-shadow:0 0 10px rgba(255,215,0,0.5);letter-spacing:4px;font-family:Arial Black,sans-serif;">2026</div>';

  gameArea.style.position = 'relative';
  gameArea.appendChild(overlay);

  // Phase 1: Background zoom in (0s)
  setTimeout(function() {
    var bg = document.getElementById('mcLoadBg');
    if (bg) { bg.style.opacity = '1'; bg.style.transform = 'scale(1)'; }
  }, 50);

  // Phase 2: Scene image slides from right to center, zooms near (1.5s)
  setTimeout(function() {
    var scene = document.getElementById('mcLoadScene');
    if (scene) {
      scene.style.opacity = '1';
      scene.style.right = '10%';
      scene.style.transform = 'translateY(-50%) scale(0.5)';
    }
  }, 1500);

  // Phase 3: Ball rolls in, growing from 40px to 80px (4s)
  setTimeout(function() {
    var ball = document.getElementById('mcLoadBall');
    if (ball) {
      ball.style.opacity = '1';
      ball.style.transition = 'left 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 1.5s ease-out, width 1.5s ease-out, height 1.5s ease-out, top 1.5s ease-out';
      ball.style.left = 'calc(50% - 40px)';
      ball.style.top = 'calc(50% - 40px)';
      ball.style.width = '80px';
      ball.style.height = '80px';
      ball.style.transform = 'rotate(720deg)';
    }
  }, 4000);

  // Phase 4: "2026" text rises from bottom to below the ball (5.2s)
  setTimeout(function() {
    var text = document.getElementById('mcLoadText');
    if (text) {
      text.style.opacity = '1';
      text.style.bottom = 'calc(50% - 80px)';
    }
  }, 5200);

  // Phase 5: Fade out and remove (7s)
  setTimeout(function() {
    var ov = document.getElementById('mcLoadingOverlay');
    if (ov) {
      ov.style.transition = 'opacity 0.5s';
      ov.style.opacity = '0';
      setTimeout(function() {
        if (ov.parentNode) ov.remove();
        onComplete();
      }, 500);
    } else {
      onComplete();
    }
  }, 7000);
}
