// ---------------------------------------------------------------------------
// MegaJackpot Machine Plugin (20 cards, perimeter layout)
// Uses bingo engine with custom card layout override.
// ---------------------------------------------------------------------------
MachineRegistry.register('MegaJackpot', {
  type: 'bingo'
  // The perimeter layout (>8 cards) is handled automatically by the bingo engine.
  // Add overrides here for any MegaJackpot-specific features:
  // afterRender: function(resp, config) { /* wild ball UI */ },
  // onFeature: function(featureId, data) { /* wild ball feature */ }
});
