// ---------------------------------------------------------------------------
// Pachinko3 Machine Plugin (Bingo)
// SequancePatternsFeature: displays current letter pattern in the pattern list.
// Letter pattern inserted after jogovelha (id:7) pattern group.
// ---------------------------------------------------------------------------
MachineRegistry.register('Pachinko3', {
  type: 'bingo',

  afterRender: function(resp, config) {
    // Parse letras progress from login
    if (resp.letras) {
      pachinko3ParseLetras(resp.letras);
    }
    pachinko3GetLetterPatterns(config);
    pachinko3InsertLetterPattern();
    // Hook bet change to update letter
    pachinko3HookBetChange();
  },

  onRoundOver: function(resp) {
    playHandleRoundOverResponse(resp);
    // Update letter progress from round over
    if (resp.letra !== undefined) {
      var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
      var betKey = pachinko3BetKey(bet);
      _p3Letras.progressByBet[betKey] = resp.letra;
      pachinko3InsertLetterPattern();
    }
  }
});

// ===========================================================================
// Pachinko3 Letras (Letter Sequence) Feature
// ===========================================================================
var _p3Letras = {
  progressByBet: {},  // { "0": 2, "1": 0, ... } bet index -> letter index
  patterns: []        // letter patterns from SequancePatternsFeature config
};

function pachinko3BetKey(bet) {
  var betList = window._playBetList || [];
  for (var i = 0; i < betList.length; i++) {
    if (Math.abs(betList[i] - bet) < 0.0001) return String(i);
  }
  return '0';
}

/**
 * Parse "letras" string: "0-2;1-0;" -> {0: 2, 1: 0}
 */
function pachinko3ParseLetras(letrasStr) {
  _p3Letras.progressByBet = {};
  if (!letrasStr) return;
  var parts = letrasStr.split(';');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].trim().split('-');
    if (kv.length === 2) {
      _p3Letras.progressByBet[kv[0].trim()] = parseInt(kv[1].trim()) || 0;
    }
  }
}

/**
 * Get letter patterns from SequancePatternsFeature config.
 */
function pachinko3GetLetterPatterns(config) {
  _p3Letras.patterns = [];
  if (!config) return;
  var mathModel = (config.math_model && config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('SequancePatternsFeature') >= 0) {
      _p3Letras.patterns = (features[i].config && features[i].config.patterns) || [];
      break;
    }
  }
}

/**
 * Insert the current letter pattern into the pattern list, after jogovelha (id:7) group.
 * Also makes it selectable by bingo spin tool.
 */
function pachinko3InsertLetterPattern() {
  // Remove old letter pattern element
  var old = document.getElementById('p3LetterPatEl');
  if (old) old.remove();

  if (_p3Letras.patterns.length === 0) return;

  // Get current letter progress for active bet
  var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
  var betKey = pachinko3BetKey(bet);
  var letterIdx = _p3Letras.progressByBet[betKey] || 0;
  if (letterIdx >= _p3Letras.patterns.length) letterIdx = 0;

  var pattern = _p3Letras.patterns[letterIdx];
  if (!pattern) return;

  var cardWidth = 5;
  var fmt = pattern.format || '';
  var numPerCard = fmt.length;

  // Find the jogovelha pattern group in DOM (pattern id:7)
  // Pattern groups are rendered with data-group attribute, find the one for id:7
  var allPatGrids = document.querySelectorAll('.play-pat-grid');
  var insertAfterEl = null;

  // Find pattern groups by checking stored _playPatGroups or by index
  // jogovelha id:7 — we need to find its group index
  if (_playCurrentMachine && _playCurrentMachine.config) {
    var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
    var patterns = mathModel.pattern || [];
    var pGroups = [], pSeen = {};
    patterns.forEach(function(p) {
      var pid = String(p.id);
      if (!pSeen[pid]) { pSeen[pid] = true; pGroups.push(p.id); }
    });
    // Find group index for id 7
    var targetGroupIdx = -1;
    for (var i = 0; i < pGroups.length; i++) {
      if (pGroups[i] === 7) { targetGroupIdx = i; break; }
    }
    if (targetGroupIdx >= 0) {
      var gridEl = document.querySelector('.play-pat-grid[data-group="' + targetGroupIdx + '"]');
      if (gridEl) insertAfterEl = gridEl.parentElement; // the wrapping div with text-align:center
    }
  }

  if (!insertAfterEl) return;

  // Create letter pattern element (same style as other patterns)
  var el = document.createElement('div');
  el.id = 'p3LetterPatEl';
  el.style.cssText = 'text-align:center;';

  var patId = pattern.id;
  var gridHtml = '<div class="play-pat-grid" data-group="letter" data-pat-id="' + patId + '" style="display:grid;grid-template-columns:repeat(' + cardWidth + ',12px);gap:1px;border:2px solid #f39c12;border-radius:2px;padding:1px;background:#f39c12;cursor:pointer;" onclick="pachinko3SelectLetterPattern(' + patId + ')">';
  for (var i = 0; i < numPerCard; i++) {
    var isReq = i < fmt.length && fmt[i] === '1';
    gridHtml += '<div style="width:12px;height:12px;background:' + (isReq ? '#f39c12' : '#2a2a4e') + ';"></div>';
  }
  gridHtml += '</div>';
  gridHtml += '<div style="font-size:8px;color:#f39c12;margin-top:1px;">' + (pattern.name || pattern.alias) + ' x' + (pattern.value || 0) + '</div>';

  el.innerHTML = gridHtml;
  insertAfterEl.insertAdjacentElement('afterend', el);
}

/**
 * Select letter pattern in bingo spin tool.
 */
function pachinko3SelectLetterPattern(patId) {
  // Only works when tool is enabled
  if (typeof _bingoSpinTool !== 'undefined' && _bingoSpinTool.enabled) {
    _bingoSpinTool.targetPatternIds = [patId];
    _bingoSpinTool.targetFeatureIds = [];
    _bingoSpinTool.targetBalls = [];
    _bingoSpinTool.mode = null;
    // Highlight this pattern, clear others
    document.querySelectorAll('.play-pat-grid').forEach(function(g) { g.style.outline = ''; });
    var letterGrid = document.querySelector('#p3LetterPatEl .play-pat-grid');
    if (letterGrid) letterGrid.style.outline = '2px solid #f5d742';
    if (typeof bingoSpinToolUpdateStatus === 'function') bingoSpinToolUpdateStatus();
    playLog('📌 [TOOL] Letter pattern selected: id=' + patId);
  }
}

/**
 * Hook bet change to update displayed letter pattern.
 */
function pachinko3HookBetChange() {
  var origChangeBet = window.playChangeBet;
  if (origChangeBet) {
    window.playChangeBet = function(dir) {
      origChangeBet(dir);
      pachinko3InsertLetterPattern();
    };
  }
}
