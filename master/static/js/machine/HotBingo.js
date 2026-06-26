// ---------------------------------------------------------------------------
// HotBingo Machine Plugin
// SuperPatternFeature: shows a dashed line after the {amount_limit}th ball.
// Balls before the line can trigger extra prizes (super_prize_ball).
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

var _hotBingoBallCount = 0;
var _hotBingoSuperPrizes = {}; // {ballNumber: prize}

// Patch functions after they are defined
(function() {
  var patchInterval = setInterval(function() {
    if (typeof playHandleSpinResponse === 'undefined') return;
    clearInterval(patchInterval);

    var _origHandleSpin = playHandleSpinResponse;
    playHandleSpinResponse = function(spinResp) {
      // Reset state for HotBingo
      _hotBingoBallCount = 0;
      _hotBingoSuperPrizes = {};
      var oldMarker = document.getElementById('hotBingoLimitMarker');
      if (oldMarker) oldMarker.remove();

      // Parse super_prize_ball from spin response
      if (_playCurrentMachine && _playCurrentMachine.name === 'HotBingo') {
        var spb = spinResp.super_prize_ball || [];
        for (var i = 0; i < spb.length; i++) {
          _hotBingoSuperPrizes[spb[i].ball] = spb[i].prize;
        }
      }
      // Call original
      _origHandleSpin(spinResp);
    };

    var _origMarkBall = playMarkBallOnCards;
    playMarkBallOnCards = function(ballNum) {
      _origMarkBall(ballNum);
      if (!_playCurrentMachine || _playCurrentMachine.name !== 'HotBingo') return;

      _hotBingoBallCount++;

      // Check if this ball triggers a super prize
      if (_hotBingoSuperPrizes[ballNum] !== undefined) {
        hotBingoShowSuperPrize(ballNum, _hotBingoSuperPrizes[ballNum]);
      }

      // Insert dashed line marker after amount_limit balls
      var limit = window._hotBingoAmountLimit || 0;
      if (limit && _hotBingoBallCount === limit) {
        var ballArea = document.getElementById('playBallArea');
        if (ballArea) {
          var marker = document.createElement('div');
          marker.id = 'hotBingoLimitMarker';
          marker.style.cssText = 'width:2px;height:28px;border-left:2px dashed #f39c12;margin:0 2px;flex-shrink:0;';
          marker.title = 'Super Pattern limit (' + limit + ' balls)';
          ballArea.appendChild(marker);
        }
      }
    };
  }, 100);
})();

// Show spinning coin effect on the prize ball, then fly to balance
function hotBingoShowSuperPrize(ballNum, prize) {
  var ballArea = document.getElementById('playBallArea');
  if (!ballArea) return;

  // Find the ball element (last div added with this number)
  var ballDivs = ballArea.querySelectorAll('div');
  var targetBall = null;
  for (var i = ballDivs.length - 1; i >= 0; i--) {
    if (ballDivs[i].textContent == ballNum && ballDivs[i].id !== 'hotBingoLimitMarker') {
      targetBall = ballDivs[i];
      break;
    }
  }
  if (!targetBall) return;

  // Get ball position relative to the page
  var ballRect = targetBall.getBoundingClientRect();
  var skin = document.getElementById('playContent') || document.body;
  var skinRect = skin.getBoundingClientRect();
  var startX = ballRect.left - skinRect.left + ballRect.width / 2;
  var startY = ballRect.top - skinRect.top;

  // Balance target
  var balEl = document.querySelector('#playGameArea > div:first-child span:nth-child(2)') || document.getElementById('playBottomText');
  var balRect = balEl ? balEl.getBoundingClientRect() : {left: skinRect.left + 100, top: skinRect.top + 20};
  var endX = balRect.left - skinRect.left + 20;
  var endY = balRect.top - skinRect.top + 10;

  // Create coin + prize container
  var container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:' + startX + 'px;top:' + startY + 'px;z-index:200;pointer-events:none;display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);';

  // Prize text
  var prizeEl = document.createElement('div');
  prizeEl.style.cssText = 'color:#f5d742;font-size:12px;font-weight:800;text-shadow:0 1px 3px #000;margin-bottom:2px;white-space:nowrap;';
  prizeEl.textContent = '+' + prize.toFixed(2);
  container.appendChild(prizeEl);

  // Spinning coin
  var coin = document.createElement('div');
  coin.style.cssText = 'width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffe066,#f5a623,#c87800);border:2px solid #f5d742;box-shadow:0 2px 6px rgba(0,0,0,0.5);font-size:12px;text-align:center;line-height:28px;color:#7a5000;font-weight:700;animation:hotBingoCoinSpin 0.3s linear infinite;';
  coin.textContent = '$';
  container.appendChild(coin);

  skin.style.position = 'relative';
  skin.appendChild(container);

  // Animate: float up, then fly to balance
  var keyframes = [
    {transform: 'translate(-50%,-100%) scale(1)', opacity: 1},
    {transform: 'translate(-50%,-140%) scale(1.3)', opacity: 1, offset: 0.3},
    {transform: 'translate(' + (endX - startX) + 'px,' + (endY - startY) + 'px) scale(0.6)', opacity: 0.7}
  ];
  var anim = container.animate(keyframes, {
    duration: 1800,
    easing: 'cubic-bezier(0.2,0.8,0.3,1)',
    fill: 'forwards'
  });
  anim.onfinish = function() { container.remove(); };

  // Highlight the ball briefly
  targetBall.style.boxShadow = '0 0 12px 4px #f5d742';
  setTimeout(function() { targetBall.style.boxShadow = ''; }, 1500);
}
