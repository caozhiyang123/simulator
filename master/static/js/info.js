/**
 * info.js — Machine Info Button & Modal
 *
 * Exposes window.playShowInfoModal(machineConfig, machineType) as the single
 * public entry point. Internal helpers are exposed on window for testing.
 *
 * Load order: must be included BEFORE play.js in index.html.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * _infoExtractFields(machineConfig)
 *
 * Extracts the 11 standard Bingo display fields from a Machine_Config object.
 * - `rtp_range` from top-level machineConfig.
 * - Remaining 10 fields from machineConfig.math_model[0].
 * - Absent / null / undefined values returned as 'N/A'.
 *
 * @param {Object|null|undefined} machineConfig
 * @returns {Array<{key: string, value: *}>}
 */
function _infoExtractFields(machineConfig) {
  var NA = 'N/A';
  var mm0 =
    machineConfig &&
    Array.isArray(machineConfig.math_model) &&
    machineConfig.math_model.length > 0
      ? machineConfig.math_model[0]
      : null;

  function pick(obj, key) {
    if (obj == null) return NA;
    var val = obj[key];
    return val == null ? NA : val;
  }

  return [
    { key: 'rtp_range',          value: pick(machineConfig, 'rtp_range') },
    { key: 'name',               value: pick(mm0, 'name') },
    { key: 'ball_count',         value: pick(mm0, 'ball_count') },
    { key: 'base_ball_count',    value: pick(mm0, 'base_ball_count') },
    { key: 'eb_ball_count',      value: pick(mm0, 'eb_ball_count') },
    { key: 'card_width',         value: pick(mm0, 'card_width') },
    { key: 'card_height',        value: pick(mm0, 'card_height') },
    { key: 'miniCardNum',        value: pick(mm0, 'miniCardNum') },
    { key: 'maxCardNum',         value: pick(mm0, 'maxCardNum') },
    { key: 'max_cards',          value: pick(mm0, 'max_cards') },
    { key: 'pattern_match_type', value: pick(mm0, 'pattern_match_type') },
  ];
}

window._infoExtractFields = _infoExtractFields;

/**
 * _infoExtractSlotFields(machineConfig)
 *
 * Extracts the 8 standard Slot display fields from a Machine_Config object.
 * - `rtp_range` from top-level machineConfig.
 * - Remaining fields from machineConfig.math_model[0].
 * - `lines` displayed as line count (e.g. 20), not the full 2-D array.
 * - Absent / null / undefined values returned as 'N/A'.
 *
 * @param {Object|null|undefined} machineConfig
 * @returns {Array<{key: string, value: *}>}
 */
function _infoExtractSlotFields(machineConfig) {
  var NA = 'N/A';
  var mm0 =
    machineConfig &&
    Array.isArray(machineConfig.math_model) &&
    machineConfig.math_model.length > 0
      ? machineConfig.math_model[0]
      : null;

  function pick(obj, key) {
    if (obj == null) return NA;
    var val = obj[key];
    return val == null ? NA : val;
  }

  var linesVal = NA;
  if (mm0 != null) {
    var linesArr = mm0.lines;
    linesVal = Array.isArray(linesArr) ? linesArr.length : (linesArr != null ? linesArr : NA);
  }

  return [
    { key: 'rtp_range',          value: pick(machineConfig, 'rtp_range') },
    { key: 'name',               value: pick(mm0, 'name') },
    { key: 'row_count',          value: pick(mm0, 'row_count') },
    { key: 'column_count',       value: pick(mm0, 'column_count') },
    { key: 'icon_amount',        value: pick(mm0, 'icon_amount') },
    { key: 'max_lines',          value: pick(mm0, 'max_lines') },
    { key: 'pattern_match_type', value: pick(mm0, 'pattern_match_type') },
    { key: 'lines',              value: linesVal },
  ];
}

window._infoExtractSlotFields = _infoExtractSlotFields;

/**
 * _infoFindAllFeatures(mathModel)
 *
 * Traverses ALL entries in mathModel.features.lists and returns an array of
 * { name, config } objects — one per entry — in their original order.
 *
 * - `name` is the suffix of the `reference` field after the last '.'.
 *   e.g. "com.foo.FreeSpinFeature" → "FreeSpinFeature"
 * - `config` is a shallow copy of the entry's config object with the
 *   `pattern` key removed (if present).
 * - Entries with an empty config (after pattern removal) are still included;
 *   the render layer skips them silently.
 * - Returns [] when features / features.lists is absent or not an array.
 *
 * @param {Object|null|undefined} mathModel  The math_model[0] object.
 * @returns {Array<{name: string, config: Object}>}
 */
function _infoFindAllFeatures(mathModel) {
  if (!mathModel) return [];
  var features = mathModel.features;
  if (!features) return [];
  var lists = features.lists;
  if (!Array.isArray(lists)) return [];

  var result = [];
  for (var i = 0; i < lists.length; i++) {
    var entry = lists[i];
    if (!entry) continue;
    var ref = entry.reference;
    var name = typeof ref === 'string'
      ? ref.substring(ref.lastIndexOf('.') + 1)
      : ('feature_' + i);
    var configCopy = entry.config ? Object.assign({}, entry.config) : {};
    delete configCopy.pattern;
    result.push({ name: name, config: configCopy });
  }
  return result;
}

window._infoFindAllFeatures = _infoFindAllFeatures;

// Legacy shims — keep existing tests passing
window._infoFindFreeSpinFeature = function(mathModel) {
  var all = _infoFindAllFeatures(mathModel);
  for (var i = 0; i < all.length; i++) {
    if (all[i].name === 'FreeSpinFeature') return all[i].config;
  }
  return null;
};
window._infoFindSlotFeatures = function(mathModel) {
  return _infoFindAllFeatures(mathModel);
};

// ---------------------------------------------------------------------------
// HTML builder helpers
// ---------------------------------------------------------------------------

/**
 * _infoRenderFeaturesHTML(features, machineName)
 *
 * Renders an array of { name, config } feature objects as HTML.
 * Each feature section contains:
 *   - A header row: feature name + Upload button
 *   - An image area (shows existing image if already uploaded)
 *   - A key-value config table
 *
 * Features whose config has no keys (after pattern removal) are skipped.
 *
 * @param {Array<{name: string, config: Object}>} features
 * @param {string} machineName  e.g. "Halloween20"
 * @returns {string}
 */
function _infoRenderFeaturesHTML(features, machineName) {
  if (!features || features.length === 0) return '';
  var html = '';
  for (var i = 0; i < features.length; i++) {
    var feat = features[i];
    var keys = Object.keys(feat.config);
    if (keys.length === 0) continue;

    // feature_id from config (used for naming); fall back to index
    var featureId = feat.config.feature_id != null ? feat.config.feature_id : i;
    var safeFeatureId = String(featureId);
    var safeMachineName = _infoEscapeHTML(machineName || '');

    // Unique ids for this feature's DOM elements
    var imgAreaId    = 'infoFeatImg_'  + i;
    var fileInputId  = 'infoFeatFile_' + i;

    // ── Section header: name + upload button ────────────────────────────
    html += '<div style="display:flex;align-items:center;justify-content:space-between;'
          + 'margin:16px 0 0;border-top:1px solid #eee;padding-top:10px;">';
    html += '<h4 style="margin:0;font-size:14px;color:#333;">'
          + _infoEscapeHTML(feat.name) + '</h4>';

    // Hidden file input + visible upload button
    html += '<span style="display:flex;align-items:center;gap:6px;">';
    html += '<input type="file" id="' + fileInputId + '" accept="image/*" '
          + 'style="display:none;" '
          + 'data-machine="' + safeMachineName + '" '
          + 'data-feature-id="' + _infoEscapeHTML(safeFeatureId) + '" '
          + 'data-img-area="' + imgAreaId + '" '
          + 'onchange="_infoHandleImageUpload(this)">';
    html += '<label for="' + fileInputId + '" '
          + 'style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;'
          + 'border-radius:4px;background:#f0f0f0;border:1px solid #ccc;'
          + 'cursor:pointer;font-size:12px;color:#444;white-space:nowrap;" '
          + 'title="Upload image for this feature">'
          + '&#x2191; Upload</label>';
    html += '</span>';
    html += '</div>';

    // ── Image area ───────────────────────────────────────────────────────
    // Attempt to load existing image via the GET endpoint. The <img> onerror
    // hides itself if no image is stored yet.
    var imgSrc = '/play/info/image?machine_name=' + encodeURIComponent(machineName || '')
               + '&feature_id=' + encodeURIComponent(safeFeatureId);
    html += '<div id="' + imgAreaId + '" style="margin:8px 0 4px;">'
          + '<img src="' + imgSrc + '" '
          + 'style="max-width:100%;border-radius:4px;display:block;" '
          + 'onerror="this.parentNode.style.display=\'none\';" '
          + 'onload="this.parentNode.style.display=\'block\';">'
          + '</div>';

    // ── Config key-value table ───────────────────────────────────────────
    html += '<table style="width:100%;border-collapse:collapse;margin-top:4px;">';
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      html += '<tr>'
            + '<td style="padding:4px 8px 4px 0;font-weight:600;white-space:nowrap;'
            + 'vertical-align:top;color:#555;">'
            + _infoEscapeHTML(String(key))
            + '</td>'
            + '<td style="padding:4px 0;word-break:break-all;">'
            + _infoEscapeHTML(String(feat.config[key]))
            + '</td>'
            + '</tr>';
    }
    html += '</table>';
  }
  return html;
}

window._infoRenderFeaturesHTML = _infoRenderFeaturesHTML;

/**
 * _infoHandleImageUpload(inputEl)
 *
 * Called by the file input's onchange event. Reads machine_name and
 * feature_id from data attributes, POSTs the selected file to
 * /play/info/upload, then updates the image area on success.
 *
 * @param {HTMLInputElement} inputEl
 */
function _infoHandleImageUpload(inputEl) {
  var file = inputEl.files && inputEl.files[0];
  if (!file) return;

  var machineName = inputEl.getAttribute('data-machine') || '';
  var featureId   = inputEl.getAttribute('data-feature-id') || '';
  var imgAreaId   = inputEl.getAttribute('data-img-area') || '';

  var formData = new FormData();
  formData.append('machine_name', machineName);
  formData.append('feature_id',   featureId);
  formData.append('file', file);

  fetch('/play/info/upload', { method: 'POST', body: formData })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        alert('Upload failed: ' + data.error);
        return;
      }
      // Update / show the image in the area for this feature
      var imgArea = document.getElementById(imgAreaId);
      if (imgArea) {
        // Add cache-busting timestamp so the browser reloads the new image
        var url = data.url + '&_t=' + Date.now();
        imgArea.style.display = 'block';
        imgArea.innerHTML = '<img src="' + url + '" '
          + 'style="max-width:100%;border-radius:4px;display:block;" '
          + 'onerror="this.parentNode.style.display=\'none\';">';
      }
    })
    .catch(function(err) {
      alert('Upload error: ' + err);
    });
}

window._infoHandleImageUpload = _infoHandleImageUpload;

/**
 * _infoBuildHTML(fields, features, machineType, machineName)
 *
 * Builds the complete modal overlay HTML string.
 * Both bingo and slot share the same two-section layout:
 *   1. Basic fields table
 *   2. All feature sections (one per features.lists entry with non-empty config),
 *      each with an Upload button and image display area.
 *
 * Always includes a close button with id="infoCloseBtn" and text '✕'.
 *
 * @param {Array<{key: string, value: *}>}        fields
 * @param {Array<{name: string, config: Object}>} features
 * @param {string}                                machineType  'bingo' | 'slot'
 * @param {string}                                machineName  e.g. "Halloween20"
 * @returns {string}
 */
function _infoBuildHTML(fields, features, machineType, machineName) {
  var html = '';

  // Backdrop
  html += '<div id="infoModalOverlay" style="'
        + 'position:fixed;top:0;left:0;width:100%;height:100%;'
        + 'background:rgba(0,0,0,0.55);z-index:9999;'
        + 'display:flex;align-items:center;justify-content:center;">';

  // Content box
  html += '<div id="infoModalContent" style="'
        + 'background:#fff;border-radius:8px;padding:20px 24px;'
        + 'min-width:320px;max-width:520px;max-height:80vh;'
        + 'overflow-y:auto;position:relative;box-shadow:0 4px 24px rgba(0,0,0,0.3);">';

  // Close button
  html += '<button id="infoCloseBtn" style="'
        + 'position:absolute;top:10px;right:12px;background:none;border:none;'
        + 'font-size:18px;cursor:pointer;color:#555;line-height:1;" '
        + 'aria-label="Close">&#x2715;</button>';

  // Body — only rendered when there are fields
  if (fields.length > 0) {
    // Basic fields table
    html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;">';
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      html += '<tr>'
            + '<td style="padding:4px 8px 4px 0;font-weight:600;white-space:nowrap;vertical-align:top;">'
            + _infoEscapeHTML(String(f.key))
            + '</td>'
            + '<td style="padding:4px 0;word-break:break-all;">'
            + _infoEscapeHTML(String(f.value))
            + '</td>'
            + '</tr>';
    }
    html += '</table>';

    // All feature sections (bingo and slot both use the same renderer)
    html += _infoRenderFeaturesHTML(features, machineName);
  }

  html += '</div>'; // #infoModalContent
  html += '</div>'; // #infoModalOverlay
  return html;
}

/**
 * _infoEscapeHTML(str)
 * Minimal XSS-safe HTML escaping.
 * @param {string} str
 * @returns {string}
 */
function _infoEscapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window._infoBuildHTML = _infoBuildHTML;
window._infoEscapeHTML = _infoEscapeHTML;

// ---------------------------------------------------------------------------
// Dismissal helper
// ---------------------------------------------------------------------------

var _infoKeydownHandler = null;

/**
 * _infoDismiss()
 * Removes the modal from the DOM and cleans up the keydown listener.
 */
function _infoDismiss() {
  if (_infoKeydownHandler !== null) {
    window.removeEventListener('keydown', _infoKeydownHandler);
    _infoKeydownHandler = null;
  }
  var overlay = document.getElementById('infoModalOverlay');
  if (overlay) overlay.parentNode.removeChild(overlay);
}

window._infoDismiss = _infoDismiss;
window._infoKeydownHandler = null;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * window.playShowInfoModal(machineConfig, machineType)
 *
 * Opens the machine info modal. Dismisses any existing modal first.
 * Extracts the appropriate basic fields (bingo vs slot) and traverses ALL
 * features.lists entries via _infoFindAllFeatures, then renders the modal.
 *
 * @param {Object|null|undefined} machineConfig
 * @param {string}                machineType  'bingo' | 'slot'
 */
window.playShowInfoModal = function playShowInfoModal(machineConfig, machineType) {
  _infoDismiss();

  var fields, features, machineName;

  if (machineConfig != null) {
    var mm0 = Array.isArray(machineConfig.math_model) && machineConfig.math_model.length > 0
      ? machineConfig.math_model[0]
      : null;

    // Extract machine name for image naming: prefer math_model[0].name, fall back to id
    machineName = (mm0 && mm0.name) ? String(mm0.name) : String(machineConfig.id || '');

    fields   = machineType === 'bingo'
      ? _infoExtractFields(machineConfig)
      : _infoExtractSlotFields(machineConfig);
    features = _infoFindAllFeatures(mm0);
  } else {
    // null / undefined config — empty modal, no throw
    fields      = [];
    features    = [];
    machineName = '';
  }

  var html = _infoBuildHTML(fields, features, machineType, machineName);

  var wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper.firstChild);

  // Backdrop click
  var overlay = document.getElementById('infoModalOverlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _infoDismiss();
    });
  }

  // Escape key
  _infoKeydownHandler = function (e) {
    if (e.key === 'Escape') _infoDismiss();
  };
  window.addEventListener('keydown', _infoKeydownHandler);
  window._infoKeydownHandler = _infoKeydownHandler;

  // Close button
  var closeBtn = document.getElementById('infoCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', _infoDismiss);
};
