// ---------------------------------------------------------------------------
// Pachinko3 Machine Plugin
// Uses default bingo engine. Override specific behaviors here.
// ---------------------------------------------------------------------------
MachineRegistry.register('DoubleMania', {
  type: 'bingo'
  // Add overrides here, e.g.:
  // afterRender: function(resp, config) { /* custom UI tweaks */ },
  // onFeature: function(featureId, data) { /* repeat number feature */ }
});
