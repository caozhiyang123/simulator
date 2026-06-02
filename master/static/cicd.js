// ---------------------------------------------------------------------------
// CICD Module JavaScript
// ---------------------------------------------------------------------------

var _cicdCurrentView = '';
var _cicdCurrentSubView = '';
var _cicdCurrentItem = '';
var _cicdCurrentItemData = null;
var _cicdCreateViewParent = '';
var _cicdParams = [];
var _cicdBuildSteps = [];
var _cicdPostBuildSteps = [];
var _cicdIsEditing = false; // Track if user is on edit/create page

// ---------------------------------------------------------------------------
// Editing guard - confirm before navigating away from edit/create pages
// ---------------------------------------------------------------------------
function cicdCheckEditing() {
  if (_cicdIsEditing) {
    return confirm('You have unsaved changes. Are you sure you want to leave this page?');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Page visibility helpers
// ---------------------------------------------------------------------------
function cicdHideAll() {
  document.getElementById('cicdHome').style.display = 'none';
  document.getElementById('cicdViewDetail').style.display = 'none';
  document.getElementById('cicdCreateView').style.display = 'none';
  document.getElementById('cicdCreateItem').style.display = 'none';
  document.getElementById('cicdItemConfig').style.display = 'none';
  var detail = document.getElementById('cicdItemDetail');
  if (detail) detail.style.display = 'none';
}

function cicdGoHome() {
  if (!cicdCheckEditing()) return;
  _cicdIsEditing = false;
  cicdHideAll();
  document.getElementById('cicdHome').style.display = '';
  _cicdCurrentView = '';
  _cicdCurrentSubView = '';
  _cicdCurrentItem = '';
  _cicdCurrentItemData = null;
  cicdUpdateBreadcrumb();
  cicdLoadHome();
}

function cicdUpdateBreadcrumb() {
  var bc = document.getElementById('cicdBreadcrumb');
  var html = '<span style="cursor:pointer;color:#4a90d9;" onclick="cicdGoHome()">🏠</span>';
  if (_cicdCurrentView) {
    html += ' / <span style="cursor:pointer;color:#4a90d9;" onclick="cicdNavToView(\'' + _cicdCurrentView + '\')">' + _cicdCurrentView + '</span>';
  }
  if (_cicdCurrentSubView) {
    html += ' / <span style="cursor:pointer;color:#4a90d9;" onclick="cicdNavToSubView(\'' + _cicdCurrentSubView + '\',\'' + _cicdCurrentView + '\')">' + _cicdCurrentSubView + '</span>';
  }
  if (_cicdCurrentItem) {
    html += ' / <span style="cursor:pointer;color:#4a90d9;" onclick="cicdNavToItem(\'' + _cicdCurrentItem + '\')">' + _cicdCurrentItem + '</span>';
  }
  bc.innerHTML = html;
}

// Navigation helpers with editing guard
function cicdNavToView(viewName) {
  if (!cicdCheckEditing()) return;
  _cicdIsEditing = false;
  cicdOpenView(viewName);
}
function cicdNavToSubView(subViewName, parentView) {
  if (!cicdCheckEditing()) return;
  _cicdIsEditing = false;
  cicdOpenSubView(subViewName, parentView);
}
function cicdNavToItem(itemName) {
  if (!cicdCheckEditing()) return;
  _cicdIsEditing = false;
  cicdOpenItemDetail(itemName, _cicdCurrentView || '');
}

// ---------------------------------------------------------------------------
// Home & Views
// ---------------------------------------------------------------------------
async function cicdLoadHome() {
  try {
    var res = await fetch('/cicd/views');
    var data = await res.json();
    var views = data.views || [];
    var topViews = views.filter(function(v) { return !v.parent; });
    var tabsHtml = '';
    topViews.forEach(function(v) {
      tabsHtml += '<span style="padding:4px 12px;border:1px solid #ddd;border-radius:14px;font-size:13px;color:#333;cursor:pointer;" onclick="cicdOpenView(\'' + v.name + '\')" onmouseover="this.style.background=\'#f0f7ff\'" onmouseout="this.style.background=\'\'">' + v.name + '</span>';
    });
    document.getElementById('cicdViewTabs').innerHTML = tabsHtml;
    var itemsRes = await fetch('/cicd/items');
    var itemsData = await itemsRes.json();
    cicdRenderItemsTable(itemsData.items || [], 'cicdItemsTable');
  } catch(e) { console.error('cicdLoadHome error:', e); }
}

function cicdShowAllItems() { _cicdCurrentSubView = ''; cicdLoadHome(); }

function cicdRenderItemsTable(items, containerId) {
  var html = '<table class="result-table" style="width:100%;">';
  html += '<thead><tr><th style="width:30px;">S</th><th style="width:30px;">W</th><th>名称 ↓</th><th>上次成功</th><th>上次失败</th><th>上次持续时间</th><th style="width:40px;"></th></tr></thead><tbody>';
  if (!items.length) { html += '<tr><td colspan="7" style="text-align:center;color:#999;padding:20px;">No items</td></tr>'; }
  items.forEach(function(item) {
    var sIcon = '📁', statusIcon = '☀', statusColor = '#f39c12';
    if (item.last_success && !item.last_failure) sIcon = '<span style="color:#27ae60;">✅</span>';
    else if (item.last_failure) sIcon = '<span style="color:#e74c3c;">⊘</span>';
    var lastSuccess = item.last_success || '无', lastFailure = item.last_failure || '无', lastDuration = item.last_duration || '无';
    var buildNum = item.build_history ? item.build_history.length : 0;
    var successDisplay = lastSuccess !== '无' && buildNum > 0 ? lastSuccess + ' <span style="color:#4a90d9;">#' + buildNum + '</span>' : lastSuccess;
    html += '<tr><td>' + sIcon + '</td><td style="color:' + statusColor + ';">' + statusIcon + '</td>';
    html += '<td><a href="javascript:void(0)" onclick="cicdOpenItemDetail(\'' + item.name + '\',\'' + (item.parent_view||'') + '\')" style="color:#4a90d9;text-decoration:none;">' + item.name + '</a></td>';
    html += '<td style="font-size:12px;">' + successDisplay + '</td><td style="font-size:12px;">' + lastFailure + '</td><td style="font-size:12px;">' + lastDuration + '</td>';
    html += '<td><span style="cursor:pointer;color:#27ae60;font-size:18px;" onclick="cicdRunItem(\'' + item.name + '\',\'' + (item.parent_view||'') + '\')" title="Run">▶</span></td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById(containerId).innerHTML = html;
}

// ---------------------------------------------------------------------------
// Item Detail Page (status page when clicking item name)
// ---------------------------------------------------------------------------
async function cicdOpenItemDetail(itemName, parentView) {
  if (_cicdIsEditing && !cicdCheckEditing()) return;
  _cicdIsEditing = false;
  _cicdCurrentItem = itemName;
  cicdUpdateBreadcrumb();
  cicdHideAll();

  // Ensure detail container exists
  var detailEl = document.getElementById('cicdItemDetail');
  if (!detailEl) {
    detailEl = document.createElement('div');
    detailEl.id = 'cicdItemDetail';
    document.getElementById('cicdApp').appendChild(detailEl);
  }
  detailEl.style.display = '';

  // Load item data
  var res = await fetch('/cicd/items/get?name=' + encodeURIComponent(itemName) + '&parent_view=' + encodeURIComponent(parentView || ''));
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  _cicdCurrentItemData = data.item;
  var item = data.item;

  // Determine status icon
  var statusIcon = '✅';
  if (item.last_failure && (!item.last_success || item.last_failure > item.last_success)) statusIcon = '⊘';

  // Build history
  var builds = item.build_history || [];
  var buildsHtml = '<div style="font-size:13px;font-weight:600;margin-bottom:8px;">Builds</div>';
  buildsHtml += '<div style="border:1px solid #eee;border-radius:6px;padding:8px;max-height:350px;overflow-y:auto;">';
  if (!builds.length) { buildsHtml += '<div style="color:#999;font-size:12px;padding:8px;">No builds yet</div>'; }
  builds.slice().reverse().forEach(function(b) {
    var bIcon = b.success ? '<span style="color:#27ae60;">✅</span>' : '<span style="color:#e74c3c;">⊘</span>';
    buildsHtml += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;">' + bIcon + ' <span style="color:#4a90d9;">#' + b.number + '</span> <span style="color:#888;">' + (b.timestamp || '') + '</span></div>';
  });
  buildsHtml += '</div>';

  // Related links
  var relatedHtml = '<h3 style="margin:12px 0 8px;">Related Links</h3><ul style="font-size:12px;color:#4a90d9;list-style:disc;padding-left:20px;">';
  if (builds.length) {
    var last = builds[builds.length - 1];
    relatedHtml += '<li>Last build (#' + last.number + '), ' + (last.timestamp || '') + '</li>';
    var lastSuccess = builds.filter(function(b){return b.success;}).pop();
    var lastFail = builds.filter(function(b){return !b.success;}).pop();
    if (lastSuccess) relatedHtml += '<li>Last successful build (#' + lastSuccess.number + '), ' + lastSuccess.timestamp + '</li>';
    if (lastFail) relatedHtml += '<li>Last failed build (#' + lastFail.number + '), ' + lastFail.timestamp + '</li>';
  }
  relatedHtml += '</ul>';

  var html = '<div style="display:flex;gap:16px;">';
  // Left sidebar
  html += '<div style="min-width:200px;background:#f8f9fa;border-radius:8px;padding:12px;">';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;background:#4a90d9;color:#fff;" onclick="cicdOpenItemDetail(\'' + itemName + '\',\'' + (parentView||'') + '\')">📋 state</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">⟨/⟩ Modification history</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">📁 workspace</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdShowBuildWithParams(\'' + itemName + '\',\'' + (parentView||'') + '\')">▷ Build with Parameters</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdOpenItemConfig(\'' + itemName + '\',\'' + (parentView||'') + '\')">⚙ Configuration</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdDeleteItem(\'' + itemName + '\',\'' + (parentView||'') + '\')">🗑 Delete Project</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">⊕ move</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">✏ Rename</div>';
  html += buildsHtml;
  html += '</div>';
  // Right content
  html += '<div style="flex:1;">';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span style="font-size:24px;">' + statusIcon + '</span><h2 style="margin:0;">' + itemName + '</h2></div>';
  html += '<div style="font-size:13px;color:#666;margin-bottom:4px;">Full project name: ' + (_cicdCurrentView || 'root') + '/' + itemName + '</div>';
  html += '<div style="font-size:13px;color:#666;margin-bottom:16px;">' + (item.description || '') + '</div>';
  html += relatedHtml;
  html += '</div></div>';

  detailEl.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Build with Parameters page
// ---------------------------------------------------------------------------
function cicdShowBuildWithParams(itemName, parentView) {
  cicdHideAll();
  var detailEl = document.getElementById('cicdItemDetail');
  if (!detailEl) { detailEl = document.createElement('div'); detailEl.id = 'cicdItemDetail'; document.getElementById('cicdApp').appendChild(detailEl); }
  detailEl.style.display = '';

  var item = _cicdCurrentItemData;
  if (!item) { showAlert('Item data not loaded'); return; }
  var params = item.parameters || [];

  // Build history sidebar
  var builds = item.build_history || [];
  var buildsHtml = '<div style="font-size:13px;font-weight:600;margin-bottom:8px;margin-top:16px;">Builds</div>';
  buildsHtml += '<div style="border:1px solid #eee;border-radius:6px;padding:8px;max-height:300px;overflow-y:auto;">';
  if (!builds.length) buildsHtml += '<div style="color:#999;font-size:12px;">No builds yet</div>';
  builds.slice().reverse().forEach(function(b) {
    var bIcon = b.success ? '<span style="color:#27ae60;">✅</span>' : '<span style="color:#e74c3c;">⊘</span>';
    buildsHtml += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;">' + bIcon + ' #' + b.number + ' <span style="color:#888;">' + (b.timestamp||'') + '</span></div>';
  });
  buildsHtml += '</div>';

  var html = '<div style="display:flex;gap:16px;">';
  // Sidebar
  html += '<div style="min-width:200px;background:#f8f9fa;border-radius:8px;padding:12px;">';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdOpenItemDetail(\'' + itemName + '\',\'' + (parentView||'') + '\')">📋 状态</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">⟨/⟩ 修改记录</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">📁 工作空间</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;background:#4a90d9;color:#fff;">▷ Build with Parameters</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdOpenItemConfig(\'' + itemName + '\',\'' + (parentView||'') + '\')">⚙ 配置</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdDeleteItem(\'' + itemName + '\',\'' + (parentView||'') + '\')">🗑 删除 Project</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">⊕ 移动</div>';
  html += '<div style="padding:8px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">✏ 重命名</div>';
  html += buildsHtml;
  html += '</div>';
  // Right content - Build with Parameters
  html += '<div style="flex:1;">';
  html += '<h2 style="margin:0 0 12px;">Project ' + itemName + '</h2>';
  html += '<p style="font-size:13px;color:#4a90d9;margin-bottom:16px;">需要如下参数用于构建项目:</p>';

  // Render parameters
  if (params.length) {
    params.forEach(function(p, idx) {
      if (p.type === 'boolean') {
        html += '<div style="margin-bottom:12px;display:flex;align-items:flex-start;gap:8px;">';
        html += '<input type="checkbox" id="cicdBuildParam' + idx + '"' + (p.set_by_default ? ' checked' : '') + ' style="margin-top:3px;">';
        html += '<span style="font-size:13px;">' + (p.name || 'Boolean Parameter') + '</span>';
        html += '</div>';
      } else if (p.type === 'choice') {
        html += '<div style="margin-bottom:12px;"><label style="font-size:13px;display:block;margin-bottom:4px;">' + (p.name || 'Choice') + '</label>';
        html += '<select id="cicdBuildParam' + idx + '" style="padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;">';
        (p.choices || '').split('\n').forEach(function(c) { if (c.trim()) html += '<option>' + c.trim() + '</option>'; });
        html += '</select></div>';
      } else {
        html += '<div style="margin-bottom:12px;"><label style="font-size:13px;display:block;margin-bottom:4px;">' + (p.name || 'Parameter') + '</label>';
        html += '<input type="' + (p.type==='password'?'password':'text') + '" id="cicdBuildParam' + idx + '" value="' + (p.default_value||'') + '" style="padding:6px;border:1px solid #ccc;border-radius:4px;font-size:13px;width:300px;"></div>';
      }
    });
  } else {
    html += '<p style="font-size:13px;color:#888;">No parameters configured.</p>';
  }

  html += '<div style="margin-top:20px;display:flex;gap:8px;">';
  html += '<button class="btn-success" style="padding:8px 20px;font-size:14px;" onclick="cicdExecuteBuild(\'' + itemName + '\',\'' + (parentView||'') + '\')">▷ Build</button>';
  html += '<button class="btn-warning" style="padding:8px 20px;font-size:14px;" onclick="cicdOpenItemDetail(\'' + itemName + '\',\'' + (parentView||'') + '\')">Cancel</button>';
  html += '</div>';
  html += '</div></div>';

  detailEl.innerHTML = html;
}

async function cicdExecuteBuild(itemName, parentView) {
  var item = _cicdCurrentItemData;
  var token = item ? (item.trigger_token || '') : '';
  var url = '/cicd/items/run';
  if (token) url += '?token=' + encodeURIComponent(token);

  showAlert('Building ' + itemName + '...');
  var res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name: itemName, parent_view: parentView || '' })
  });
  var data = await res.json();
  if (data.status === 'ok') {
    showAlert('Build #' + data.build.number + ' succeeded! Duration: ' + data.build.duration);
  } else {
    var output = '';
    if (data.build && data.build.results) data.build.results.forEach(function(r) { output += r.output + '\n'; });
    showAlert('Build #' + (data.build ? data.build.number : '?') + ' failed.\n' + output);
  }
  // Reload item detail
  var reloadRes = await fetch('/cicd/items/get?name=' + encodeURIComponent(itemName) + '&parent_view=' + encodeURIComponent(parentView || ''));
  var reloadData = await reloadRes.json();
  if (!reloadData.error) _cicdCurrentItemData = reloadData.item;
  cicdOpenItemDetail(itemName, parentView);
}

async function cicdDeleteItem(itemName, parentView) {
  if (!confirm('Delete "' + itemName + '"?')) return;
  await fetch('/cicd/items/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:itemName,parent_view:parentView||''}) });
  cicdGoHome();
}

// ---------------------------------------------------------------------------
// View navigation
// ---------------------------------------------------------------------------
async function cicdOpenView(viewName) {
  _cicdCurrentView = viewName; _cicdCurrentSubView = ''; _cicdCurrentItem = '';
  cicdUpdateBreadcrumb(); cicdHideAll();
  document.getElementById('cicdViewDetail').style.display = '';
  document.getElementById('cicdViewTitle').textContent = viewName;

  var sidebarHtml = '';
  sidebarHtml += '<div style="padding:6px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;background:#4a90d9;color:#fff;">📊 状态</div>';
  sidebarHtml += '<div style="padding:6px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdShowCreateItemInView(\'' + viewName + '\')">➕ 新建Item</div>';
  sidebarHtml += '<div style="padding:6px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'">📜 构建历史</div>';
  sidebarHtml += '<div style="padding:6px 10px;cursor:pointer;font-size:13px;border-radius:4px;margin-bottom:4px;" onmouseover="this.style.background=\'#e8f4fd\'" onmouseout="this.style.background=\'\'" onclick="cicdShowEditView(\'' + viewName + '\')">✏ 编辑视图</div>';
  sidebarHtml += '<div style="margin-top:12px;padding:8px 10px;font-size:12px;color:#666;border-top:1px solid #ddd;"><span>构建队列</span><div style="font-size:11px;color:#999;margin-top:4px;">队列中没有任务排队</div></div>';
  sidebarHtml += '<div style="margin-top:8px;padding:8px 10px;font-size:12px;color:#666;border-top:1px solid #ddd;"><span>构建执行状态</span><div style="font-size:11px;color:#999;margin-top:4px;">(0 of 2 executors busy)</div></div>';
  document.getElementById('cicdViewSidebar').innerHTML = sidebarHtml;

  var res = await fetch('/cicd/views');
  var data = await res.json();
  var subViews = (data.views || []).filter(function(v) { return v.parent === viewName; });
  var subTabsHtml = '';
  subViews.forEach(function(v) {
    subTabsHtml += '<span style="padding:4px 12px;border:1px solid #ddd;border-radius:14px;font-size:13px;color:#333;cursor:pointer;" onclick="cicdOpenSubView(\'' + v.name + '\',\'' + viewName + '\')" onmouseover="this.style.background=\'#f0f7ff\'" onmouseout="this.style.background=\'\'">' + v.name + '</span>';
  });
  document.getElementById('cicdSubViewTabs').innerHTML = subTabsHtml;

  var itemsRes = await fetch('/cicd/items?parent=' + encodeURIComponent(viewName));
  var itemsData = await itemsRes.json();
  cicdRenderItemsTable(itemsData.items || [], 'cicdViewItems');
}

async function cicdOpenSubView(subViewName, parentView) {
  _cicdCurrentSubView = subViewName; cicdUpdateBreadcrumb();
  var res = await fetch('/cicd/views');
  var data = await res.json();
  var subView = (data.views || []).find(function(v) { return v.name === subViewName && v.parent === parentView; });
  if (!subView) return;
  var itemsRes = await fetch('/cicd/items?parent=' + encodeURIComponent(parentView));
  var itemsData = await itemsRes.json();
  var filtered = (itemsData.items || []).filter(function(i) { return (subView.items || []).indexOf(i.name) >= 0; });
  cicdRenderItemsTable(filtered, 'cicdViewItems');
}

function cicdViewShowAll() { _cicdCurrentSubView = ''; cicdUpdateBreadcrumb(); cicdOpenView(_cicdCurrentView); }

// ---------------------------------------------------------------------------
// Create View
// ---------------------------------------------------------------------------
function cicdShowCreateView() { _cicdCreateViewParent = ''; cicdPrepareCreateView(); }
function cicdShowCreateSubView() { _cicdCreateViewParent = _cicdCurrentView; cicdPrepareCreateView(); }

async function cicdPrepareCreateView() {
  cicdHideAll();
  document.getElementById('cicdCreateView').style.display = '';
  document.getElementById('cicdNewViewName').value = '';
  var parent = _cicdCreateViewParent || '';
  var url = parent ? '/cicd/items?parent=' + encodeURIComponent(parent) : '/cicd/items';
  var res = await fetch(url); var data = await res.json();
  var items = data.items || []; var html = '';
  items.forEach(function(item) { html += '<label style="display:block;margin-bottom:4px;font-size:13px;"><input type="checkbox" value="' + item.name + '"> ' + item.name + '</label>'; });
  if (!items.length) html = '<div style="color:#999;font-size:12px;">No items available</div>';
  document.getElementById('cicdViewItemCheckboxes').innerHTML = html;
}

async function cicdSaveView() {
  var name = document.getElementById('cicdNewViewName').value.trim();
  if (!name) { showAlert('Please enter a view name'); return; }
  var cbs = document.querySelectorAll('#cicdViewItemCheckboxes input[type="checkbox"]:checked');
  var sel = []; cbs.forEach(function(cb) { sel.push(cb.value); });
  var res = await fetch('/cicd/views', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name,parent:_cicdCreateViewParent,items:sel}) });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  cicdGoHome();
}

function cicdCancelCreateView() { _cicdCurrentView ? cicdOpenView(_cicdCurrentView) : cicdGoHome(); }

// ---------------------------------------------------------------------------
// Create Item
// ---------------------------------------------------------------------------
function cicdShowCreateItem() { _cicdCreateViewParent = ''; cicdPrepareCreateItem(); }
function cicdShowCreateItemInView(viewName) { _cicdCreateViewParent = viewName; cicdPrepareCreateItem(); }

function cicdPrepareCreateItem() {
  if (!cicdCheckEditing()) return;
  _cicdIsEditing = true;
  cicdHideAll();
  document.getElementById('cicdCreateItem').style.display = '';
  document.getElementById('cicdNewItemName').value = '';
  document.getElementById('cicdItemNameError').style.display = 'none';
  var radios = document.querySelectorAll('input[name="cicdItemType"]');
  radios.forEach(function(r) { if (r.value === 'freestyle') r.checked = true; });
}

function cicdSelectItemType(type) {}

async function cicdSaveItem() {
  var name = document.getElementById('cicdNewItemName').value.trim();
  if (!name) { document.getElementById('cicdItemNameError').style.display = 'block'; return; }
  document.getElementById('cicdItemNameError').style.display = 'none';
  var type = 'freestyle';
  document.querySelectorAll('input[name="cicdItemType"]').forEach(function(r) { if (r.checked) type = r.value; });
  var res = await fetch('/cicd/items', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name,type:type,parent_view:_cicdCreateViewParent}) });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  cicdOpenItemConfig(name, _cicdCreateViewParent);
}

function cicdCancelCreateItem() { _cicdIsEditing = false; _cicdCurrentView ? cicdOpenView(_cicdCurrentView) : cicdGoHome(); }

// ---------------------------------------------------------------------------
// Item Config (Edit) Page
// ---------------------------------------------------------------------------
async function cicdOpenItemConfig(itemName, parentView) {
  if (!itemName) return;
  if (!cicdCheckEditing()) return;
  _cicdIsEditing = true;
  _cicdCurrentItem = itemName;
  cicdUpdateBreadcrumb(); cicdHideAll();
  document.getElementById('cicdItemConfig').style.display = '';

  var res = await fetch('/cicd/items/get?name=' + encodeURIComponent(itemName) + '&parent_view=' + encodeURIComponent(parentView || ''));
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  var item = data.item;
  _cicdCurrentItemData = item;

  document.getElementById('cicdItemEnabled').checked = item.enabled !== false;
  document.getElementById('cicdItemDesc').value = item.description || '';

  // Trigger token
  var tokenEl = document.getElementById('cicdTriggerToken');
  if (tokenEl) tokenEl.value = item.trigger_token || '';
  var triggerCb = document.getElementById('cicdTriggerRemote');
  if (triggerCb) {
    triggerCb.checked = !!(item.trigger_token);
    document.getElementById('cicdTriggerRemoteDetail').style.display = item.trigger_token ? '' : 'none';
  }

  // Parameters
  _cicdParams = item.parameters || [];
  if (_cicdParams.length > 0) {
    document.getElementById('cicdParameterized').checked = true;
    document.getElementById('cicdParameterizedDetail').style.display = '';
    cicdRenderParams();
  } else {
    document.getElementById('cicdParameterized').checked = false;
    document.getElementById('cicdParameterizedDetail').style.display = 'none';
  }

  // Build steps & post-build
  cicdRenderBuildSteps(item.build_steps || []);
  _cicdPostBuildSteps = item.post_build || [];
  cicdRenderPostBuildSteps();

  // Load SSH servers into dropdowns
  cicdLoadSshServers();
}

// ---------------------------------------------------------------------------
// SSH Server dropdown population from worker nodes
// ---------------------------------------------------------------------------
async function cicdLoadSshServers() {
  try {
    var res = await fetch('/config/nodes');
    var nodesData = await res.json();
    var nodes = nodesData.nodes || [];
    // Check health of each node
    var healthRes = await fetch('/cicd/nodes/health');
    var healthData = await healthRes.json();
    var health = healthData.health || {};

    // Populate all SSH server selects
    var selects = document.querySelectorAll('select[id^="cicdSsh"], select[id^="cicdPostSsh"]');
    selects.forEach(function(sel) {
      var currentVal = sel.getAttribute('data-value') || sel.value;
      var opts = '<option value="">-- Select SSH Server --</option>';
      nodes.forEach(function(n) {
        var addr = n.addr;
        var name = n.alias || addr;
        var isHealthy = health[addr] === true;
        var dot = isHealthy ? '🟢' : '🔴';
        var selected = (currentVal === addr) ? ' selected' : '';
        opts += '<option value="' + addr + '"' + selected + '>' + dot + ' ' + name + ' (' + addr + ')</option>';
      });
      sel.innerHTML = opts;
      if (currentVal) sel.value = currentVal;
    });
  } catch(e) { console.error('cicdLoadSshServers error:', e); }
}

function cicdConfigSection(section) {
  var sectionId = 'cicdSection' + section.charAt(0).toUpperCase() + section.slice(1);
  var el = document.getElementById(sectionId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cicdToggleBuildStepMenu() { var m = document.getElementById('cicdBuildStepMenu'); m.style.display = m.style.display === 'none' ? '' : 'none'; }
function cicdTogglePostBuildMenu() { var m = document.getElementById('cicdPostBuildMenu'); m.style.display = m.style.display === 'none' ? '' : 'none'; }

function cicdToggleSshAdvanced(idx) {
  var p = document.getElementById('cicdSshAdvPanel' + idx), b = document.getElementById('cicdSshAdvBtn' + idx);
  if (p.style.display === 'none') { p.style.display = ''; b.textContent = 'advanced \u2227'; } else { p.style.display = 'none'; b.textContent = 'advanced \u2228'; }
}
function cicdTogglePostBuildSshAdvanced(idx) {
  var p = document.getElementById('cicdPostSshAdvPanel' + idx), b = document.getElementById('cicdPostSshAdvBtn' + idx);
  if (p.style.display === 'none') { p.style.display = ''; b.textContent = 'advanced \u2227'; } else { p.style.display = 'none'; b.textContent = 'advanced \u2228'; }
}

function cicdToggleTriggerRemote() {
  var cb = document.getElementById('cicdTriggerRemote');
  document.getElementById('cicdTriggerRemoteDetail').style.display = cb.checked ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Parameterized build
// ---------------------------------------------------------------------------
function cicdToggleParameterized() { document.getElementById('cicdParameterizedDetail').style.display = document.getElementById('cicdParameterized').checked ? '' : 'none'; }
function cicdToggleAddParamMenu() { var m = document.getElementById('cicdAddParamMenu'); m.style.display = m.style.display === 'none' ? '' : 'none'; }
function cicdAddParam(type) { _cicdParams.push({type:type,name:'',default_value:'',description:'',set_by_default:true,choices:''}); cicdRenderParams(); }
function cicdRemoveParam(idx) { _cicdParams.splice(idx, 1); cicdRenderParams(); }

function cicdRenderParams() {
  var container = document.getElementById('cicdParamList'); var html = '';
  _cicdParams.forEach(function(p, idx) {
    var typeLabel = {boolean:'Boolean Parameter',string:'String Parameter',text:'Text Parameter',choice:'Choice Parameter',password:'Password Parameter'}[p.type] || p.type;
    html += '<div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:10px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-weight:600;font-size:13px;">\u2261 ' + typeLabel + ' \uFF1F</span><span style="cursor:pointer;color:#e74c3c;font-size:16px;" onclick="cicdRemoveParam(' + idx + ')">\u2715</span></div>';
    html += '<label style="font-size:12px;display:block;margin-bottom:4px;">\u540D\u79F0 \uFF1F</label><input type="text" id="cicdParam' + idx + 'Name" value="' + (p.name||'') + '" style="margin-bottom:10px;">';
    if (p.type === 'boolean') { html += '<div style="margin-bottom:10px;"><label style="font-size:12px;"><input type="checkbox" id="cicdParam' + idx + 'Default"' + (p.set_by_default?' checked':'') + '> Set by Default \uFF1F</label></div>'; }
    else if (p.type === 'choice') { html += '<label style="font-size:12px;">选项</label><textarea id="cicdParam' + idx + 'Choices" rows="4" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;margin-bottom:10px;">' + (p.choices||'') + '</textarea>'; }
    else { html += '<label style="font-size:12px;">默认值</label><input type="' + (p.type==='password'?'password':'text') + '" id="cicdParam' + idx + 'Default" value="' + (p.default_value||'') + '" style="margin-bottom:10px;">'; }
    html += '<label style="font-size:12px;display:block;margin-bottom:4px;">描述 \uFF1F</label><textarea id="cicdParam' + idx + 'Desc" rows="3" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;margin-bottom:4px;">' + (p.description||'') + '</textarea>';
    html += '</div>';
  });
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Build Steps rendering
// ---------------------------------------------------------------------------
function cicdAddSshStep() { _cicdBuildSteps.push({type:'ssh',config:{hostname:'',source_files:'',remove_prefix:'',remote_directory:'',exec_command:''}}); cicdRenderBuildSteps(_cicdBuildSteps); cicdLoadSshServers(); }
function cicdRemoveBuildStep(idx) { _cicdBuildSteps.splice(idx, 1); cicdRenderBuildSteps(_cicdBuildSteps); }

function cicdRenderBuildSteps(steps) {
  _cicdBuildSteps = steps;
  var container = document.getElementById('cicdBuildStepsList'); var html = '';
  steps.forEach(function(step, idx) {
    if (step.type === 'ssh') {
      var cfg = step.config || {};
      html += '<div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:12px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-weight:600;font-size:14px;">\u2261 Send files or execute commands over SSH \uFF1F</span><span style="cursor:pointer;color:#e74c3c;font-size:16px;" onclick="cicdRemoveBuildStep(' + idx + ')">\u2715</span></div>';
      html += '<div style="font-size:13px;color:#666;margin-bottom:12px;">SSH Publishers</div>';
      html += '<div style="border:1px solid #eee;border-radius:6px;padding:12px;">';
      html += '<div style="font-weight:600;margin-bottom:8px;">\u2261 SSH Server</div>';
      html += '<label style="font-size:12px;">Name \uFF1F</label>';
      html += '<select id="cicdSsh' + idx + 'Host" data-value="' + (cfg.hostname||'') + '" style="width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;margin-bottom:8px;"><option value="">-- Select SSH Server --</option></select>';
      html += '<div style="margin-bottom:12px;"><div style="display:flex;align-items:center;gap:12px;"><button class="btn-primary btn-sm" onclick="cicdToggleSshAdvanced(' + idx + ')" id="cicdSshAdvBtn' + idx + '" style="font-size:11px;padding:3px 8px;">advanced \u2228</button></div>';
      html += '<div id="cicdSshAdvPanel' + idx + '" style="display:none;margin-top:8px;margin-left:8px;padding:8px 12px;border-left:2px solid #eee;">';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox" id="cicdSsh' + idx + 'Verbose" checked> Verbose output in console \uFF1F</label></div>';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox"> Credentials \uFF1F</label></div>';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox"> Retry \uFF1F</label></div>';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox"> Label \uFF1F</label></div>';
      html += '</div></div>';
      html += '<div style="font-size:13px;font-weight:600;margin-top:12px;">Transfers</div>';
      html += '<div style="border:1px solid #eee;border-radius:4px;padding:10px;margin-top:6px;">';
      html += '<div style="font-weight:600;font-size:12px;margin-bottom:6px;">\u2261 Transfer Set</div>';
      html += '<label style="font-size:12px;">Source files \uFF1F</label><input type="text" id="cicdSsh' + idx + 'Src" value="' + (cfg.source_files||'') + '" style="margin-bottom:4px;">';
      html += '<div style="font-size:11px;color:#e74c3c;margin-bottom:6px;">\u26A0 Either Source files, Exec command or both must be supplied</div>';
      html += '<label style="font-size:12px;">Remove prefix \uFF1F</label><input type="text" id="cicdSsh' + idx + 'Prefix" value="' + (cfg.remove_prefix||'') + '" style="margin-bottom:6px;">';
      html += '<label style="font-size:12px;">Remote directory \uFF1F</label><input type="text" id="cicdSsh' + idx + 'RemoteDir" value="' + (cfg.remote_directory||'') + '" style="margin-bottom:6px;">';
      html += '<label style="font-size:12px;">Exec command \uFF1F</label><textarea id="cicdSsh' + idx + 'Cmd" rows="4" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-family:monospace;font-size:12px;resize:vertical;">' + (cfg.exec_command||'') + '</textarea>';
      html += '<div style="font-size:11px;color:#e74c3c;margin-top:4px;">\u26A0 Either Source files, Exec command or both must be supplied</div>';
      html += '<div style="font-size:11px;color:#4a90d9;margin-top:4px;">All of the transfer fields (except for Exec timeout) support substitution of environment variables</div>';
      html += '</div>';
      html += '<div style="margin-top:8px;"><button class="btn-primary btn-sm" onclick="showAlert(\'Coming soon\')">Add Transfer Set</button></div>';
      html += '</div>';
      html += '<div style="margin-top:8px;"><button class="btn-primary btn-sm" onclick="showAlert(\'Coming soon\')">Add Server</button></div>';
      html += '</div>';
    }
  });
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Post-build steps rendering
// ---------------------------------------------------------------------------
function cicdAddPostBuildSshStep() { _cicdPostBuildSteps.push({type:'ssh',config:{hostname:'',source_files:'',remove_prefix:'',remote_directory:'',exec_command:''}}); cicdRenderPostBuildSteps(); cicdLoadSshServers(); }
function cicdRemovePostBuildStep(idx) { _cicdPostBuildSteps.splice(idx, 1); cicdRenderPostBuildSteps(); }

function cicdRenderPostBuildSteps() {
  var container = document.getElementById('cicdPostBuildStepsList'); var html = '';
  _cicdPostBuildSteps.forEach(function(step, idx) {
    if (step.type === 'ssh') {
      var cfg = step.config || {};
      html += '<div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:12px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-weight:600;font-size:14px;">\u2261 Send build artifacts over SSH \uFF1F</span><span style="cursor:pointer;color:#e74c3c;font-size:16px;" onclick="cicdRemovePostBuildStep(' + idx + ')">\u2715</span></div>';
      html += '<div style="font-size:13px;color:#666;margin-bottom:12px;">SSH Publishers</div>';
      html += '<div style="border:1px solid #eee;border-radius:6px;padding:12px;">';
      html += '<div style="font-weight:600;margin-bottom:8px;">\u2261 SSH Server</div>';
      html += '<label style="font-size:12px;">Name \uFF1F</label>';
      html += '<select id="cicdPostSsh' + idx + 'Host" data-value="' + (cfg.hostname||'') + '" style="width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;margin-bottom:8px;"><option value="">-- Select SSH Server --</option></select>';
      html += '<div style="margin-bottom:12px;"><div style="display:flex;align-items:center;gap:12px;"><button class="btn-primary btn-sm" onclick="cicdTogglePostBuildSshAdvanced(' + idx + ')" id="cicdPostSshAdvBtn' + idx + '" style="font-size:11px;padding:3px 8px;">advanced \u2228</button></div>';
      html += '<div id="cicdPostSshAdvPanel' + idx + '" style="display:none;margin-top:8px;margin-left:8px;padding:8px 12px;border-left:2px solid #eee;">';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox" checked> Verbose output in console \uFF1F</label></div>';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox"> Credentials \uFF1F</label></div>';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox"> Retry \uFF1F</label></div>';
      html += '<div style="margin-bottom:6px;"><label style="font-size:12px;"><input type="checkbox"> Label \uFF1F</label></div>';
      html += '</div></div>';
      html += '<div style="font-size:13px;font-weight:600;margin-top:12px;">Transfers</div>';
      html += '<div style="border:1px solid #eee;border-radius:4px;padding:10px;margin-top:6px;">';
      html += '<div style="font-weight:600;font-size:12px;margin-bottom:6px;">\u2261 Transfer Set</div>';
      html += '<label style="font-size:12px;">Source files \uFF1F</label><input type="text" id="cicdPostSsh' + idx + 'Src" value="' + (cfg.source_files||'') + '" style="margin-bottom:4px;">';
      html += '<div style="font-size:11px;color:#e74c3c;margin-bottom:6px;">\u26A0 Either Source files, Exec command or both must be supplied</div>';
      html += '<label style="font-size:12px;">Remove prefix \uFF1F</label><input type="text" id="cicdPostSsh' + idx + 'Prefix" value="' + (cfg.remove_prefix||'') + '" style="margin-bottom:6px;">';
      html += '<label style="font-size:12px;">Remote directory \uFF1F</label><input type="text" id="cicdPostSsh' + idx + 'RemoteDir" value="' + (cfg.remote_directory||'') + '" style="margin-bottom:6px;">';
      html += '<label style="font-size:12px;">Exec command \uFF1F</label><textarea id="cicdPostSsh' + idx + 'Cmd" rows="4" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;font-family:monospace;font-size:12px;resize:vertical;">' + (cfg.exec_command||'') + '</textarea>';
      html += '<div style="font-size:11px;color:#e74c3c;margin-top:4px;">\u26A0 Either Source files, Exec command or both must be supplied</div>';
      html += '<div style="font-size:11px;color:#4a90d9;margin-top:4px;">All of the transfer fields (except for Exec timeout) support substitution of environment variables</div>';
      html += '</div>';
      html += '<div style="margin-top:8px;"><button class="btn-primary btn-sm" onclick="showAlert(\'Coming soon\')">Add Transfer Set</button></div>';
      html += '</div>';
      html += '<div style="margin-top:8px;"><button class="btn-primary btn-sm" onclick="showAlert(\'Coming soon\')">Add Server</button></div>';
      html += '</div>';
    }
  });
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Collect & Save
// ---------------------------------------------------------------------------
function cicdCollectBuildSteps() {
  var steps = [];
  _cicdBuildSteps.forEach(function(step, idx) {
    if (step.type === 'ssh') {
      steps.push({ type:'ssh', config:{
        hostname: (document.getElementById('cicdSsh'+idx+'Host')||{}).value||'',
        source_files: (document.getElementById('cicdSsh'+idx+'Src')||{}).value||'',
        remove_prefix: (document.getElementById('cicdSsh'+idx+'Prefix')||{}).value||'',
        remote_directory: (document.getElementById('cicdSsh'+idx+'RemoteDir')||{}).value||'',
        exec_command: (document.getElementById('cicdSsh'+idx+'Cmd')||{}).value||''
      }});
    }
  });
  return steps;
}

function cicdCollectPostBuildSteps() {
  var steps = [];
  _cicdPostBuildSteps.forEach(function(step, idx) {
    if (step.type === 'ssh') {
      steps.push({ type:'ssh', config:{
        hostname: (document.getElementById('cicdPostSsh'+idx+'Host')||{}).value||'',
        source_files: (document.getElementById('cicdPostSsh'+idx+'Src')||{}).value||'',
        remove_prefix: (document.getElementById('cicdPostSsh'+idx+'Prefix')||{}).value||'',
        remote_directory: (document.getElementById('cicdPostSsh'+idx+'RemoteDir')||{}).value||'',
        exec_command: (document.getElementById('cicdPostSsh'+idx+'Cmd')||{}).value||''
      }});
    }
  });
  return steps;
}

function cicdCollectParams() {
  var params = [];
  _cicdParams.forEach(function(p, idx) {
    var param = { type: p.type, name: (document.getElementById('cicdParam'+idx+'Name')||{}).value||'', description: (document.getElementById('cicdParam'+idx+'Desc')||{}).value||'' };
    if (p.type === 'boolean') param.set_by_default = (document.getElementById('cicdParam'+idx+'Default')||{}).checked||false;
    else if (p.type === 'choice') param.choices = (document.getElementById('cicdParam'+idx+'Choices')||{}).value||'';
    else param.default_value = (document.getElementById('cicdParam'+idx+'Default')||{}).value||'';
    params.push(param);
  });
  return params;
}

async function cicdSaveItemConfig() {
  var payload = {
    name: _cicdCurrentItem,
    parent_view: _cicdCurrentView || '',
    enabled: document.getElementById('cicdItemEnabled').checked,
    description: document.getElementById('cicdItemDesc').value,
    build_steps: cicdCollectBuildSteps(),
    parameters: cicdCollectParams(),
    post_build: cicdCollectPostBuildSteps(),
    trigger_token: (document.getElementById('cicdTriggerToken')||{}).value||''
  };
  var res = await fetch('/cicd/items/update', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  showAlert('Configuration saved!');
  _cicdIsEditing = false;
  if (_cicdCurrentView) cicdOpenView(_cicdCurrentView); else cicdGoHome();
}

async function cicdApplyItemConfig() {
  var payload = {
    name: _cicdCurrentItem,
    parent_view: _cicdCurrentView || '',
    enabled: document.getElementById('cicdItemEnabled').checked,
    description: document.getElementById('cicdItemDesc').value,
    build_steps: cicdCollectBuildSteps(),
    parameters: cicdCollectParams(),
    post_build: cicdCollectPostBuildSteps(),
    trigger_token: (document.getElementById('cicdTriggerToken')||{}).value||''
  };
  var res = await fetch('/cicd/items/update', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  var data = await res.json();
  if (data.error) { showAlert(data.error); return; }
  showAlert('Configuration applied!');
}

async function cicdRunItem(itemName, parentView) {
  if (!confirm('Run "' + itemName + '"?')) return;
  showAlert('Building ' + itemName + '...');
  var res = await fetch('/cicd/items/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:itemName,parent_view:parentView||''}) });
  var data = await res.json();
  if (data.status === 'ok') showAlert('Build #' + data.build.number + ' succeeded! Duration: ' + data.build.duration);
  else { var o=''; if(data.build&&data.build.results) data.build.results.forEach(function(r){o+=r.output+'\n';}); showAlert('Build failed.\n'+o); }
  if (_cicdCurrentView) cicdOpenView(_cicdCurrentView); else cicdLoadHome();
}

function cicdSetIconSize(size) {}

async function cicdShowEditView(viewName) {
  _cicdCreateViewParent = '';
  var res = await fetch('/cicd/views'); var data = await res.json();
  var view = (data.views||[]).find(function(v){return v.name===viewName&&!v.parent;});
  cicdHideAll(); document.getElementById('cicdCreateView').style.display = '';
  document.getElementById('cicdNewViewName').value = viewName;
  var itemsRes = await fetch('/cicd/items'); var itemsData = await itemsRes.json();
  var items = itemsData.items||[]; var viewItems = view?(view.items||[]):[];
  var html = '';
  items.forEach(function(item) { var chk = viewItems.indexOf(item.name)>=0?' checked':''; html += '<label style="display:block;margin-bottom:4px;font-size:13px;"><input type="checkbox" value="'+item.name+'"'+chk+'> '+item.name+'</label>'; });
  if (!items.length) html = '<div style="color:#999;font-size:12px;">No items available</div>';
  document.getElementById('cicdViewItemCheckboxes').innerHTML = html;
}

function cicdInit() { cicdLoadHome(); }
