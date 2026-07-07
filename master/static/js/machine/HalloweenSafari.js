// ---------------------------------------------------------------------------
// HalloweenSafari Machine Plugin (Slot)
// Same strawberry, pumpkin jar, dice, and wheel features as Halloween25.
// Reuses Halloween20/25's bonus functions directly.
// ---------------------------------------------------------------------------
MachineRegistry.register('HalloweenSafari', {
  type: 'slot',

  afterRender: function(resp, config) {
    halloween25PlaceVerticalLineNumbers();
  },

  onSpinResponse: function(resp) {
    _hwBonusPendingCount = 0;
    if (resp.pumpkin_jar_bonus_caldeirao && resp.pumpkin_jar_bonus_caldeirao.length > 0) {
      halloweenBonusPendingIncrement();
    }
    if (resp.strawberry_bonus && resp.strawberry_bonus.length > 0) {
      halloweenBonusPendingIncrement();
    }
    if (resp.wheel_bonus && resp.wheel_bonus.length > 0) {
      halloweenBonusPendingIncrement();
    }
    if (resp.dice_bonus && resp.dice_bonus.length > 0) {
      halloweenBonusPendingIncrement();
    }

    slotHandleSpinResponse(resp);

    if (resp.pumpkin_jar_bonus_caldeirao && resp.pumpkin_jar_bonus_caldeirao.length > 0) {
      setTimeout(function() { halloweenShowPumpkinBonus(resp); }, 3800);
    }
    if (resp.strawberry_bonus && resp.strawberry_bonus.length > 0) {
      setTimeout(function() { halloweenShowStrawberryBonus(resp); }, 3800);
    }
    if (resp.wheel_bonus && resp.wheel_bonus.length > 0) {
      setTimeout(function() { halloween25ShowWheelBonus(resp.wheel_bonus, resp.wheel_prize || 0, resp.wheel_multi || 0); }, 3800);
    }
    if (resp.dice_bonus && resp.dice_bonus.length > 0) {
      setTimeout(function() { halloween25ShowDiceBonus(resp); }, 3800);
    }
  }
});
