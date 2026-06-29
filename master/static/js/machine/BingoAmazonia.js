// ---------------------------------------------------------------------------
// BingoAmazonia Machine Plugin (Slot)
// 3x5 slot, 9 icons, 20 lines.
// Features: BingoMiniFeature (mini bingo game triggered by scatter icons)
// Custom background (.jpg) and pattern path.
// ---------------------------------------------------------------------------
MachineRegistry.register('BingoAmazonia', {
  type: 'slot',

  assets: {
    background: '/static/machine/BingoAmazonia/background/BingoAmazonia.jpg',
    pattern: '/static/machine/BingoAmazonia/pattern/BingoAmazonia.PNG',
    icons: '/static/machine/BingoAmazonia/icon/'
  },

  afterRender: function(resp, config) {
    // Balance display — reposition
    var balEl = document.getElementById('slotBalance');
    if (balEl) {
      balEl.style.top = '14%';
      balEl.style.left = '15%';
      balEl.style.width = '35%';
      balEl.style.fontSize = '13px';
    }

    // Jackpot display — reposition
    var jpEl = document.getElementById('slotJackpotDisplay');
    if (jpEl) {
      jpEl.style.top = '14%';
      jpEl.style.right = '15%';
      jpEl.style.width = '35%';
      jpEl.style.fontSize = '13px';
    }

    // Reels container — adjust position, size, and remove gaps
    var reelsEl = document.getElementById('slotReelsContainer');
    if (reelsEl) {
      reelsEl.style.top = '24%';
      reelsEl.style.left = '24%';
      reelsEl.style.width = '35%';
      reelsEl.style.height = '22%';
      reelsEl.style.gap = '0';
    }
    // Remove gap between individual reel wrappers
    var reelWrappers = document.querySelectorAll('#slotReelsContainer .slot-reel-wrapper');
    reelWrappers.forEach(function(w) {
      w.style.marginLeft = '0';
      w.style.marginRight = '0';
      w.style.borderRadius = '0';
    });

    // BET controls — bottom left
    var allDivs = document.querySelectorAll('#slotSkin > div');
    allDivs.forEach(function(div) {
      var s = div.getAttribute('style') || '';
      if (s.indexOf('top:80.5%') >= 0 && s.indexOf('left:7%') >= 0) {
        div.style.top = '55%';
        div.style.left = '19%';
      }
      if (s.indexOf('top:80.5%') >= 0 && s.indexOf('left:38%') >= 0) {
        div.style.top = '60%';
        div.style.left = '19%';
      }
    });

    // SPIN button — bottom right, square
    var spinBtn = document.getElementById('slotSpinBtn');
    if (spinBtn) {
      spinBtn.className = 'ba-spin-btn';
      spinBtn.style.top = '57%';
      spinBtn.style.right = '19%';
      spinBtn.style.width = '50px';
      spinBtn.style.height = '30px';
      spinBtn.style.display = 'flex';
      spinBtn.style.flexDirection = 'column';
      spinBtn.style.alignItems = 'center';
      spinBtn.style.justifyContent = 'center';
      spinBtn.style.position = 'absolute';
      spinBtn.innerHTML = '<span style="font-size:14px;font-weight:900;color:#333;text-shadow:0 1px 0 rgba(156, 29, 20, 0.59);letter-spacing:1px;z-index:1;">SPIN</span>';
    }

    // Override BET and LINE +/- buttons to silver style
    var btns = document.querySelectorAll('#slotSkin .slot-btn-3d');
    btns.forEach(function(btn) {
      btn.className = 'ba-btn-silver';
    });

    // COLLECT button
    var collectBtn = document.getElementById('slotCollectBtn');
    if (collectBtn) {
      collectBtn.style.top = '57%';
      collectBtn.style.right = '29%';
      collectBtn.className = 'ba-btn-silver';
    }
  }
});
