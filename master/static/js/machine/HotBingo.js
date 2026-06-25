// ---------------------------------------------------------------------------
// HotBingo Machine Plugin
// SuperPatternFeature: shows a dashed line after the {amount_limit}th ball.
// Balls before the line can trigger extra prizes.
// ---------------------------------------------------------------------------
MachineRegistry.register('HotBingo', {
  type: 'bingo',

  afterRender: function(resp, config) {
    // Get amount_limit from login response or config
    var amountLimit = resp.amount_limit || 0;
    if (!amountLimit) {
      try {
        var mathModel = (config.math_model && config.math_model[0]) || {};
        var features = (mathModel.features && mathModel.features.lists) || [];
        for (var i = 0; i < features.length; i++) {
          if (features[i].reference && features[i].reference.indexOf('SuperPatternFeature') >= 0) {
            amountLimit = features[i].config.amount || 0;
            break;
          }
        }
      } catch(e) {}
    }
    window._hotBingoAmountLimit = amountLimit;
  }
});

// Override: after each ball is displayed, check if we need to insert the dashed line marker
var _hotBingoOrigMarkBall = (typeof playMarkBallOnCards !== 'undefined') ? playMarkBallOnCards : null;
var _hotBingoBallCount = 0;

// Patch playHandleSpinResponse to reset ball count and observe
(function() {
  var patchInterval = setInterval(function() {
    if (typeof playHandleSpinResponse === 'undefined') return;
    clearInterval(patchInterval);

    var _origHandleSpin = playHandleSpinResponse;
    playHandleSpinResponse = function(spinResp) {
      // Reset ball counter for HotBingo
      _hotBingoBallCount = 0;
      // Remove old marker
      var oldMarker = document.getElementById('hotBingoLimitMarker');
      if (oldMarker) oldMarker.remove();
      // Call original
      _origHandleSpin(spinResp);
    };

    var _origMarkBall = playMarkBallOnCards;
    playMarkBallOnCards = function(ballNum) {
      _origMarkBall(ballNum);
      // After marking, increment count and check if marker needed
      if (!_playCurrentMachine || _playCurrentMachine.name !== 'HotBingo') return;
      var limit = window._hotBingoAmountLimit || 0;
      if (!limit) return;
      _hotBingoBallCount++;
      if (_hotBingoBallCount === limit) {
        // Insert dashed line marker after this ball in the ball area
        var ballArea = document.getElementById('playBallArea');
        if (!ballArea) return;
        var marker = document.createElement('div');
        marker.id = 'hotBingoLimitMarker';
        marker.style.cssText = 'width:2px;height:28px;border-left:2px dashed #f39c12;margin:0 2px;flex-shrink:0;';
        marker.title = 'Super Pattern limit (' + limit + ' balls)';
        ballArea.appendChild(marker);
      }
    };
  }, 100);
})();
