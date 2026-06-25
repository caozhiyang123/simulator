// ---------------------------------------------------------------------------
// Olympus Machine Plugin (Slot with background skin)
// Uses slot engine with custom skin and win animation.
// ---------------------------------------------------------------------------
MachineRegistry.register('Olympus', {
  type: 'slot',

  // Custom assets
  assets: {
    background: '/static/machine/Olympus/background/Olympus.png',
    pattern: '/static/machine/Olympus/background/pattern/Olympus.png',
    icons: '/static/machine/Olympus/icon/'
  }

  // The Olympus skin (background overlay) is handled by slot.js slotRenderUI.
  // Add feature-specific overrides here:
  // onFeature: function(featureId, data) {
  //   if (featureId === 'free_spin') { /* Olympus free spin animation */ }
  //   if (featureId === 'energy') { /* energy bar charging effect */ }
  // },
  // onWin: function(amount) { /* custom win celebration */ }
});
