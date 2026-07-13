// ---------------------------------------------------------------------------
// FunBingo Machine Plugin (Bingo)
// Features: MagicBallFeature — same handling as ShowBingo (lucky ball).
// ---------------------------------------------------------------------------
MachineRegistry.register('FunBingo', {
  type: 'bingo',

  onSpinResponse: function(resp) {
    // Magic ball (same as lucky ball / magic_available_balls)
    if (resp.extra !== undefined && resp.magic_available_balls && resp.magic_available_balls.length > 0) {
      _superRichMagicBalls = resp.magic_available_balls;
      _superRichLastEb = resp.extra;
      playHandleBuyEbResponse(resp);
      playDisableEbButton();
      setTimeout(function() {
        superRichShowLuckyBallModal(_superRichMagicBalls);
      }, 600);
    } else {
      playHandleSpinResponse(resp);
    }
  }
});
