// ---------------------------------------------------------------------------
// Machine Registry - maps machine names to their plugin overrides
// ---------------------------------------------------------------------------
var MachineRegistry = {
  _machines: {},

  register: function(name, plugin) {
    this._machines[name] = plugin;
  },

  get: function(name) {
    return this._machines[name] || {};
  },

  has: function(name) {
    return !!this._machines[name];
  }
};
