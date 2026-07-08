// ---------------------------------------------------------------------------
// LuckyDiamond Machine Plugin (Slot)
// 1x3 classic slot, 10 icons, 1 line.
// Features: ClassicSlotsJackpotFeature — 4 pattern-based jackpot pools.
// ---------------------------------------------------------------------------
MachineRegistry.register('LuckyDiamond', {
  type: 'slot',

  afterRender: function(resp, config) {
    // Parse classic_slot_jackpot from login
    if (resp.classic_slot_jackpot) {
      luckyDiamondParseJackpot(resp.classic_slot_jackpot);
    }
    luckyDiamondRenderJackpotPanel();
    // Hook bet change to recalculate jackpot
    luckyDiamondHookBetChange();
  },

  onSpinResponse: function(resp) {
    slotHandleSpinResponse(resp);
    // Update jackpot pools from spin response
    if (resp.classic_slot_jackpot) {
      luckyDiamondParseJackpot(resp.classic_slot_jackpot);
      luckyDiamondUpdateJackpotDisplay();
      // Check for jackpot win
      var jpWin = luckyDiamondCheckJackpotWin(resp.classic_slot_jackpot);
      if (jpWin > 0) {
        setTimeout(function() { showJackpotCelebration(jpWin); }, 3600);
      }
    }
  },

  onRoundOver: function(resp) {
    slotHandleRoundOverResponse(resp);
    // Update jackpot pools from round over response
    if (resp.classic_slot_jackpot) {
      luckyDiamondParseJackpot(resp.classic_slot_jackpot);
      luckyDiamondUpdateJackpotDisplay();
    }
  }
});

// ===========================================================================
// LuckyDiamond Classic Slot Jackpot (4 pattern-based pools)
// ===========================================================================
var _ldJackpot = {
  pools: {},       // { "i5i1i5": 0.0, "i5i2i5": 0.0, ... }
  minByPattern: {} // { "i5i1i5": 1.01, ... }
};

/**
 * Parse classic_slot_jackpot data from response.
 */
function luckyDiamondParseJackpot(data) {
  if (!data || !data.length) return;
  try {
    var parsed = JSON.parse(data[0]);
    if (parsed.jackpot && parsed.jackpot[0]) {
      var jp = parsed.jackpot[0];
      // Parse jackpot_per_pattern (current pool values)
      if (jp.jackpot_per_pattern) {
        _ldJackpot.pools = jp.jackpot_per_pattern;
      }
      // Parse min_jackpot_by_pattern (min multipliers, only from login)
      if (jp.min_jackpot_by_pattern) {
        // Format: "{i5i1i5=1.01, i5i2i5=1.01, ...}" — parse this Java map string
        var minStr = jp.min_jackpot_by_pattern;
        minStr = minStr.replace(/[{}]/g, '').trim();
        var parts = minStr.split(',');
        for (var i = 0; i < parts.length; i++) {
          var kv = parts[i].trim().split('=');
          if (kv.length === 2) {
            _ldJackpot.minByPattern[kv[0].trim()] = parseFloat(kv[1].trim()) || 0;
          }
        }
      }
    }
  } catch(e) {
    playLog('⚠ [LD JACKPOT] parse error: ' + e.message);
  }
}

/**
 * Calculate jackpot display value for a pattern.
 * Value = pool + bet * min_multiplier, rounded UP to 2 decimals.
 */
function luckyDiamondCalcPool(pattern) {
  var pool = _ldJackpot.pools[pattern] || 0;
  var minMulti = _ldJackpot.minByPattern[pattern] || 0;
  var bet = (_slotState.betList && _slotState.betList[_slotState.betIndex]) || 0.01;
  var value = pool + bet * minMulti;
  // Standard rounding to 2 decimal places
  return Math.round(value * 100) / 100;
}

/**
 * Render the 4 jackpot pools panel with pattern icons.
 */
function luckyDiamondRenderJackpotPanel() {
  var old = document.getElementById('ldJackpotPanel');
  if (old) old.remove();

  var slotSkin = document.getElementById('slotSkin');
  if (!slotSkin) return;

  var panel = document.createElement('div');
  panel.id = 'ldJackpotPanel';
  panel.style.cssText = 'position:absolute;top:6%;left:5%;width:90%;display:flex;gap:6px;justify-content:center;z-index:5;';

  var patterns = Object.keys(_ldJackpot.pools);
  if (patterns.length === 0) patterns = Object.keys(_ldJackpot.minByPattern);

  var colors = ['#e74c3c', '#f39c12', '#3498db', '#9b59b6'];
  var mn = _slotState.machineName || 'LuckyDiamond';

  patterns.forEach(function(pat, idx) {
    var val = luckyDiamondCalcPool(pat);
    var color = colors[idx % colors.length];
    // Parse pattern to get icon ids (e.g. "i5i1i5" -> [5, 1, 5])
    var iconIds = [];
    var regex = /i(\d+)/g;
    var match;
    while ((match = regex.exec(pat)) !== null) { iconIds.push(match[1]); }

    var iconsHtml = '';
    iconIds.forEach(function(id) {
      iconsHtml += '<img src="/static/machine/' + mn + '/icon/i' + id + '.png" style="width:14px;height:14px;object-fit:contain;" onerror="this.outerHTML=\'<span style=font-size:8px;color:#fff>i' + id + '</span>\'">';
    });

    panel.innerHTML += '<div style="flex:1;background:' + color + ';border-radius:6px;padding:4px 6px;text-align:center;border:1px solid rgba(255,255,255,0.3);">' +
      '<div style="display:flex;gap:2px;justify-content:center;align-items:center;margin-bottom:2px;">' + iconsHtml + '</div>' +
      '<div class="ld-jp-val" data-pat="' + pat + '" style="font-size:12px;font-weight:700;color:#fff;">' + val.toFixed(2) + '</div>' +
      '</div>';
  });

  slotSkin.appendChild(panel);
}

/**
 * Hook bet change to recalculate jackpot display.
 */
function luckyDiamondHookBetChange() {
  var origBet = window.slotChangeBet;
  window.slotChangeBet = function(dir) {
    origBet(dir);
    luckyDiamondUpdateJackpotDisplay();
  };
}

/**
 * Update jackpot display values (after spin/round over).
 */
function luckyDiamondUpdateJackpotDisplay() {
  var els = document.querySelectorAll('.ld-jp-val');
  els.forEach(function(el) {
    var pat = el.getAttribute('data-pat');
    if (pat) {
      var val = luckyDiamondCalcPool(pat);
      el.textContent = val.toFixed(2);
    }
  });
}

/**
 * Check if classic_slot_jackpot response contains a jackpot_win > 0.
 */
function luckyDiamondCheckJackpotWin(data) {
  if (!data || !data.length) return 0;
  try {
    var parsed = JSON.parse(data[0]);
    if (parsed.jackpot && parsed.jackpot[0]) {
      var win = parsed.jackpot[0].jackpot_win || 0;
      if (win > 0) return win;
    }
  } catch(e) {}
  return 0;
}
