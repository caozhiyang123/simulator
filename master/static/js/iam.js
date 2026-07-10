// ---------------------------------------------------------------------------
// IAM Page Functions
// ---------------------------------------------------------------------------
var _iamUsers = [];
var _iamRoles = [];
var _iamAuthorities = [];
var _iamSelectedUser = null;
var _iamSelectedRole = null;
var _iamSelectedAuthority = null;

function iamSwitchTab(tab) {
  document.querySelectorAll('.iam-tab').forEach(function(el) {
    el.classList.remove('active');
    el.style.color = '#999';
    el.style.borderBottomColor = 'transparent';
  });
  document.querySelectorAll('.iam-panel').forEach(function(el) { el.style.display = 'none'; });
  var tabEl = document.getElementById('iamTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (tabEl) { tabEl.classList.add('active'); tabEl.style.color = '#4a90d9'; tabEl.style.borderBottomColor = '#4a90d9'; }
  var panelEl = document.getElementById('iamPanel' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (panelEl) panelEl.style.display = 'block';
  if (tab === 'users') iamLoadUsers();
  if (tab === 'roles') iamLoadRoles();
  if (tab === 'authorities') iamLoadAuthorities();
}

async function iamInit() { iamSwitchTab('users'); }

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------
async function iamLoadUsers() {
  try {
    var r = await fetch('/iam/users');
    var data = await r.json();
    _iamUsers = data.users || [];
    iamRenderUserList();
  } catch(e) { console.error('Failed to load IAM users', e); }
}

function iamRenderUserList() {
  var html = '';
  _iamUsers.forEach(function(u, idx) {
    var isSelected = _iamSelectedUser && _iamSelectedUser.username === u.username;
    var bg = isSelected ? '#e8f4fd' : '';
    var border = isSelected ? '1px solid #4a90d9' : '1px solid #f0f0f0';
    html += '<div onclick="iamSelectUser(' + idx + ')" style="padding:8px 12px;border:' + border + ';border-radius:4px;margin-bottom:4px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:' + bg + ';">';
    html += '<span style="font-size:13px;font-weight:500;">' + u.username + '</span>';
    var roleColor = u.role === 'admin' ? '#e74c3c' : (u.role === 'guest' ? '#95a5a6' : '#27ae60');
    html += '<span style="font-size:11px;color:' + roleColor + ';background:' + roleColor + '20;padding:2px 8px;border-radius:10px;">' + u.role + '</span>';
    html += '</div>';
  });
  document.getElementById('iamUserList').innerHTML = html;
}

function iamSelectUser(idx) {
  _iamSelectedUser = _iamUsers[idx];
  iamRenderUserList();
  iamRenderUserEdit();
}

function iamRenderUserEdit() {
  if (!_iamSelectedUser) {
    document.getElementById('iamUserEdit').innerHTML = '<span style="color:#999;font-size:12px;">Select a user to edit</span>';
    return;
  }
  var u = _iamSelectedUser;
  var isAdmin = u.username === 'admin';
  var html = '';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Username</label>';
  html += '<input type="text" value="' + u.username + '" disabled style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;background:#f9f9f9;box-sizing:border-box;">';
  html += '</div>';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">New Password (leave blank to keep unchanged)</label>';
  html += '<input type="password" id="iamEditPassword" placeholder="Enter new password" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">';
  html += '</div>';
  html += '<div style="margin-bottom:16px;">';
  html += '<label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Role' + (isAdmin ? ' <span style="color:#e74c3c;font-size:11px;">(locked)</span>' : '') + '</label>';
  html += '<select id="iamEditRole" ' + (isAdmin ? 'disabled' : '') + ' style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;' + (isAdmin ? 'background:#f9f9f9;cursor:not-allowed;' : '') + '">';
  var roles = ['admin', 'worker', 'guest'];
  roles.forEach(function(role) {
    html += '<option value="' + role + '"' + (u.role === role ? ' selected' : '') + '>' + role + '</option>';
  });
  html += '</select>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<button onclick="iamSaveUser()" style="background:#4a90d9;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:500;">Save</button>';
  if (!isAdmin) {
    html += '<button onclick="iamDeleteUser()" style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:500;">Delete</button>';
  }
  html += '<span id="iamSaveMsg" style="margin-left:8px;font-size:12px;"></span>';
  html += '</div>';
  document.getElementById('iamUserEdit').innerHTML = html;
}

async function iamSaveUser() {
  if (!_iamSelectedUser) return;
  var password = document.getElementById('iamEditPassword').value.trim();
  var role = document.getElementById('iamEditRole').value;
  var body = { username: _iamSelectedUser.username };
  if (password) body.password = password;
  if (_iamSelectedUser.username !== 'admin' && role) body.role = role;

  try {
    var r = await fetch('/iam/users/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
    var data = await r.json();
    var msgEl = document.getElementById('iamSaveMsg');
    if (r.ok) {
      msgEl.textContent = '✅ Saved'; msgEl.style.color = '#27ae60';
      _iamSelectedUser.role = role;
      iamLoadUsers();
      loadUserMenus();
    } else {
      msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c';
    }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to save user', e); }
}

async function iamDeleteUser() {
  if (!_iamSelectedUser) return;
  if (_iamSelectedUser.username === 'admin') return;
  if (!confirm('Are you sure you want to delete user "' + _iamSelectedUser.username + '"?')) return;
  try {
    var r = await fetch('/iam/users/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: _iamSelectedUser.username }) });
    var data = await r.json();
    if (r.ok) {
      _iamSelectedUser = null;
      iamLoadUsers();
      document.getElementById('iamUserEdit').innerHTML = '<span style="color:#27ae60;font-size:12px;">User deleted</span>';
    } else {
      alert(data.error || 'Delete failed');
    }
  } catch(e) { console.error('Failed to delete user', e); }
}

// ---------------------------------------------------------------------------
// Roles Tab
// ---------------------------------------------------------------------------
async function iamLoadRoles() {
  try {
    var r = await fetch('/iam/roles');
    var data = await r.json();
    _iamRoles = data.roles || [];
    // Also load authorities for the role editor
    var r2 = await fetch('/iam/authorities');
    var data2 = await r2.json();
    _iamAuthorities = data2.authorities || [];
    iamRenderRoles();
  } catch(e) { console.error('Failed to load roles', e); }
}

function iamRenderRoles() {
  var html = '<div style="display:flex;gap:16px;">';
  // Left: role list
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Role List</h4>';
  _iamRoles.forEach(function(role, idx) {
    var icon = role.role === 'admin' ? '👑' : (role.role === 'worker' ? '👷' : '👤');
    var color = role.role === 'admin' ? '#e74c3c' : (role.role === 'worker' ? '#27ae60' : '#95a5a6');
    var isSelected = _iamSelectedRole && _iamSelectedRole.role === role.role;
    var bg = isSelected ? '#e8f4fd' : '';
    var border = isSelected ? '1px solid #4a90d9' : '1px solid #f0f0f0';
    html += '<div onclick="iamSelectRole(' + idx + ')" style="padding:8px 12px;border:' + border + ';border-radius:4px;margin-bottom:4px;cursor:pointer;background:' + bg + ';display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:16px;">' + icon + '</span>';
    html += '<div style="flex:1;">';
    html += '<div style="font-size:13px;font-weight:600;color:' + color + ';">' + role.role + '</div>';
    var auths = role.authority.split(',').map(function(a){return a.trim();}).filter(Boolean);
    html += '<div style="font-size:11px;color:#888;">' + auths.join(', ') + '</div>';
    html += '</div></div>';
  });
  html += '</div>';
  // Right: role editor
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Edit Role Authorities</h4>';
  html += '<div id="iamRoleEdit" style="color:#999;font-size:12px;">Select a role to edit</div>';
  html += '</div></div>';
  document.getElementById('iamRoleList').innerHTML = html;
  if (_iamSelectedRole) iamRenderRoleEdit();
}

function iamSelectRole(idx) {
  _iamSelectedRole = _iamRoles[idx];
  iamRenderRoles();
}

function iamRenderRoleEdit() {
  if (!_iamSelectedRole) return;
  var role = _iamSelectedRole;
  var currentAuths = role.authority.split(',').map(function(a){return a.trim();}).filter(Boolean);
  var html = '';
  html += '<div style="margin-bottom:8px;font-size:13px;font-weight:600;">' + role.role + '</div>';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Assigned Authorities (check to assign)</label>';
  _iamAuthorities.forEach(function(auth) {
    var checked = currentAuths.indexOf(auth.authority) >= 0 ? 'checked' : '';
    html += '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;cursor:pointer;">';
    html += '<input type="checkbox" class="iam-role-auth-cb" value="' + auth.authority + '" ' + checked + '>';
    html += '<span>' + auth.authority + '</span>';
    html += '<span style="color:#aaa;font-size:11px;margin-left:4px;">(' + (auth.menus||[]).length + ' menus)</span>';
    html += '</label>';
  });
  html += '</div>';
  html += '<button onclick="iamSaveRole()" style="background:#4a90d9;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Save</button>';
  html += '<span id="iamRoleSaveMsg" style="margin-left:10px;font-size:12px;"></span>';
  // Show computed menus (union)
  html += '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #eee;">';
  html += '<div style="font-size:11px;color:#888;margin-bottom:4px;">Effective menus (union of selected authorities):</div>';
  html += '<div id="iamRoleEffectiveMenus" style="display:flex;flex-wrap:wrap;gap:4px;"></div>';
  html += '</div>';
  document.getElementById('iamRoleEdit').innerHTML = html;
  // Bind change events to update effective menus preview
  document.querySelectorAll('.iam-role-auth-cb').forEach(function(cb) {
    cb.addEventListener('change', iamUpdateRoleEffectiveMenus);
  });
  iamUpdateRoleEffectiveMenus();
}

function iamUpdateRoleEffectiveMenus() {
  var checked = [];
  document.querySelectorAll('.iam-role-auth-cb:checked').forEach(function(cb) { checked.push(cb.value); });
  // Compute union of menus
  var menusSet = {};
  checked.forEach(function(authName) {
    _iamAuthorities.forEach(function(a) {
      if (a.authority === authName) {
        (a.menus || []).forEach(function(m) { menusSet[m] = true; });
      }
    });
  });
  var allOrder = ['Home','Workers','Config','History','MD5','SHA1','Plugin','CICD','Play','IAM','Family'];
  var menus = allOrder.filter(function(m) { return menusSet[m]; });
  Object.keys(menusSet).forEach(function(m) { if (menus.indexOf(m) < 0) menus.push(m); });
  var el = document.getElementById('iamRoleEffectiveMenus');
  if (el) {
    el.innerHTML = menus.map(function(m) {
      return '<span style="background:#e8f4fd;padding:2px 8px;border-radius:10px;font-size:11px;color:#4a90d9;">' + m + '</span>';
    }).join('');
    if (menus.length === 0) el.innerHTML = '<span style="color:#ccc;font-size:11px;">No menus</span>';
  }
}

async function iamSaveRole() {
  if (!_iamSelectedRole) return;
  var checked = [];
  document.querySelectorAll('.iam-role-auth-cb:checked').forEach(function(cb) { checked.push(cb.value); });
  if (checked.length === 0) { alert('Please select at least one authority'); return; }
  try {
    var r = await fetch('/iam/roles/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ role: _iamSelectedRole.role, authorities: checked }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamRoleSaveMsg');
    if (r.ok) {
      msgEl.textContent = '✅ Saved'; msgEl.style.color = '#27ae60';
      _iamSelectedRole.authority = checked.join(',');
      iamLoadRoles();
      loadUserMenus();
    } else {
      msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c';
    }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to save role', e); }
}

// ---------------------------------------------------------------------------
// Authorities Tab
// ---------------------------------------------------------------------------
async function iamLoadAuthorities() {
  try {
    var r = await fetch('/iam/authorities');
    var data = await r.json();
    _iamAuthorities = data.authorities || [];
    iamRenderAuthorities();
  } catch(e) { console.error('Failed to load authorities', e); }
}

function iamRenderAuthorities() {
  var html = '<div style="display:flex;gap:16px;">';
  // Left: authority list
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;display:flex;justify-content:space-between;align-items:center;">Authority List <button onclick="iamShowCreateAuthority()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">+ New</button></h4>';
  _iamAuthorities.forEach(function(auth, idx) {
    var icon = auth.authority === 'administrator_privileges' ? '🛡️' : (auth.authority === 'worker_privileges' ? '🔧' : '👁️');
    var color = auth.authority === 'administrator_privileges' ? '#e74c3c' : (auth.authority === 'worker_privileges' ? '#f39c12' : '#95a5a6');
    var isSelected = _iamSelectedAuthority && _iamSelectedAuthority.authority === auth.authority;
    var bg = isSelected ? '#e8f4fd' : '';
    var border = isSelected ? '1px solid #4a90d9' : '1px solid #f0f0f0';
    html += '<div onclick="iamSelectAuthority(' + idx + ')" style="padding:8px 12px;border:' + border + ';border-radius:4px;margin-bottom:4px;cursor:pointer;background:' + bg + ';">';
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<span style="font-size:14px;">' + icon + '</span>';
    html += '<span style="font-size:13px;font-weight:600;color:' + color + ';">' + auth.authority + '</span>';
    html += '</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">';
    (auth.menus || []).forEach(function(m) {
      html += '<span style="background:#f0f0f0;padding:1px 6px;border-radius:8px;font-size:10px;color:#555;">' + m + '</span>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  // Right: authority editor
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Edit Authority</h4>';
  html += '<div id="iamAuthorityEdit" style="color:#999;font-size:12px;">Select an authority to edit</div>';
  html += '</div></div>';
  document.getElementById('iamAuthorityList').innerHTML = html;
  if (_iamSelectedAuthority) iamRenderAuthorityEdit();
}

function iamSelectAuthority(idx) {
  _iamSelectedAuthority = _iamAuthorities[idx];
  iamRenderAuthorities();
}

function iamRenderAuthorityEdit() {
  if (!_iamSelectedAuthority) return;
  var auth = _iamSelectedAuthority;
  var allMenus = ['Home','Workers','Config','History','MD5','SHA1','Plugin','CICD','Play','IAM','Family'];
  var html = '';
  html += '<div style="margin-bottom:8px;font-size:13px;font-weight:600;">' + auth.authority + '</div>';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Allowed Menus (check to grant access)</label>';
  allMenus.forEach(function(menu) {
    var checked = (auth.menus || []).indexOf(menu) >= 0 ? 'checked' : '';
    html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer;">';
    html += '<input type="checkbox" class="iam-auth-menu-cb" value="' + menu + '" ' + checked + '>';
    html += '<span>' + menu + '</span>';
    html += '</label>';
  });
  html += '</div>';
  html += '<button onclick="iamSaveAuthority()" style="background:#4a90d9;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Save</button>';
  html += '<span id="iamAuthSaveMsg" style="margin-left:10px;font-size:12px;"></span>';
  document.getElementById('iamAuthorityEdit').innerHTML = html;
}

async function iamSaveAuthority() {
  if (!_iamSelectedAuthority) return;
  var checked = [];
  document.querySelectorAll('.iam-auth-menu-cb:checked').forEach(function(cb) { checked.push(cb.value); });
  try {
    var r = await fetch('/iam/authorities/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ authority: _iamSelectedAuthority.authority, menus: checked }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamAuthSaveMsg');
    if (r.ok) {
      msgEl.textContent = '✅ Saved'; msgEl.style.color = '#27ae60';
      _iamSelectedAuthority.menus = checked;
      iamLoadAuthorities();
      loadUserMenus();
    } else {
      msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c';
    }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to save authority', e); }
}

function iamShowCreateAuthority() {
  var allMenus = ['Home','Workers','Config','History','MD5','SHA1','Plugin','CICD','Play','IAM','Family'];
  var html = '';
  html += '<div style="margin-bottom:8px;font-size:13px;font-weight:600;color:#27ae60;">Create New Authority</div>';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Authority Name</label>';
  html += '<input type="text" id="iamNewAuthName" placeholder="e.g. custom_privileges" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">';
  html += '</div>';
  html += '<div style="margin-bottom:12px;">';
  html += '<label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Allowed Menus</label>';
  allMenus.forEach(function(menu) {
    html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer;">';
    html += '<input type="checkbox" class="iam-new-auth-menu-cb" value="' + menu + '">';
    html += '<span>' + menu + '</span>';
    html += '</label>';
  });
  html += '</div>';
  html += '<button onclick="iamCreateAuthority()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Create</button>';
  html += '<span id="iamNewAuthMsg" style="margin-left:10px;font-size:12px;"></span>';
  document.getElementById('iamAuthorityEdit').innerHTML = html;
  _iamSelectedAuthority = null;
}

async function iamCreateAuthority() {
  var name = document.getElementById('iamNewAuthName').value.trim();
  if (!name) { alert('Please enter an authority name'); return; }
  var checked = [];
  document.querySelectorAll('.iam-new-auth-menu-cb:checked').forEach(function(cb) { checked.push(cb.value); });
  try {
    var r = await fetch('/iam/authorities/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ authority: name, menus: checked }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamNewAuthMsg');
    if (r.ok) {
      msgEl.textContent = '✅ Created'; msgEl.style.color = '#27ae60';
      iamLoadAuthorities();
    } else {
      msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c';
    }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to create authority', e); }
}

// ---------------------------------------------------------------------------
// Menu Filtering by Authority
// ---------------------------------------------------------------------------
var _userAllowedMenus = null;

var _menuNavMap = {
  'Home': 'navHome',
  'Workers': 'navWorkers',
  'Config': 'navConfig',
  'History': 'navHistory',
  'MD5': 'navMd5',
  'SHA1': 'navSha1',
  'Plugin': 'navPlugin',
  'CICD': 'navCicd',
  'Play': 'navPlay',
  'IAM': 'navIam',
  'Family': 'navFamily'
};

async function loadUserMenus() {
  try {
    var r = await fetch('/iam/menus');
    if (!r.ok) return;
    var data = await r.json();
    _userAllowedMenus = data.menus || [];
    applyMenuFiltering();
  } catch(e) { console.error('Failed to load user menus', e); }
}

function applyMenuFiltering() {
  if (!_userAllowedMenus) return;
  Object.keys(_menuNavMap).forEach(function(menuName) {
    var navId = _menuNavMap[menuName];
    var navEl = document.getElementById(navId);
    if (!navEl) return;
    var wrapper = navEl.closest('div[style*="position:relative"]');
    if (_userAllowedMenus.indexOf(menuName) >= 0) {
      if (wrapper && menuName === 'Plugin') { wrapper.style.display = ''; }
      else { navEl.style.display = ''; }
    } else {
      if (wrapper && menuName === 'Plugin') { wrapper.style.display = 'none'; }
      else { navEl.style.display = 'none'; }
    }
  });
  var activePage = '';
  document.querySelectorAll('.page-panel').forEach(function(el) {
    if (el.classList.contains('active')) { activePage = el.id.replace('page', '').toLowerCase(); }
  });
  var pageToMenu = {
    'home': 'Home', 'workers': 'Workers', 'config': 'Config',
    'history': 'History', 'md5': 'MD5', 'sha1': 'SHA1',
    'compare': 'Plugin', 'formatjson': 'Plugin', 'batchoverride': 'Plugin',
    'formattime': 'Plugin', 'cardgen': 'Plugin', 'patterncomb': 'Plugin', 'patterncalc': 'Plugin',
    'cicd': 'CICD', 'cicdsettings': 'CICD', 'play': 'Play', 'iam': 'IAM', 'family': 'Family'
  };
  var currentMenu = pageToMenu[activePage] || '';
  if (currentMenu && _userAllowedMenus.indexOf(currentMenu) < 0) {
    var firstMenu = _userAllowedMenus[0] || 'Play';
    var pageMap = { 'Home': 'home', 'Workers': 'workers', 'Config': 'config', 'History': 'history', 'MD5': 'md5', 'SHA1': 'sha1', 'Plugin': 'compare', 'CICD': 'cicd', 'Play': 'play', 'IAM': 'iam', 'Family': 'family' };
    switchPage(pageMap[firstMenu] || 'play');
  }
}
