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

    // SPIN button — 3D box with top, front, right faces
    var spinBtn = document.getElementById('slotSpinBtn');
    if (spinBtn) {
      spinBtn.className = 'ba-spin-btn';
      spinBtn.style.top = '57%';
      spinBtn.style.right = '19%';
      spinBtn.style.width = '50px';
      spinBtn.style.height = '30px';
      spinBtn.style.display = 'flex';
      spinBtn.style.alignItems = 'center';
      spinBtn.style.justifyContent = 'center';
      spinBtn.style.position = 'absolute';
      spinBtn.innerHTML = '<div class="ba-face-top"></div><div class="ba-face-front"><span style="font-size:12px;font-weight:900;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.6);letter-spacing:1px;">SPIN</span></div><div class="ba-face-right"></div>';
    }

    // Override BET and LINE +/- buttons to 3D box style
    var btns = document.querySelectorAll('#slotSkin .slot-btn-3d');
    btns.forEach(function(btn) {
      var text = btn.textContent;
      btn.className = 'ba-btn-silver';
      btn.innerHTML = '<div class="ba-face-top"></div><div class="ba-face-front"><span style="color:#fff;font-size:14px;font-weight:800;">' + text + '</span></div><div class="ba-face-right"></div>';
    });

    // COLLECT button
    var collectBtn = document.getElementById('slotCollectBtn');
    if (collectBtn) {
      collectBtn.style.top = '57%';
      collectBtn.style.right = '29%';
      var collectText = collectBtn.textContent;
      collectBtn.className = 'ba-btn-silver';
      collectBtn.innerHTML = '<div class="ba-face-top"></div><div class="ba-face-front"><span style="color:#fff;font-size:9px;font-weight:800;">' + collectText + '</span></div><div class="ba-face-right"></div>';
    }

    // BingoMini card — render to the right of reels
    bingoAmazoniaRenderMiniCard(resp, config);
  }
});

// ---------------------------------------------------------------------------
// BingoAmazonia Mini Card (5x3) with patterns above
// ---------------------------------------------------------------------------
function bingoAmazoniaRenderMiniCard(resp, config) {
  var cardsNumber = resp.cardsNumber || [];
  if (cardsNumber.length === 0) return;

  // Get BingoMiniFeature config
  var mathModel = (config.math_model && config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  var miniConfig = null;
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('BingoMiniFeature') >= 0) {
      miniConfig = features[i].config;
      break;
    }
  }
  if (!miniConfig) return;

  var cardWidth = miniConfig.card_width || 5;
  var cardHeight = miniConfig.card_height || 3;
  var patterns = miniConfig.pattern || [];

  // Remove existing mini card
  var old = document.getElementById('baMiniCardArea');
  if (old) old.remove();

  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;

  // Container positioned to the right of reels (no gap)
  var container = document.createElement('div');
  container.id = 'baMiniCardArea';
  container.style.cssText = 'position:absolute;top:24%;left:59%;width:22%;display:flex;flex-direction:column;gap:0;';

  // Patterns area (compact grid above card)
  var patHtml = '<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:0;padding:2px;background:rgba(0,0,0,0.5);border-radius:3px 3px 0 0;">';
  patterns.forEach(function(p) {
    var fmt = p.format || '';
    patHtml += '<div style="display:grid;grid-template-columns:repeat(' + cardWidth + ',6px);gap:0px;" title="' + p.name + ' x' + p.value + '">';
    for (var i = 0; i < fmt.length; i++) {
      patHtml += '<div style="width:6px;height:4px;background:' + (fmt[i] === '1' ? '#f5d742' : '#333') + ';"></div>';
    }
    patHtml += '</div>';
  });
  patHtml += '</div>';

  // Card area (5x3 grid)
  var cardHtml = '<div style="display:grid;grid-template-columns:repeat(' + cardWidth + ',1fr);gap:1px;background:#1a1a2e;border-radius:0 0 3px 3px;padding:1px;">';
  for (var i = 0; i < cardsNumber.length; i++) {
    var num = cardsNumber[i];
    cardHtml += '<div class="ba-mini-cell" data-idx="' + i + '" data-num="' + num + '" style="background:#f0f0f0;text-align:center;font-size:9px;font-weight:600;color:#333;padding:2px 0;line-height:1.2;">' + (num < 10 ? '0' + num : num) + '</div>';
  }
  cardHtml += '</div>';

  container.innerHTML = patHtml + cardHtml;
  slotSkin.appendChild(container);
}
