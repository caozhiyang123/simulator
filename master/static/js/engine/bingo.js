// ---------------------------------------------------------------------------
// Bingo Engine
// Core bingo game logic shared by all bingo machines.
// The actual implementation lives in play.js (playRenderGame, playSpin, etc.)
// This file serves as the engine entry point for the registry system.
// Machine plugins can override specific methods via MachineRegistry.
// ---------------------------------------------------------------------------

var BingoEngine = {
  type: 'bingo',

  // Called after login response to render the game
  render: function(resp, machineConfig, machineName) {
    var plugin = MachineRegistry.get(machineName);
    // Allow plugin to override full render
    if (plugin.render) {
      plugin.render(resp, machineConfig, machineName);
    } else {
      playRenderGame(resp, machineConfig);
    }
    // Post-render hook
    if (plugin.afterRender) plugin.afterRender(resp, machineConfig);
  },

  // Called when spin response arrives
  onSpinResponse: function(resp, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onSpinResponse) {
      plugin.onSpinResponse(resp);
    } else {
      playHandleSpinResponse(resp);
    }
  },

  // Called when round over response arrives
  onRoundOver: function(resp, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onRoundOver) {
      plugin.onRoundOver(resp);
    } else {
      playHandleRoundOverResponse(resp);
    }
  },

  // Called on jackpot update
  onJackpotUpdate: function(features, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onJackpotUpdate) {
      plugin.onJackpotUpdate(features);
    } else {
      playUpdateJackpotFromFeatures(features);
    }
  }
};
