// ---------------------------------------------------------------------------
// Pharaos Machine Plugin (Bingo)
// 5x3 cards rendered as pyramid shape (rows: 1, 2, 3, 4, 5 = 15 cells).
// ---------------------------------------------------------------------------
MachineRegistry.register('Pharaos', {
  type: 'bingo',

  afterRender: function(resp, config) {
    // After default render, replace card tables with pyramid layout
    pharaosRebuildCards();
  }
});

/**
 * Replace standard 5x3 grid cards with pyramid layout.
 * Pyramid rows: 1, 2, 3, 4, 5 cells (top to bottom).
 * Data attributes preserved for ball marking and pattern checking.
 */
function pharaosRebuildCards() {
  var pyramidRows = [1, 2, 3, 4, 5];
  var cellSize = 36;
  var maxCols = 5;

  // Find all card tables and replace them
  var cardContainers = document.querySelectorAll('table');
  cardContainers.forEach(function(table) {
    // Only process tables that contain play-card-cells
    var cells = table.querySelectorAll('.play-card-cell');
    if (cells.length === 0) return;
    // Get card index from cells
    var cardIdx = cells[0].getAttribute('data-card');

    // Build pyramid HTML
    var pyramid = document.createElement('div');
    pyramid.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

    var cellIdx = 0;
    for (var row = 0; row < pyramidRows.length; row++) {
      var rowDiv = document.createElement('div');
      rowDiv.style.cssText = 'display:flex;gap:2px;justify-content:center;';
      for (var col = 0; col < pyramidRows[row]; col++) {
        if (cellIdx < cells.length) {
          var oldCell = cells[cellIdx];
          // Create new pyramid cell (div instead of td)
          var cell = document.createElement('div');
          cell.className = 'play-card-cell';
          cell.setAttribute('data-card', oldCell.getAttribute('data-card'));
          cell.setAttribute('data-idx', oldCell.getAttribute('data-idx'));
          cell.setAttribute('data-num', oldCell.getAttribute('data-num'));
          var num = parseInt(oldCell.getAttribute('data-num'));
          var isFree = (num === 0);
          cell.style.cssText = 'width:' + cellSize + 'px;height:' + cellSize + 'px;'
            + 'border:1px solid #444;text-align:center;line-height:' + cellSize + 'px;'
            + 'font-size:13px;font-weight:700;border-radius:3px;'
            + 'background:' + (isFree ? '#333' : '#f5e6c8') + ';'
            + 'color:' + (isFree ? '#fff' : '#333') + ';'
            + 'box-shadow:0 2px 4px rgba(0,0,0,0.3);';
          cell.textContent = isFree ? '\u2605' : (num < 10 ? '0' + num : num);
          rowDiv.appendChild(cell);
          cellIdx++;
        }
      }
      pyramid.appendChild(rowDiv);
    }

    // Replace table with pyramid
    table.parentElement.replaceChild(pyramid, table);
  });
}
