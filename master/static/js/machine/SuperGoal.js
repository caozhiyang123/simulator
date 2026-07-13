// ---------------------------------------------------------------------------
// SuperGoal Machine Plugin (Bingo)
// SequancePatternsFeature: same as Pachinko3 but with different letter patterns.
// Letter patterns: S-U-P-E-R-G-O-A-L
// ---------------------------------------------------------------------------
MachineRegistry.register('SuperGoal', {
  type: 'bingo',

  afterRender: function(resp, config) {
    if (resp.letras) {
      sgParseLetras(resp.letras);
    }
    sgGetLetterPatterns(config);
    sgInsertLetterPattern();
    sgHookBetChange();
  },

  onRoundOver: function(resp) {
    playHandleRoundOverResponse(resp);
    if (resp.letra !== undefined) {
      var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
      var betKey = sgBetKey(bet);
      _sgLetras.progressByBet[betKey] = resp.letra;
      sgInsertLetterPattern();
    }
  }
});

// ===========================================================================
// SuperGoal Letras (Letter Sequence) Feature
// ===========================================================================
var _sgLetras = {
  progressByBet: {},
  patterns: []
};

function sgBetKey(bet) {
  var betList = window._playBetList || [];
  for (var i = 0; i < betList.length; i++) {
    if (Math.abs(betList[i] - bet) < 0.0001) return String(i);
  }
  return '0';
}

function sgParseLetras(letrasStr) {
  _sgLetras.progressByBet = {};
  if (!letrasStr) return;
  var parts = letrasStr.split(';');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].trim().split('-');
    if (kv.length === 2) {
      _sgLetras.progressByBet[kv[0].trim()] = parseInt(kv[1].trim()) || 0;
    }
  }
}

function sgGetLetterPatterns(config) {
  _sgLetras.patterns = [];
  if (!config) return;
  var mathModel = (config.math_model && config.math_model[0]) || {};
  var features = (mathModel.features && mathModel.features.lists) || [];
  for (var i = 0; i < features.length; i++) {
    if (features[i].reference && features[i].reference.indexOf('SequancePatternsFeature') >= 0) {
      _sgLetras.patterns = (features[i].config && features[i].config.patterns) || [];
      break;
    }
  }
}

function sgInsertLetterPattern() {
  var old = document.getElementById('sgLetterPatEl');
  if (old) old.remove();

  if (_sgLetras.patterns.length === 0) return;

  var bet = (window._playBetList && window._playBetList[window._playBetIndex]) || 0.01;
  var betKey = sgBetKey(bet);
  var letterIdx = _sgLetras.progressByBet[betKey] || 0;
  if (letterIdx >= _sgLetras.patterns.length) letterIdx = 0;

  var pattern = _sgLetras.patterns[letterIdx];
  if (!pattern) return;

  var cardWidth = 5;
  var fmt = pattern.format || '';
  var numPerCard = fmt.length;

  var allPatGrids = document.querySelectorAll('.play-pat-grid');
  var insertAfterEl = null;

  if (_playCurrentMachine && _playCurrentMachine.config) {
    var mathModel = (_playCurrentMachine.config.math_model && _playCurrentMachine.config.math_model[0]) || {};
    var patterns = mathModel.pattern || [];
    var pGroups = [], pSeen = {};
    patterns.forEach(function(p) {
      var pid = String(p.id);
      if (!pSeen[pid]) { pSeen[pid] = true; pGroups.push(p.id); }
    });
    var targetGroupIdx = -1;
    for (var i = 0; i < pGroups.length; i++) {
      if (pGroups[i] === 7) { targetGroupIdx = i; break; }
    }
    if (targetGroupIdx >= 0) {
      var gridEl = document.querySelector('.play-pat-grid[data-group="' + targetGroupIdx + '"]');
      if (gridEl) insertAfterEl = gridEl.parentElement;
    }
  }

  if (!insertAfterEl) return;

  var el = document.createElement('div');
  el.id = 'sgLetterPatEl';
  el.style.cssText = 'text-align:center;';

  var patId = pattern.id;
  var gridHtml = '<div class="play-pat-grid" data-group="letter" data-pat-id="' + patId + '" style="display:grid;grid-template-columns:repeat(' + cardWidth + ',12px);gap:1px;border:2px solid #f39c12;border-radius:2px;padding:1px;background:#f39c12;cursor:pointer;" onclick="sgSelectLetterPattern(' + patId + ')">';
  for (var i = 0; i < numPerCard; i++) {
    var isReq = i < fmt.length && fmt[i] === '1';
    gridHtml += '<div style="width:12px;height:12px;background:' + (isReq ? '#f39c12' : '#2a2a4e') + ';"></div>';
  }
  gridHtml += '</div>';
  gridHtml += '<div style="font-size:8px;color:#f39c12;margin-top:1px;">' + (pattern.name || pattern.alias) + ' x' + (pattern.value || 0) + '</div>';

  el.innerHTML = gridHtml;
  insertAfterEl.insertAdjacentElement('afterend', el);
}

function sgSelectLetterPattern(patId) {
  if (typeof _bingoSpinTool !== 'undefined' && _bingoSpinTool.enabled) {
    _bingoSpinTool.targetPatternIds = [patId];
    _bingoSpinTool.targetFeatureIds = [];
    _bingoSpinTool.targetBalls = [];
    _bingoSpinTool.mode = null;
    document.querySelectorAll('.play-pat-grid').forEach(function(g) { g.style.outline = ''; });
    var letterGrid = document.querySelector('#sgLetterPatEl .play-pat-grid');
    if (letterGrid) letterGrid.style.outline = '2px solid #f5d742';
    if (typeof bingoSpinToolUpdateStatus === 'function') bingoSpinToolUpdateStatus();
    playLog('📌 [TOOL] Letter pattern selected: id=' + patId);
  }
}

function sgHookBetChange() {
  var origChangeBet = window.playChangeBet;
  if (origChangeBet) {
    window.playChangeBet = function(dir) {
      origChangeBet(dir);
      sgInsertLetterPattern();
    };
  }
}
