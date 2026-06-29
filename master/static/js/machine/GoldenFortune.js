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

    // Override BET and LINE +/- buttons to retro 3D style
    var btns = document.querySelectorAll('#slotSkin .slot-btn-3d');
    btns.forEach(function(btn) {
      btn.className = 'gf-btn-retro';
    });
  }
});
