// ---------------------------------------------------------------------------
// IAM Page Functions
// ---------------------------------------------------------------------------
var _iamUsers = [];
var _iamRoles = [];
var _iamAuthorities = [];
var _iamResources = [];
var _iamSelectedUser = null;
var _iamSelectedRole = null;
var _iamSelectedAuthority = null;
var _iamSelectedResourceIdx = -1;

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
  if (tab === 'resources') iamLoadResources();
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
  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
  html += '<span style="font-size:13px;color:#666;font-weight:500;">Users</span>';
  html += '<button onclick="iamShowCreateUser()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">+ New</button>';
  html += '</div>';
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
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Username</label>';
  html += '<input type="text" value="' + u.username + '" disabled style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;background:#f9f9f9;box-sizing:border-box;"></div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">New Password (leave blank to keep unchanged)</label>';
  html += '<input type="password" id="iamEditPassword" placeholder="Enter new password" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;"></div>';
  html += '<div style="margin-bottom:16px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Role' + (isAdmin ? ' <span style="color:#e74c3c;font-size:11px;">(locked)</span>' : '') + '</label>';
  html += '<select id="iamEditRole" ' + (isAdmin ? 'disabled' : '') + ' style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;' + (isAdmin ? 'background:#f9f9f9;cursor:not-allowed;' : '') + '">';
  ['admin', 'worker', 'guest'].forEach(function(role) {
    html += '<option value="' + role + '"' + (u.role === role ? ' selected' : '') + '>' + role + '</option>';
  });
  html += '</select></div>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<button onclick="iamSaveUser()" style="background:#4a90d9;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:500;">Save</button>';
  if (!isAdmin) html += '<button onclick="iamDeleteUser()" style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:500;">Delete</button>';
  html += '<span id="iamSaveMsg" style="margin-left:8px;font-size:12px;"></span></div>';
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
    if (r.ok) { msgEl.textContent = '✅ Saved'; msgEl.style.color = '#27ae60'; _iamSelectedUser.role = role; iamLoadUsers(); loadUserMenus(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to save user', e); }
}

async function iamDeleteUser() {
  if (!_iamSelectedUser || _iamSelectedUser.username === 'admin') return;
  // No upper-level reference check for users (top level)
  iamShowDeleteConfirm('user', _iamSelectedUser.username, function() {
    fetch('/iam/users/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: _iamSelectedUser.username }) })
    .then(function(r) { if (r.ok) { _iamSelectedUser = null; iamLoadUsers(); document.getElementById('iamUserEdit').innerHTML = '<span style="color:#27ae60;font-size:12px;">User deleted</span>'; } else { r.json().then(function(d){alert(d.error||'Delete failed');}); } });
  });
}

function iamShowCreateUser() {
  _iamSelectedUser = null;
  iamRenderUserList();
  var html = '<div style="margin-bottom:8px;font-size:13px;font-weight:600;color:#27ae60;">Create New User</div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Username</label>';
  html += '<input type="text" id="iamNewUsername" placeholder="Enter username" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;"></div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Password</label>';
  html += '<input type="password" id="iamNewPassword" placeholder="Enter password" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;"></div>';
  html += '<div style="margin-bottom:16px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Role</label>';
  html += '<select id="iamNewUserRole" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">';
  ['worker', 'guest', 'admin'].forEach(function(role) { html += '<option value="' + role + '">' + role + '</option>'; });
  html += '</select></div>';
  html += '<button onclick="iamCreateUser()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Create</button>';
  html += '<span id="iamSaveMsg" style="margin-left:10px;font-size:12px;"></span>';
  document.getElementById('iamUserEdit').innerHTML = html;
}

async function iamCreateUser() {
  var username = document.getElementById('iamNewUsername').value.trim();
  var password = document.getElementById('iamNewPassword').value.trim();
  var role = document.getElementById('iamNewUserRole').value;
  if (!username) { alert('Please enter a username'); return; }
  if (!password) { alert('Please enter a password'); return; }
  try {
    var r = await fetch('/iam/users/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: username, password: password, role: role }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamSaveMsg');
    if (r.ok) { msgEl.textContent = '✅ Created'; msgEl.style.color = '#27ae60'; iamLoadUsers(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to create user', e); }
}

// ---------------------------------------------------------------------------
// Roles Tab
// ---------------------------------------------------------------------------
async function iamLoadRoles() {
  try {
    var r = await fetch('/iam/roles');
    _iamRoles = (await r.json()).roles || [];
    var r2 = await fetch('/iam/authorities');
    _iamAuthorities = (await r2.json()).authorities || [];
    iamRenderRoles();
  } catch(e) { console.error('Failed to load roles', e); }
}

function iamRenderRoles() {
  var html = '<div style="display:flex;gap:16px;">';
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;display:flex;justify-content:space-between;align-items:center;">Role List <button onclick="iamShowCreateRole()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">+ New</button></h4>';
  _iamRoles.forEach(function(role, idx) {
    var icon = role.role === 'admin' ? '👑' : (role.role === 'worker' ? '👷' : '👤');
    var color = role.role === 'admin' ? '#e74c3c' : (role.role === 'worker' ? '#27ae60' : '#95a5a6');
    var isSelected = _iamSelectedRole && _iamSelectedRole.role === role.role;
    var bg = isSelected ? '#e8f4fd' : ''; var border = isSelected ? '1px solid #4a90d9' : '1px solid #f0f0f0';
    html += '<div onclick="iamSelectRole(' + idx + ')" style="padding:8px 12px;border:' + border + ';border-radius:4px;margin-bottom:4px;cursor:pointer;background:' + bg + ';display:flex;align-items:center;gap:8px;">';
    html += '<span style="font-size:16px;">' + icon + '</span><div style="flex:1;">';
    html += '<div style="font-size:13px;font-weight:600;color:' + color + ';">' + role.role + '</div>';
    var auths = role.authority.split(',').map(function(a){return a.trim();}).filter(Boolean);
    html += '<div style="font-size:11px;color:#888;">' + auths.join(', ') + '</div></div></div>';
  });
  html += '</div>';
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;"><h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Edit Role Authorities</h4>';
  html += '<div id="iamRoleEdit" style="color:#999;font-size:12px;">Select a role to edit</div></div></div>';
  document.getElementById('iamRoleList').innerHTML = html;
  if (_iamSelectedRole) iamRenderRoleEdit();
}

function iamSelectRole(idx) { _iamSelectedRole = _iamRoles[idx]; iamRenderRoles(); }

function iamRenderRoleEdit() {
  if (!_iamSelectedRole) return;
  var role = _iamSelectedRole; var isAdmin = role.role === 'admin';
  var currentAuths = role.authority.split(',').map(function(a){return a.trim();}).filter(Boolean);
  var html = '<div style="margin-bottom:8px;font-size:13px;font-weight:600;">' + role.role + '</div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Assigned Authorities</label>';
  _iamAuthorities.forEach(function(auth) {
    var checked = currentAuths.indexOf(auth.authority) >= 0 ? 'checked' : '';
    var locked = isAdmin && auth.authority === 'administrator_privileges';
    var disabledAttr = locked ? 'disabled checked' : checked;
    var lockStyle = locked ? 'opacity:0.7;cursor:not-allowed;' : 'cursor:pointer;';
    html += '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;' + lockStyle + '">';
    html += '<input type="checkbox" class="iam-role-auth-cb" value="' + auth.authority + '" ' + disabledAttr + '>';
    html += '<span>' + auth.authority + '</span>';
    html += locked ? '<span style="color:#e74c3c;font-size:10px;margin-left:4px;">(required)</span>' : '<span style="color:#aaa;font-size:11px;margin-left:4px;">(' + (auth.menus||[]).length + ' resources)</span>';
    html += '</label>';
  });
  html += '</div>';
  html += '<button onclick="iamSaveRole()" style="background:#4a90d9;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Save</button>';
  if (!isAdmin) html += '<button onclick="iamDeleteRole()" style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;margin-left:8px;">Delete</button>';
  html += '<span id="iamRoleSaveMsg" style="margin-left:10px;font-size:12px;"></span>';
  html += '<div style="margin-top:12px;padding-top:8px;border-top:1px solid #eee;"><div style="font-size:11px;color:#888;margin-bottom:4px;">Effective resources (union):</div>';
  html += '<div id="iamRoleEffectiveMenus" style="display:flex;flex-wrap:wrap;gap:4px;"></div></div>';
  document.getElementById('iamRoleEdit').innerHTML = html;
  document.querySelectorAll('.iam-role-auth-cb').forEach(function(cb) { cb.addEventListener('change', iamUpdateRoleEffectiveMenus); });
  iamUpdateRoleEffectiveMenus();
}

function iamUpdateRoleEffectiveMenus() {
  var checked = [];
  document.querySelectorAll('.iam-role-auth-cb').forEach(function(cb) { if (cb.checked) checked.push(cb.value); });
  var menusSet = {};
  checked.forEach(function(authName) { _iamAuthorities.forEach(function(a) { if (a.authority === authName) (a.menus||[]).forEach(function(m){menusSet[m]=true;}); }); });
  var menus = Object.keys(menusSet);
  var el = document.getElementById('iamRoleEffectiveMenus');
  if (el) {
    el.innerHTML = menus.length ? menus.map(function(m) { return '<span style="background:#e8f4fd;padding:2px 8px;border-radius:10px;font-size:11px;color:#4a90d9;">' + m + '</span>'; }).join('') : '<span style="color:#ccc;font-size:11px;">No resources</span>';
  }
}

async function iamSaveRole() {
  if (!_iamSelectedRole) return;
  var checked = [];
  document.querySelectorAll('.iam-role-auth-cb:checked').forEach(function(cb) { checked.push(cb.value); });
  if (_iamSelectedRole.role === 'admin' && checked.indexOf('administrator_privileges') < 0) checked.unshift('administrator_privileges');
  if (checked.length === 0) { alert('Please select at least one authority'); return; }
  try {
    var r = await fetch('/iam/roles/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ role: _iamSelectedRole.role, authorities: checked }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamRoleSaveMsg');
    if (r.ok) { msgEl.textContent = '✅ Saved'; msgEl.style.color = '#27ae60'; _iamSelectedRole.authority = checked.join(','); iamLoadRoles(); loadUserMenus(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to save role', e); }
}

function iamShowCreateRole() {
  _iamSelectedRole = null;
  iamRenderRoles();
  var html = '<div style="margin-bottom:8px;font-size:13px;font-weight:600;color:#27ae60;">Create New Role</div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Role Name</label>';
  html += '<input type="text" id="iamNewRoleName" placeholder="e.g. editor" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;"></div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Initial Authority</label>';
  _iamAuthorities.forEach(function(auth) {
    html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer;">';
    html += '<input type="checkbox" class="iam-new-role-auth-cb" value="' + auth.authority + '"><span>' + auth.authority + '</span></label>';
  });
  html += '</div>';
  html += '<button onclick="iamCreateRole()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Create</button>';
  html += '<span id="iamRoleSaveMsg" style="margin-left:10px;font-size:12px;"></span>';
  document.getElementById('iamRoleEdit').innerHTML = html;
}

async function iamCreateRole() {
  var name = document.getElementById('iamNewRoleName').value.trim();
  if (!name) { alert('Please enter a role name'); return; }
  var checked = [];
  document.querySelectorAll('.iam-new-role-auth-cb:checked').forEach(function(cb) { checked.push(cb.value); });
  try {
    var r = await fetch('/iam/roles/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ role: name, authority: checked.join(',') }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamRoleSaveMsg');
    if (r.ok) { msgEl.textContent = '✅ Created'; msgEl.style.color = '#27ae60'; iamLoadRoles(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to create role', e); }
}

async function iamDeleteRole() {
  if (!_iamSelectedRole || _iamSelectedRole.role === 'admin') return;
  // Client-side check: is this role referenced by any user?
  // Fetch fresh user list for validation
  try {
    var ur = await fetch('/iam/users');
    var ud = await ur.json();
    var users = ud.users || [];
    var refUsers = users.filter(function(u) { return u.role === _iamSelectedRole.role; });
    if (refUsers.length > 0) {
      alert('Cannot delete: role "' + _iamSelectedRole.role + '" is referenced by user(s): ' + refUsers.map(function(u){return u.username;}).join(', '));
      return;
    }
  } catch(e) { /* proceed to server-side check */ }
  iamShowDeleteConfirm('role', _iamSelectedRole.role, function() {
    fetch('/iam/roles/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ role: _iamSelectedRole.role }) })
    .then(function(r) { if (r.ok) { _iamSelectedRole = null; iamLoadRoles(); } else { r.json().then(function(d){alert(d.error||'Delete failed');}); } });
  });
}

// ---------------------------------------------------------------------------
// Authorities Tab (resources loaded from /iam/resources)
// ---------------------------------------------------------------------------
async function iamLoadAuthorities() {
  try {
    var r = await fetch('/iam/authorities');
    _iamAuthorities = (await r.json()).authorities || [];
    var r2 = await fetch('/iam/resources');
    _iamResources = (await r2.json()).resources || [];
    iamRenderAuthorities();
  } catch(e) { console.error('Failed to load authorities', e); }
}

function iamRenderAuthorities() {
  var html = '<div style="display:flex;gap:16px;">';
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;display:flex;justify-content:space-between;align-items:center;">Authority List <button onclick="iamShowCreateAuthority()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">+ New</button></h4>';
  _iamAuthorities.forEach(function(auth, idx) {
    var icon = auth.authority === 'administrator_privileges' ? '🛡️' : (auth.authority === 'worker_privileges' ? '🔧' : '👁️');
    var color = auth.authority === 'administrator_privileges' ? '#e74c3c' : (auth.authority === 'worker_privileges' ? '#f39c12' : '#95a5a6');
    var isSelected = _iamSelectedAuthority && _iamSelectedAuthority.authority === auth.authority;
    var bg = isSelected ? '#e8f4fd' : ''; var border = isSelected ? '1px solid #4a90d9' : '1px solid #f0f0f0';
    html += '<div onclick="iamSelectAuthority(' + idx + ')" style="padding:8px 12px;border:' + border + ';border-radius:4px;margin-bottom:4px;cursor:pointer;background:' + bg + ';">';
    html += '<div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;">' + icon + '</span><span style="font-size:13px;font-weight:600;color:' + color + ';">' + auth.authority + '</span></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">';
    (auth.menus||[]).forEach(function(m) { html += '<span style="background:#f0f0f0;padding:1px 6px;border-radius:8px;font-size:10px;color:#555;">' + m + '</span>'; });
    html += '</div></div>';
  });
  html += '</div>';
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;"><h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Edit Authority</h4>';
  html += '<div id="iamAuthorityEdit" style="color:#999;font-size:12px;">Select an authority to edit</div></div></div>';
  document.getElementById('iamAuthorityList').innerHTML = html;
  if (_iamSelectedAuthority) iamRenderAuthorityEdit();
}

function iamSelectAuthority(idx) { _iamSelectedAuthority = _iamAuthorities[idx]; iamRenderAuthorities(); }

function iamRenderAuthorityEdit() {
  if (!_iamSelectedAuthority) return;
  var auth = _iamSelectedAuthority;
  var defaultResources = ['Home','Workers','Config','History','MD5','SHA1','Plugin','CICD','Play','IAM','Family'];
  var isAdminAuth = auth.authority === 'administrator_privileges';
  var html = '<div style="margin-bottom:8px;font-size:13px;font-weight:600;">' + auth.authority + '</div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Allowed Resources (check to grant access)</label>';
  _iamResources.forEach(function(res) {
    var checked = (auth.menus || []).indexOf(res) >= 0 ? 'checked' : '';
    // For administrator_privileges + default resources: locked
    var locked = isAdminAuth && defaultResources.indexOf(res) >= 0;
    var disabledAttr = locked ? 'disabled checked' : checked;
    var lockStyle = locked ? 'opacity:0.7;cursor:not-allowed;' : 'cursor:pointer;';
    html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;' + lockStyle + '">';
    html += '<input type="checkbox" class="iam-auth-menu-cb" value="' + res + '" ' + disabledAttr + '>';
    html += '<span>' + res + '</span>';
    if (locked) html += '<span style="color:#e74c3c;font-size:10px;margin-left:4px;">(required)</span>';
    html += '</label>';
  });
  html += '</div>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<button onclick="iamSaveAuthority()" style="background:#4a90d9;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Save</button>';
  if (!isAdminAuth) html += '<button onclick="iamDeleteAuthority()" style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Delete</button>';
  html += '<span id="iamAuthSaveMsg" style="margin-left:10px;font-size:12px;"></span>';
  html += '</div>';
  document.getElementById('iamAuthorityEdit').innerHTML = html;
}

async function iamSaveAuthority() {
  if (!_iamSelectedAuthority) return;
  var checked = [];
  document.querySelectorAll('.iam-auth-menu-cb:checked').forEach(function(cb) { checked.push(cb.value); });
  // For administrator_privileges, ensure all default resources are included
  if (_iamSelectedAuthority.authority === 'administrator_privileges') {
    var defaultResources = ['Home','Workers','Config','History','MD5','SHA1','Plugin','CICD','Play','IAM','Family'];
    defaultResources.forEach(function(m) { if (checked.indexOf(m) < 0) checked.push(m); });
  }
  try {
    var r = await fetch('/iam/authorities/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ authority: _iamSelectedAuthority.authority, menus: checked }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamAuthSaveMsg');
    if (r.ok) { msgEl.textContent = '✅ Saved'; msgEl.style.color = '#27ae60'; _iamSelectedAuthority.menus = checked; iamLoadAuthorities(); loadUserMenus(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to save authority', e); }
}

async function iamDeleteAuthority() {
  if (!_iamSelectedAuthority || _iamSelectedAuthority.authority === 'administrator_privileges') return;
  // Client-side check: is this authority referenced by any role?
  // Fetch fresh roles for validation
  try {
    var rr = await fetch('/iam/roles');
    var rd = await rr.json();
    var roles = rd.roles || [];
    var refRoles = roles.filter(function(r) {
      var auths = r.authority.split(',').map(function(a){return a.trim();}).filter(Boolean);
      return auths.indexOf(_iamSelectedAuthority.authority) >= 0;
    });
    if (refRoles.length > 0) {
      alert('Cannot delete: authority "' + _iamSelectedAuthority.authority + '" is referenced by role(s): ' + refRoles.map(function(r){return r.role;}).join(', '));
      return;
    }
  } catch(e) { /* proceed to server-side check */ }
  iamShowDeleteConfirm('authority', _iamSelectedAuthority.authority, function() {
    fetch('/iam/authorities/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ authority: _iamSelectedAuthority.authority }) })
    .then(function(r) { if (r.ok) { _iamSelectedAuthority = null; iamLoadAuthorities(); loadUserMenus(); } else { r.json().then(function(d){alert(d.error||'Delete failed');}); } });
  });
}

function iamShowCreateAuthority() {
  var html = '<div style="margin-bottom:8px;font-size:13px;font-weight:600;color:#27ae60;">Create New Authority</div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Authority Name</label>';
  html += '<input type="text" id="iamNewAuthName" placeholder="e.g. custom_privileges" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;"></div>';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:6px;">Allowed Resources</label>';
  _iamResources.forEach(function(res) {
    html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer;">';
    html += '<input type="checkbox" class="iam-new-auth-menu-cb" value="' + res + '"><span>' + res + '</span></label>';
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
    if (r.ok) { msgEl.textContent = '✅ Created'; msgEl.style.color = '#27ae60'; iamLoadAuthorities(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to create authority', e); }
}

// ---------------------------------------------------------------------------
// Resources Tab
// ---------------------------------------------------------------------------
async function iamLoadResources() {
  try {
    var r = await fetch('/iam/resources');
    _iamResources = (await r.json()).resources || [];
    iamRenderResources();
  } catch(e) { console.error('Failed to load resources', e); }
}

function iamRenderResources() {
  var html = '<div style="display:flex;gap:16px;">';
  // Left: resource list
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Resource List</h4>';
  _iamResources.forEach(function(res, idx) {
    var isSelected = _iamSelectedResourceIdx === idx;
    var bg = isSelected ? '#e8f4fd' : '';
    var border = isSelected ? '1px solid #4a90d9' : '1px solid #f0f0f0';
    html += '<div onclick="iamSelectResource(' + idx + ')" style="padding:6px 12px;border:' + border + ';border-radius:4px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;background:' + bg + ';">';
    html += '<span style="font-size:13px;">' + res + '</span>';
    html += '</div>';
  });
  html += '</div>';
  // Right: edit/create
  html += '<div style="flex:1;border:1px solid #eee;border-radius:6px;padding:12px;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Manage Resource</h4>';
  html += '<div id="iamResourceEdit" style="color:#999;font-size:12px;">Select a resource to edit, or create a new one below</div>';
  html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">';
  html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#666;">Create Resource</h4>';
  html += '<div style="display:flex;gap:6px;">';
  html += '<input type="text" id="iamNewResourceName" placeholder="e.g. Reports" style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">';
  html += '<button onclick="iamCreateResource()" style="background:#27ae60;color:#fff;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;">Create</button>';
  html += '</div>';
  html += '<span id="iamResMsg" style="font-size:12px;"></span>';
  html += '</div></div></div>';
  document.getElementById('iamResourceList').innerHTML = html;
  if (_iamSelectedResourceIdx >= 0 && _iamSelectedResourceIdx < _iamResources.length) {
    iamRenderResourceEdit();
  }
}

function iamSelectResource(idx) {
  _iamSelectedResourceIdx = idx;
  iamRenderResources();
}

function iamRenderResourceEdit() {
  if (_iamSelectedResourceIdx < 0 || _iamSelectedResourceIdx >= _iamResources.length) return;
  var res = _iamResources[_iamSelectedResourceIdx];
  var html = '';
  html += '<div style="margin-bottom:12px;"><label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">Resource Name</label>';
  html += '<input type="text" id="iamEditResourceName" value="' + res + '" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;"></div>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<button onclick="iamRenameResource()" style="background:#4a90d9;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Rename</button>';
  html += '<button onclick="iamDeleteResource()" style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Delete</button>';
  html += '<span id="iamResEditMsg" style="margin-left:8px;font-size:12px;"></span>';
  html += '</div>';
  document.getElementById('iamResourceEdit').innerHTML = html;
}

async function iamRenameResource() {
  if (_iamSelectedResourceIdx < 0) return;
  var oldName = _iamResources[_iamSelectedResourceIdx];
  var newName = document.getElementById('iamEditResourceName').value.trim();
  if (!newName) { alert('Please enter a name'); return; }
  if (newName === oldName) return;
  try {
    var r = await fetch('/iam/resources/rename', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ old_name: oldName, new_name: newName }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamResEditMsg');
    if (r.ok) { msgEl.textContent = '✅ Renamed'; msgEl.style.color = '#27ae60'; iamLoadResources(); loadUserMenus(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to rename resource', e); }
}

async function iamDeleteResource() {
  if (_iamSelectedResourceIdx < 0) return;
  var name = _iamResources[_iamSelectedResourceIdx];
  // Client-side check: is this resource referenced by any authority?
  var refAuths = _iamAuthorities.filter(function(a) { return (a.menus || []).indexOf(name) >= 0; });
  if (refAuths.length > 0) {
    alert('Cannot delete: resource "' + name + '" is referenced by authority(ies): ' + refAuths.map(function(a){return a.authority;}).join(', '));
    return;
  }
  iamShowDeleteConfirm('resource', name, function() {
    fetch('/iam/resources/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ resource: name }) })
    .then(function(r) { if (r.ok) { _iamSelectedResourceIdx = -1; iamLoadResources(); loadUserMenus(); } else { r.json().then(function(d){alert(d.error||'Delete failed');}); } });
  });
}

async function iamCreateResource() {
  var name = document.getElementById('iamNewResourceName').value.trim();
  if (!name) { alert('Please enter a resource name'); return; }
  try {
    var r = await fetch('/iam/resources/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ resource: name }) });
    var data = await r.json();
    var msgEl = document.getElementById('iamResMsg');
    if (r.ok) { msgEl.textContent = '✅ Created'; msgEl.style.color = '#27ae60'; iamLoadResources(); }
    else { msgEl.textContent = '❌ ' + (data.error || 'Failed'); msgEl.style.color = '#e74c3c'; }
    setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 3000);
  } catch(e) { console.error('Failed to create resource', e); }
}

// ---------------------------------------------------------------------------
// Delete Confirmation Modal
// ---------------------------------------------------------------------------
function iamShowDeleteConfirm(type, name, onConfirm) {
  // Create modal overlay
  var overlay = document.createElement('div');
  overlay.id = 'iamDeleteModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;';
  var modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:8px;padding:24px;max-width:400px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
  modal.innerHTML = '<div style="font-size:16px;font-weight:600;color:#e74c3c;margin-bottom:12px;">⚠️ Confirm Deletion</div>'
    + '<div style="font-size:13px;color:#333;margin-bottom:16px;">You are about to delete ' + type + ' <strong>"' + name + '"</strong>. This action cannot be undone.</div>'
    + '<div style="font-size:12px;color:#666;margin-bottom:8px;">Type <strong>Permanently</strong> to confirm:</div>'
    + '<input type="text" id="iamDeleteConfirmInput" placeholder="Permanently" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;margin-bottom:16px;">'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    + '<button id="iamDeleteCancelBtn" style="background:#eee;color:#333;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:13px;">Cancel</button>'
    + '<button id="iamDeleteConfirmBtn" style="background:#ccc;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:not-allowed;font-size:13px;" disabled>Delete</button>'
    + '</div>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  var input = document.getElementById('iamDeleteConfirmInput');
  var confirmBtn = document.getElementById('iamDeleteConfirmBtn');
  var cancelBtn = document.getElementById('iamDeleteCancelBtn');

  input.addEventListener('input', function() {
    if (input.value.trim() === 'Permanently') {
      confirmBtn.disabled = false;
      confirmBtn.style.background = '#e74c3c';
      confirmBtn.style.cursor = 'pointer';
    } else {
      confirmBtn.disabled = true;
      confirmBtn.style.background = '#ccc';
      confirmBtn.style.cursor = 'not-allowed';
    }
  });

  cancelBtn.addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

  confirmBtn.addEventListener('click', function() {
    if (input.value.trim() === 'Permanently') {
      overlay.remove();
      onConfirm();
    }
  });

  input.focus();
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

function iamRemoveLoadingOverlay() {
  var overlay = document.getElementById('iamLoadingOverlay');
  if (overlay) {
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    setTimeout(function() { overlay.remove(); }, 300);
  }
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
  // Quick Guide: show/hide floating guide based on permission
  var guideFloat = document.getElementById('guideFloat');
  var guideShowBtn = document.getElementById('guideShowBtn');
  if (_userAllowedMenus.indexOf('Quick Guide') >= 0) {
    if (guideFloat) guideFloat.style.display = '';
    // guideShowBtn stays hidden until user closes the guide
  } else {
    if (guideFloat) guideFloat.style.display = 'none';
    if (guideShowBtn) guideShowBtn.style.display = 'none';
  }
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
