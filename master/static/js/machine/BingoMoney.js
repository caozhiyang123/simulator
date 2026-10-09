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

    // Reconnection recovery: if round is not yet over and BingoMini data is present,
    // the player disconnected during the cage phase. Restore the cage UI immediately
    // so they can continue clicking cages and then collect the round.
    if (resp.round_is_over === false &&
        resp.base_ball_numbers_per_cage &&
        resp.base_ball_numbers_per_cage.length > 0) {
      playLog('🔄 [BM BINGO MINI] Reconnect detected — restoring cage state');
      _playBonusPending = true;
      var alreadyReleased = resp.bingo_mini_bonus_positions || [];
      bingoSevenStartCageAnimation(
        resp.base_ball_numbers_per_cage,
        resp.bingo_mini_prize || 0,
        alreadyReleased
      );
    }
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
