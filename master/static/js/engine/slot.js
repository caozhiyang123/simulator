// ---------------------------------------------------------------------------
// Slot Engine
// Core slot game logic shared by all slot machines.
// The actual implementation lives in static/js/slot.js (slotRenderGame, etc.)
// This file serves as the engine entry point for the registry system.
// Machine plugins can override specific methods via MachineRegistry.
// ---------------------------------------------------------------------------

var SlotEngine = {
  type: 'slot',

  // Called after login response to render the game
  render: function(resp, machineConfig, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.render) {
      plugin.render(resp, machineConfig, machineName);
    } else {
      _slotState.machineId = _playCurrentMachine.machine_id;
      slotRenderGame(resp, machineConfig, machineName);
    }
    if (plugin.afterRender) plugin.afterRender(resp, machineConfig);
  },

  // Called when spin response arrives
  onSpinResponse: function(resp, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onSpinResponse) {
      plugin.onSpinResponse(resp);
    } else {
      slotHandleSpinResponse(resp);
    }
  },

  // Called when round over response arrives
  onRoundOver: function(resp, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onRoundOver) {
      plugin.onRoundOver(resp);
    } else {
      slotHandleRoundOverResponse(resp);
    }
  },

  // Called on jackpot update
  onJackpotUpdate: function(features, machineName) {
    var plugin = MachineRegistry.get(machineName);
    if (plugin.onJackpotUpdate) {
      plugin.onJackpotUpdate(features);
    } else {
      slotUpdateJackpotFromFeatures(features);
    }
  }
};
