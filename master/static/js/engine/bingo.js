// ---------------------------------------------------------------------------
// Bingo Engine
// Core bingo game logic shared by all bingo machines.
// The actual implementation lives in play.js (playRenderGame, playSpin, etc.)
// This file serves as the engine entry point for the registry system.
// Machine plugins can override specific methods via MachineRegistry.
// ---------------------------------------------------------------------------

var BingoEngine = {
  type: 'bingo',

  render: function(resp, machineConfig, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.render) {
      plugin.render(resp, machineConfig, machineName);
    } else {
      playRenderGame(resp, machineConfig);
    }
    if (plugin.afterRender) plugin.afterRender(resp, machineConfig);
    // Render spin tool for admin/qa
    bingoSpinToolInit(resp, machineConfig);
  },

  onSpinResponse: function(resp, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onSpinResponse) plugin.onSpinResponse(resp);
    else playHandleSpinResponse(resp);
  },

  onRoundOver: function(resp, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onRoundOver) plugin.onRoundOver(resp);
    else playHandleRoundOverResponse(resp);
  },

  onJackpotUpdate: function(features, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onJackpotUpdate) plugin.onJackpotUpdate(features);
    else playUpdateJackpotFromFeatures(features);
  }
};

// ---------------------------------------------------------------------------
// Bingo Spin Tool (admin/qa only)
// ---------------------------------------------------------------------------
var _bingoSpinTool = {
  enabled: false,
  targetPatternIds: [],
  targetFeatureIds: [],
  targetBalls: [],
  baseBallCount: 0,
  ebBallCount: 0,
  mode: null // 'pattern' | 'feature' | 'balls'
};

function bingoSpinToolInit(resp, machineConfig) {
  var role = resp.role || '';
  if (role !== 'admin' && role !== 'qa') return;
  _bingoSpinTool.enabled = true;
  _bingoSpinTool.targetPatternIds = [];
  _bingoSpinTool.targetFeatureIds = [];
  _bingoSpinTool.targetBalls = [];
  _bingoSpinTool.mode = null;

  var mathModel = (machineConfig.math_model && machineConfig.math_model[0]) || {};
  _bingoSpinTool.baseBallCount = mathModel.base_ball_count || 30;
  _bingoSpinTool.ebBallCount = mathModel.eb_ball_count || 10;
  _bingoSpinTool.features = (mathModel.features && mathModel.features.lists) || [];
  _bingoSpinTool.patterns = mathModel.pattern || [];

  bingoSpinToolRender();
}

function bingoSpinToolRender() {
  // Remove existing
  var old = document.getElementById('bingoSpinTool');
  if (old) old.remove();

  var gameArea = document.getElementById('playGameArea');
  if (!gameArea) return;

  var panel = document.createElement('div');
  panel.id = 'bingoSpinTool';
  panel.style.cssText = 'position:absolute;top:280px;left:0;z-index:200;';

  // Collapsed tab
  panel.innerHTML = '<div id="bingoSpinToolTab" onclick="bingoSpinToolToggle()" style="background:#1a1a2e;border:1px solid #f5d742;border-left:none;border-radius:0 8px 8px 0;padding:8px 6px;cursor:pointer;color:#f5d742;font-size:10px;font-weight:700;writing-mode:vertical-rl;text-orientation:mixed;">🔧 TOOL</div>' +
    '<div id="bingoSpinToolPanel" style="display:none;position:absolute;top:0;left:30px;background:#1a1a2e;border:1px solid #f5d742;border-radius:0 8px 8px 0;padding:12px;width:200px;max-height:400px;overflow-y:auto;">' +
    '<div style="color:#fff;font-size:11px;font-weight:700;margin-bottom:8px;">🔧 Spin Tool</div>' +
    '<div id="bstItemPattern" class="bst-item" onclick="bingoSpinToolChoosePattern()" style="padding:6px 8px;margin-bottom:4px;background:#2a2a4e;border-radius:4px;cursor:pointer;color:#ccc;font-size:10px;">📌 Choose Pattern</div>' +
    '<div id="bstItemFeature" class="bst-item" onclick="bingoSpinToolChooseFeature()" style="padding:6px 8px;margin-bottom:4px;background:#2a2a4e;border-radius:4px;cursor:pointer;color:#ccc;font-size:10px;">⚡ Choose Feature</div>' +
    '<div id="bstFeatureList" style="display:none;padding-left:8px;"></div>' +
    '<div id="bstItemBalls" class="bst-item" onclick="bingoSpinToolChooseBalls()" style="padding:6px 8px;margin-bottom:4px;background:#2a2a4e;border-radius:4px;cursor:pointer;color:#ccc;font-size:10px;">🎱 Choose Balls</div>' +
    '<div id="bstStatus" style="margin-top:8px;font-size:9px;color:#888;border-top:1px solid #333;padding-top:6px;"></div>' +
    '<div onclick="bingoSpinToolClear()" style="margin-top:6px;padding:4px 8px;background:#e74c3c;border-radius:4px;cursor:pointer;color:#fff;font-size:9px;text-align:center;">Clear All</div>' +
    '</div>';

  gameArea.style.position = 'relative';
  gameArea.appendChild(panel);
  bingoSpinToolUpdateStatus();
}

function bingoSpinToolToggle() {
  var panel = document.getElementById('bingoSpinToolPanel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function bingoSpinToolChoosePattern() {
  // Mutual exclusion: clear other selections
  _bingoSpinTool.targetFeatureIds = [];
  _bingoSpinTool.targetBalls = [];
  document.querySelectorAll('.play-card-cell').forEach(function(c) { c.style.outline = ''; c.style.cursor = ''; });
  var listEl = document.getElementById('bstFeatureList');
  if (listEl) listEl.style.display = 'none';

  _bingoSpinTool.mode = 'pattern';
  bingoSpinToolUpdateStatus();
  // Scroll to pattern area and enable click on pattern grids
  var patArea = document.querySelector('#playGameArea [style*="252540"]');
  if (patArea) patArea.scrollIntoView({behavior: 'smooth'});
  // Add click listeners to pattern grids
  document.querySelectorAll('.play-pat-grid').forEach(function(grid) {
    grid.style.cursor = 'pointer';
    grid.onclick = function() {
      var groupIdx = parseInt(grid.getAttribute('data-group'));
      if (isNaN(groupIdx)) return;
      // Get pattern ID from the group
      var patterns = _bingoSpinTool.patterns;
      var pGroups = [], pSeen = {};
      patterns.forEach(function(p) {
        var pid = String(p.id);
        if (!pSeen[pid]) { pSeen[pid] = []; pGroups.push({id: p.id, patterns: pSeen[pid]}); }
        pSeen[pid].push(p);
      });
      if (groupIdx < pGroups.length) {
        var patId = pGroups[groupIdx].id;
        _bingoSpinTool.targetPatternIds = [patId];
        _bingoSpinTool.mode = null;
        // Highlight selected
        document.querySelectorAll('.play-pat-grid').forEach(function(g) { g.style.outline = ''; });
        grid.style.outline = '2px solid #f5d742';
        bingoSpinToolUpdateStatus();
      }
    };
  });
}

function bingoSpinToolChooseFeature() {
  // Mutual exclusion: clear other selections
  _bingoSpinTool.targetPatternIds = [];
  _bingoSpinTool.targetBalls = [];
  document.querySelectorAll('.play-pat-grid').forEach(function(g) { g.style.outline = ''; });
  document.querySelectorAll('.play-card-cell').forEach(function(c) { c.style.outline = ''; c.style.cursor = ''; });

  var listEl = document.getElementById('bstFeatureList');
  if (!listEl) return;
  if (listEl.style.display !== 'none') { listEl.style.display = 'none'; return; }
  // Build feature list (filter out SynchronizedMachineStatusFeature)
  var features = _bingoSpinTool.features;
  var html = '';
  features.forEach(function(f) {
    var ref = f.reference || '';
    if (ref.indexOf('SynchronizedMachineStatusFeature') >= 0) return;
    var name = ref.split('.').pop();
    var fid = f.config && f.config.feature_id;
    var selected = _bingoSpinTool.targetFeatureIds.indexOf(fid) >= 0;
    html += '<div onclick="bingoSpinToolSelectFeature(' + fid + ',this)" style="padding:4px 6px;margin:2px 0;background:' + (selected ? '#f5d742' : '#333') + ';color:' + (selected ? '#000' : '#ccc') + ';border-radius:3px;cursor:pointer;font-size:9px;">' + name + ' (id:' + fid + ')</div>';
  });
  listEl.innerHTML = html;
  listEl.style.display = '';
}

function bingoSpinToolSelectFeature(fid, el) {
  // Mutual exclusion: clear other selections
  _bingoSpinTool.targetPatternIds = [];
  _bingoSpinTool.targetBalls = [];
  document.querySelectorAll('.play-pat-grid').forEach(function(g) { g.style.outline = ''; });
  document.querySelectorAll('.play-card-cell').forEach(function(c) { c.style.outline = ''; c.style.cursor = ''; });

  _bingoSpinTool.targetFeatureIds = [fid];
  // Update all sibling styles
  var siblings = el.parentElement.children;
  for (var i = 0; i < siblings.length; i++) {
    siblings[i].style.background = '#333';
    siblings[i].style.color = '#ccc';
  }
  el.style.background = '#f5d742';
  el.style.color = '#000';
  bingoSpinToolUpdateStatus();
}

function bingoSpinToolChooseBalls() {
  // Mutual exclusion: clear other selections
  _bingoSpinTool.targetPatternIds = [];
  _bingoSpinTool.targetFeatureIds = [];
  document.querySelectorAll('.play-pat-grid').forEach(function(g) { g.style.outline = ''; });
  var listEl = document.getElementById('bstFeatureList');
  if (listEl) listEl.style.display = 'none';

  _bingoSpinTool.mode = 'balls';
  _bingoSpinTool.targetBalls = [];
  bingoSpinToolUpdateStatus();
  // Enable click on card cells
  document.querySelectorAll('.play-card-cell').forEach(function(cell) {
    cell.style.cursor = 'crosshair';
    cell.onclick = function() {
      if (_bingoSpinTool.mode !== 'balls') return;
      var num = parseInt(cell.getAttribute('data-num'));
      if (num === 0 || isNaN(num)) return; // skip free cells
      var idx = _bingoSpinTool.targetBalls.indexOf(num);
      if (idx >= 0) {
        // Deselect
        _bingoSpinTool.targetBalls.splice(idx, 1);
        cell.style.outline = '';
      } else {
        // Select (no duplicates)
        _bingoSpinTool.targetBalls.push(num);
        cell.style.outline = '2px solid #27ae60';
      }
      bingoSpinToolUpdateStatus();
    };
  });
}

function bingoSpinToolClear() {
  _bingoSpinTool.targetPatternIds = [];
  _bingoSpinTool.targetFeatureIds = [];
  _bingoSpinTool.targetBalls = [];
  _bingoSpinTool.mode = null;
  // Clear visual selections
  document.querySelectorAll('.play-pat-grid').forEach(function(g) { g.style.outline = ''; });
  document.querySelectorAll('.play-card-cell').forEach(function(c) { c.style.outline = ''; c.style.cursor = ''; });
  var listEl = document.getElementById('bstFeatureList');
  if (listEl) listEl.style.display = 'none';
  bingoSpinToolUpdateStatus();
}

function bingoSpinToolUpdateStatus() {
  var st = _bingoSpinTool;
  var el = document.getElementById('bstStatus');
  if (!el) return;
  var lines = [];
  if (st.targetPatternIds.length) lines.push('Pattern: [' + st.targetPatternIds.join(',') + ']');
  if (st.targetFeatureIds.length) lines.push('Feature: [' + st.targetFeatureIds.join(',') + ']');
  if (st.targetBalls.length) {
    var valid = st.targetBalls.length === st.baseBallCount || st.targetBalls.length === (st.baseBallCount + st.ebBallCount);
    lines.push('Balls: ' + st.targetBalls.length + '/' + st.baseBallCount + (valid ? ' ✅' : ' (need ' + st.baseBallCount + ' or ' + (st.baseBallCount + st.ebBallCount) + ')'));
  }
  if (st.mode) lines.push('Mode: ' + st.mode + ' (selecting...)');
  el.innerHTML = lines.length ? lines.join('<br>') : '<span style="color:#666;">No tool active</span>';

  // Update menu item selected states
  var patEl = document.getElementById('bstItemPattern');
  var featEl = document.getElementById('bstItemFeature');
  var ballEl = document.getElementById('bstItemBalls');
  if (patEl) {
    patEl.style.background = st.targetPatternIds.length ? '#f5d742' : '#2a2a4e';
    patEl.style.color = st.targetPatternIds.length ? '#000' : '#ccc';
  }
  if (featEl) {
    featEl.style.background = st.targetFeatureIds.length ? '#f5d742' : '#2a2a4e';
    featEl.style.color = st.targetFeatureIds.length ? '#000' : '#ccc';
  }
  if (ballEl) {
    var hasValidBalls = st.targetBalls.length === st.baseBallCount || st.targetBalls.length === (st.baseBallCount + st.ebBallCount);
    ballEl.style.background = hasValidBalls ? '#f5d742' : (st.targetBalls.length > 0 ? '#4a4a2e' : '#2a2a4e');
    ballEl.style.color = hasValidBalls ? '#000' : (st.targetBalls.length > 0 ? '#f5d742' : '#ccc');
  }
}

// Get spin tool overrides for the spin command
function bingoSpinToolGetOverrides() {
  var st = _bingoSpinTool;
  if (!st.enabled) return {targetPatternIds: [], targetFeatureIds: [], balls: []};
  var balls = [];
  if (st.targetBalls.length === st.baseBallCount || st.targetBalls.length === (st.baseBallCount + st.ebBallCount)) {
    balls = st.targetBalls.slice();
  }
  return {
    targetPatternIds: st.targetPatternIds.slice(),
    targetFeatureIds: st.targetFeatureIds.slice(),
    balls: balls
  };
}
