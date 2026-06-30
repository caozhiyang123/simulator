// ---------------------------------------------------------------------------
// BingoMoney Machine Plugin (Slot)
// 3x5 slot, 10 icons, 20 lines.
// Features: BingoMiniFeature — same handling as BingoSeven.
// Reuses BingoSeven's bingo mini functions (bingoSevenRenderMiniPanel, etc.)
// ---------------------------------------------------------------------------
MachineRegistry.register('BingoMoney', {
  type: 'slot',

  assets: {
    icons: '/static/machine/BingoMoney/icon/'
  },

  afterRender: function(resp, config) {
    var gameArea = document.getElementById('playGameArea');
    if (gameArea) gameArea.style.maxWidth = '960px';

    // Render BingoMini card in a panel to the right (reuse BingoSeven's function)
    bingoSevenRenderMiniPanel(resp, config);
  },

  onSpinResponse: function(resp) {
    // Clear bingo mini card on each spin
    bingoSevenResetMiniCard();

    // If BingoMini feature triggered, defer round over
    if (resp.base_ball_numbers_per_cage && resp.base_ball_numbers_per_cage.length > 0) {
      _playBonusPending = true;
    }

    // Default slot spin handling
    slotHandleSpinResponse(resp);

    // Start cage animation after reels stop
    if (resp.base_ball_numbers_per_cage && resp.base_ball_numbers_per_cage.length > 0) {
      setTimeout(function() {
        bingoSevenStartCageAnimation(resp.base_ball_numbers_per_cage, resp.bingo_mini_prize || 0);
      }, 3500);
    }
  }
});
