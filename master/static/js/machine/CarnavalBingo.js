// ---------------------------------------------------------------------------
// CarnavalBingo Machine Plugin (Bingo)
// 5x3 cards, max 4 cards, overlap_win pattern matching.
// Features: BuffDoubleFreeEBFeature, BuffCalaWildEBFeature, BuffLightningEBFeature
// Lucky Ball: same as SuperRich — magic_available_balls triggers coin picker.
// ---------------------------------------------------------------------------
MachineRegistry.register('CarnavalBingo', {
  type: 'bingo',

  onSpinResponse: function(resp) {
    // Check if this is an EB response with magic_available_balls (lucky ball)
    if (resp.extra !== undefined && resp.magic_available_balls && resp.magic_available_balls.length > 0) {
      _superRichMagicBalls = resp.magic_available_balls;
      _superRichLastEb = resp.extra;
      playHandleBuyEbResponse(resp);
      setTimeout(function() {
        superRichShowLuckyBallModal(_superRichMagicBalls);
      }, 600);
    } else {
      playHandleSpinResponse(resp);
    }
  }
});
