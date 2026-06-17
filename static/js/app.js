let currentPage = 'home';
let skillsData = [];
let agentsData = [];
let chatHistory = [];
let refreshTimer = null;

function toggleSidebar() {
  const s = document.getElementById('sidebar');
  const b = document.getElementById('sidebar-backdrop');
  s.classList.toggle('collapsed');
  if (b) b.classList.toggle('visible', !s.classList.contains('collapsed'));
}
function initSidebar() {
  const s = document.getElementById('sidebar');
  if (window.innerWidth < 768) s.classList.add('collapsed');
}
function toggleSection(id) {
  document.getElementById('items-' + id).classList.toggle('collapsed');
  document.getElementById('arrow-' + id).classList.toggle('collapsed');
}
function updateClock() { document.getElementById('clock').textContent = new Date().toLocaleTimeString(); }
setInterval(updateClock, 1000); updateClock();

function startAutoRefresh() {
  stopAutoRefresh();
  document.getElementById('live-dot').style.display = 'inline-block';
  refreshTimer = setInterval(() => { if (currentPage === 'home' || currentPage === 'monitor') refreshCurrentPage(); }, 8000);
}
function stopAutoRefresh() { if (refreshTimer) clearInterval(refreshTimer); const d = document.getElementById('live-dot'); if (d) d.style.display = 'none'; }

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const m = {1:'home',2:'chat',3:'agents',4:'skills',5:'models',6:'history',7:'monitor',8:'usage',9:'sessions',0:'cron'};
  if (m[e.key] && !e.ctrlKey && !e.metaKey) { navigateTo(m[e.key]); return; }
  if (e.key === 'r' && !e.ctrlKey) { refreshCurrentPage(); }
});

document.addEventListener('DOMContentLoaded', () => { checkAuth(); initSidebar();
  document.querySelectorAll('.side-link').forEach(l => l.addEventListener('click', (e) => { e.preventDefault(); navigateTo(l.dataset.page); })); });

async function checkAuth() {
  try {
    const r = await fetch('/api/auth/check');
    const d = await r.json();
    if (d.ok) { document.getElementById('login-overlay').style.display = 'none'; document.getElementById('app').style.display = 'flex'; startAutoRefresh(); navigateTo('home'); }
    else { document.getElementById('login-overlay').style.display = 'flex'; document.getElementById('app').style.display = 'none'; }
  } catch(e) { document.getElementById('login-overlay').style.display = 'flex'; document.getElementById('app').style.display = 'none'; }
}

async function doLogin(e) {
  e.preventDefault();
  const u = document.getElementById('login-username').value;
  const p = document.getElementById('login-password').value;
  try {
    const r = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u, password:p}) });
    const d = await r.json();
    if (d.ok) { document.getElementById('login-overlay').style.display = 'none'; document.getElementById('app').style.display = 'flex'; startAutoRefresh(); navigateTo('home'); }
    else { document.getElementById('login-error').textContent = d.error || 'Invalid'; }
  } catch(e) { document.getElementById('login-error').textContent = 'Connection error'; }
}

async function doLogout() { stopAutoRefresh(); await fetch('/api/logout', {method:'POST'}); document.getElementById('login-overlay').style.display = 'flex'; document.getElementById('app').style.display = 'none'; }

const pageTitles = { home:'Home', chat:'Chat', agents:'Agents', skills:'Skills', models:'Models', history:'History', monitor:'Monitor', usage:'Usage', sessions:'Sessions', cron:'Cron', logs:'Logs', files:'Files', config:'Config' };

async function navigateTo(page) {
  const old = document.querySelector('.page.active');
  if (old && old.id !== 'page-' + page) { old.classList.add('exiting'); await new Promise(r => setTimeout(r, 100)); old.classList.remove('exiting','active'); }
  currentPage = page;
  if (window.innerWidth < 768) { const s = document.getElementById('sidebar'); if (!s.classList.contains('collapsed')) toggleSidebar(); }
  document.querySelectorAll('.side-link').forEach(l => l.classList.remove('active'));
  const a = document.querySelector(`.side-link[data-page="${page}"]`); if (a) a.classList.add('active');
  document.getElementById('topbar-title').textContent = pageTitles[page] || page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const fns = { home:loadHome, chat:loadChat, agents:loadAgents, skills:loadSkills, models:loadModels, history:loadHistory, monitor:loadMonitor, usage:loadUsage, sessions:loadSessions, cron:loadCron, logs:loadLogs, files:loadFiles, config:loadConfig };
  if (fns[page]) await fns[page]();
}

function refreshCurrentPage() { navigateTo(currentPage); }
async function api(url) { const r = await fetch(url); if (r.status === 401) { doLogout(); return null; } return await r.json(); }
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => { t.style.display = 'none'; }, 2500); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s||''); return d.innerHTML; }

async function loadHome() {
  const p = document.getElementById('page-home');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const [sys, svc, proc, cfg] = await Promise.all([api('/api/system'), api('/api/services'), api('/api/processes'), api('/api/config')]);
  if (!sys) return;
  const up = '<span class="dot dot-up"></span>', down = '<span class="dot dot-down"></span>';
  p.innerHTML = `
    <div class="page-header"><div><div class="page-title">Home</div><div class="page-subtitle">Uptime ${sys.uptime_hours}h</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>
    <div class="grid-4" style="margin-bottom:24px;">
      <div class="stat-card"><div class="stat-value ${sys.cpu_percent>80?'stat-err':sys.cpu_percent>50?'stat-warn':''}">${sys.cpu_percent}%</div><div class="stat-label">CPU</div></div>
      <div class="stat-card"><div class="stat-value">${sys.memory_percent}%</div><div class="stat-label">RAM (${sys.memory_used_gb}/${sys.memory_total_gb} GB)</div></div>
      <div class="stat-card"><div class="stat-value">${sys.disk_percent}%</div><div class="stat-label">Disk (${sys.disk_used_gb}/${sys.disk_total_gb} GB)</div></div>
      <div class="stat-card"><div class="stat-value">${sys.uptime_hours}h</div><div class="stat-label">Uptime</div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Services</span></div>
      <div class="card-body" style="display:flex;gap:20px;flex-wrap:wrap;">
        ${svc.gateway?up:down} Gateway (8642) <span class="${svc.gateway?'stat-ok':'stat-err'}">${svc.gateway?'UP':'DOWN'}</span>
        ${svc.tr4nsform_org?up:down} tr4nsform.org (4174) <span class="${svc.tr4nsform_org?'stat-ok':'stat-err'}">${svc.tr4nsform_org?'UP':'DOWN'}</span>
        ${svc.tjadvaita?up:down} tjadvaita.tech (8080) <span class="${svc.tjadvaita?'stat-ok':'stat-err'}">${svc.tjadvaita?'UP':'DOWN'}</span>
        ${svc.kohphangan?up:down} kohphangan.villas (4180) <span class="${svc.kohphangan?'stat-ok':'stat-err'}">${svc.kohphangan?'UP':'DOWN'}</span>
        ${svc.kora?up:down} KORA (4190) <span class="${svc.kora?'stat-ok':'stat-err'}">${svc.kora?'UP':'DOWN'}</span>
        ${up} Dashboard (10275) <span class="stat-ok">UP</span>
      </div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Config</span></div>
      <div class="card-body">Model: ${cfg.default_model} (${cfg.default_provider})</div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Processes (${proc.length})</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>PID</th><th>Name</th><th>CPU%</th><th>MEM%</th></tr></thead>
        <tbody>${proc.map(p => `<tr><td>${p.pid}</td><td>${p.name}</td><td>${p.cpu}</td><td>${p.mem}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

async function loadChat() {
  document.getElementById('page-chat').innerHTML = `
    <div class="page-header"><div><div class="page-title">Chat</div></div><button class="btn btn-sm" onclick="chatHistory=[];loadChat()">Clear</button></div>
    <div class="card"><div class="chat-messages" id="chat-messages" style="max-height:500px;overflow-y:auto;padding:8px;"><div style="color:var(--text-dim);text-align:center;padding:20px;">Send a message.</div></div></div>
    <div style="display:flex;gap:8px;"><input id="chat-input" class="search-box" style="flex:1;" placeholder="Type..." onkeydown="if(event.key==='Enter')sendChat()"/><button class="btn btn-primary" onclick="sendChat()">Send</button></div>`;
}
async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim(); if (!msg) return;
  const c = document.getElementById('chat-messages');
  c.innerHTML += `<div style="margin:4px 0;padding:8px 12px;background:rgba(100,255,218,0.1);border-radius:8px;">${escapeHtml(msg)}</div>`;
  const lid = 'l'+Date.now(); c.innerHTML += `<div id="${lid}" style="margin:4px 0;padding:8px 12px;background:rgba(230,180,34,0.1);border-radius:8px;">...</div>`;
  c.scrollTop = c.scrollHeight; input.value = '';
  try {
    const r = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg, history:chatHistory.slice(-20)}) });
    const d = await r.json();
    document.getElementById(lid).innerHTML = escapeHtml(d.reply||'No response');
  } catch(e) { document.getElementById(lid).innerHTML = 'Error'; }
}

async function loadAgents() {
  const p = document.getElementById('page-agents');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const agents = await api('/api/agents');
  if (!agents) return;
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Agents</div><div class="page-subtitle">${agents.length} agents</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>
    ${agents.map(a => `<div class="card"><div class="card-header"><span class="card-title">${a.id}</span><span class="badge badge-${a.status==='active'?'green':'yellow'}">${a.status}</span></div>
      <div class="card-body">${a.type} &middot; ${a.model} (${a.provider})<div style="color:var(--text-dim);font-size:11px;margin-top:4px;">${a.description}</div></div></div>`).join('')}`;
}

async function loadSkills() {
  const p = document.getElementById('page-skills');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const skills = await api('/api/skills');
  if (!skills) return; skillsData = skills;
  const cats = [...new Set(skills.map(s => s.category))];
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Skills</div><div class="page-subtitle">${skills.length} skills</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>`;
  cats.forEach(cat => {
    const items = skills.filter(s => s.category === cat);
    p.innerHTML += `<div class="card"><div class="card-header"><span class="card-title">${cat}</span><span class="badge badge-accent">${items.length}</span></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Resources</th></tr></thead><tbody>
        ${items.map(s => `<tr><td style="color:var(--text-bright);">${s.name}</td><td>${s.has_refs?'R ':''}${s.has_scripts?'S ':''}${s.has_templates?'T':''}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  });
}

async function loadModels() {
  const p = document.getElementById('page-models');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const [models, cfg] = await Promise.all([api('/api/models'), api('/api/config')]);
  if (!models) return;
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Models</div><div class="page-subtitle">Active: ${cfg.default_model} via ${cfg.default_provider}</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>`;
  Object.entries(models).forEach(([prov, mods]) => {
    p.innerHTML += `<div class="card"><div class="card-header"><span class="card-title">${prov}</span><span class="badge ${prov===cfg.default_provider?'badge-green':'badge-accent'}">${prov===cfg.default_provider?'ACTIVE':''}</span></div>
      <div class="card-body">${mods.map(m => `<span class="badge badge-accent" style="margin:4px;">${m}</span>`).join('')}</div></div>`;
  });
}

async function loadHistory(filterUser = 'all') {
  const p = document.getElementById('page-history');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const sessions = await api('/api/sessions?limit=200');
  if (!sessions) return;
  let filtered = sessions;
  if (filterUser === 'tobias') filtered = sessions.filter(s => s.user === 'tobias');
  if (filterUser === 'julia') filtered = sessions.filter(s => s.user === 'julia');
  const sc = window._showCron || false;
  if (!sc) filtered = filtered.filter(s => !s.is_cron);
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Chat History</div><div class="page-subtitle">${sessions.length} sessions</div></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-sm ${filterUser==='all'?'btn-primary':''}" onclick="loadHistory('all')">All</button>
      <button class="btn btn-sm ${filterUser==='tobias'?'btn-primary':''}" onclick="loadHistory('tobias')">Tobias</button>
      <button class="btn btn-sm ${filterUser==='julia'?'btn-primary':''}" onclick="loadHistory('julia')">Julia</button>
      <button class="btn btn-sm" onclick="window._showCron=!window._showCron;loadHistory(filterUser)">${sc?'Hide':'Show'} Cron</button>
    </div></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>User</th><th>Model</th><th>Msgs</th><th>Size</th><th></th></tr></thead>
      <tbody>${filtered.slice(0,100).map(s => `<tr><td style="font-size:10px;">${(s.modified||'').substring(0,16)}</td>
        <td><span class="badge ${s.user==='tobias'?'badge-accent':s.user==='julia'?'badge-yellow':'badge-red'}">${s.user}</span></td>
        <td style="font-size:10px;">${s.model}</td><td>${s.messages}</td><td>${s.size_kb}KB</td>
        <td><button class="btn btn-xs" onclick="viewSession('${s.id}','page-history')">View</button></td></tr>`).join('')}</tbody></table></div>
    <div id="session-viewer" style="margin-top:16px;"></div>`;
}

async function loadMonitor() {
  const p = document.getElementById('page-monitor');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const [sys, proc] = await Promise.all([api('/api/system'), api('/api/processes')]);
  if (!sys) return;
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Monitor</div><div class="page-subtitle">Auto-refresh 8s</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>
    <div class="grid-3" style="margin-bottom:24px;">
      <div class="stat-card"><div class="stat-value ${sys.cpu_percent>80?'stat-err':sys.cpu_percent>50?'stat-warn':''}">${sys.cpu_percent}%</div><div class="stat-label">CPU</div></div>
      <div class="stat-card"><div class="stat-value ${sys.memory_percent>80?'stat-err':''}">${sys.memory_percent}%</div><div class="stat-label">RAM</div></div>
      <div class="stat-card"><div class="stat-value ${sys.disk_percent>85?'stat-err':''}">${sys.disk_percent}%</div><div class="stat-label">Disk</div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Processes</span></div>
      <div class="table-wrap"><table><thead><tr><th>PID</th><th>Name</th><th>CPU%</th><th>MEM%</th></tr></thead>
        <tbody>${proc.map(p => `<tr><td>${p.pid}</td><td>${p.name}</td><td>${p.cpu}</td><td>${p.mem}</td></tr>`).join('')}</tbody></table></div></div>`;
}

async function loadUsage() {
  const p = document.getElementById('page-usage');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const usage = await api('/api/usage');
  if (!usage) return;
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Usage</div><div class="page-subtitle">${usage.total_sessions} sessions, ${usage.total_messages} messages</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>
    <div class="grid-3" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-value">${usage.total_sessions}</div><div class="stat-label">Sessions</div></div>
      <div class="stat-card"><div class="stat-value">${usage.total_messages}</div><div class="stat-label">Messages</div></div>
      <div class="stat-card"><div class="stat-value">${usage.total_sessions?Math.round(usage.total_messages/usage.total_sessions):0}</div><div class="stat-label">Avg/Session</div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">By Model</span></div><div class="card-body">${Object.entries(usage.by_model).map(([m,c]) => `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>${m}</span><span class="badge badge-accent">${c}</span></div>`).join('')}</div></div>
    <div class="card"><div class="card-header"><span class="card-title">By Day</span></div><div class="card-body">${Object.entries(usage.by_day).slice(0,30).map(([d,c]) => `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span style="font-size:10px;">${d}</span><span>${c}</span></div>`).join('')}</div></div>`;
}

async function loadSessions() {
  const p = document.getElementById('page-sessions');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const sessions = await api('/api/sessions');
  if (!sessions) return;
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Sessions</div><div class="page-subtitle">${sessions.length} sessions</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>User</th><th>Model</th><th>Msgs</th><th>Size</th><th></th></tr></thead>
      <tbody>${sessions.slice(0,50).map(s => `<tr><td style="font-size:10px;">${(s.modified||'').substring(0,16)}</td>
        <td><span class="badge ${s.user==='tobias'?'badge-accent':s.user==='julia'?'badge-yellow':'badge-red'}">${s.user}</span></td>
        <td style="font-size:10px;">${s.model}</td><td>${s.messages}</td><td>${s.size_kb}KB</td>
        <td><button class="btn btn-xs" onclick="viewSession('${s.id}','page-sessions')">View</button></td></tr>`).join('')}</tbody></table></div>
    <div id="session-viewer" style="margin-top:16px;"></div>`;
}

async function viewSession(sid, parent) {
  const v = document.getElementById('session-viewer');
  v.innerHTML = '<div class="loading">Loading...</div>';
  const data = await api('/api/sessions/' + sid);
  if (!data || !data.messages) { v.innerHTML = '<div class="empty-state">No data</div>'; return; }
  v.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">${sid}</span><span style="font-size:10px;color:var(--text-dim);">${data.model} &middot; ${data.message_count} msgs</span></div>
    <div class="card-body" style="max-height:500px;overflow-y:auto;">${data.messages.map(m => `<div style="margin:4px 0;padding:6px 10px;border-radius:6px;background:${m.role==='user'?'rgba(100,255,218,0.05)':'rgba(230,180,34,0.05)'};"><span style="font-size:10px;color:${m.role==='user'?'var(--accent)':'var(--accent-gold)'};">${m.role}</span><div style="font-size:11px;white-space:pre-wrap;">${escapeHtml((m.content||'').substring(0,2000))}</div></div>`).join('')}</div></div>`;
}

async function loadCron() {
  const p = document.getElementById('page-cron');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const jobs = await api('/api/cron');
  const list = Array.isArray(jobs) ? jobs : (jobs?.jobs || []);
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Cron Jobs</div><div class="page-subtitle">${list.length} jobs</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>`;
  if (!list.length) { p.innerHTML += '<div class="empty-state">No cron jobs</div>'; return; }
  p.innerHTML += `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Schedule</th><th>Status</th></tr></thead>
    <tbody>${list.map(j => `<tr><td>${escapeHtml(j.name||j.id||'-')}</td><td><span class="badge badge-accent">${escapeHtml(j.schedule||'-')}</span></td>
      <td>${j.enabled!==false?'<span class="dot dot-up"></span> active':'<span class="dot dot-down"></span> paused'}</td></tr>`).join('')}</tbody></table></div>`;
}

async function loadLogs() {
  const p = document.getElementById('page-logs');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const logs = await api('/api/logs');
  if (!logs) return;
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Logs</div><div class="page-subtitle">${logs.length} files</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>
    ${logs.map(l => `<div class="card"><div class="card-header"><span class="card-title">${l.name}</span><span style="font-size:10px;color:var(--text-dim);">${l.size_kb}KB</span></div>
      <div class="card-body"><button class="btn btn-sm" onclick="viewLog('${l.path}')">Tail</button></div></div>`).join('')}
    <div id="log-viewer"></div>`;
}

async function viewLog(path) {
  const v = document.getElementById('log-viewer');
  v.innerHTML = '<div class="loading">Loading...</div>';
  const data = await api('/api/logs/' + encodeURIComponent(path));
  if (!data) return;
  v.innerHTML = `<div class="code-block">${escapeHtml(data.content)}</div>`;
}

let currentFilePath = '/opt/data';
async function loadFiles(path) {
  const p = document.getElementById('page-files');
  if (!path) { p.innerHTML = '<div class="loading">Loading...</div>'; path = '/opt/data'; currentFilePath = path; }
  currentFilePath = path;
  const data = await api('/api/files/list?path=' + encodeURIComponent(path));
  if (!data) return;
  const pp = path.split('/').slice(0,-1).join('/') || '/';
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Files</div><div class="page-subtitle" style="font-size:11px;color:var(--accent);">${data.path}</div></div>
    <div style="display:flex;gap:8px;"><button class="btn btn-sm" onclick="loadFiles('${pp}')" ${path==='/'?'disabled':''}>Up</button><button class="btn btn-sm" onclick="refreshCurrentPage()">R</button></div></div>
    ${data.items.map(i => `<div class="card" style="cursor:pointer;padding:10px 16px;" onclick="${i.type==='dir'?`loadFiles('${data.path}/${i.name}')`:''}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>${i.type==='dir'?'[DIR]':'[FILE]'} ${i.name}</span>
        <span style="font-size:10px;color:var(--text-dim);">${i.size_kb!==null?i.size_kb+'KB':''} ${(i.modified||'').substring(0,10)}</span>
      </div></div>`).join('')}
    <div id="file-viewer"></div>`;
}

async function loadConfig() {
  const p = document.getElementById('page-config');
  p.innerHTML = '<div class="loading">Loading...</div>';
  const cfg = await api('/api/config');
  if (!cfg) return;
  p.innerHTML = `<div class="page-header"><div><div class="page-title">Config</div></div><button class="btn" onclick="refreshCurrentPage()">R</button></div>
    <div class="grid-3" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-label">Default Model</div><div style="font-size:16px;color:var(--accent);margin-top:8px;">${cfg.default_model}</div></div>
      <div class="stat-card"><div class="stat-label">Provider</div><div style="font-size:16px;color:var(--accent);margin-top:8px;">${cfg.default_provider}</div></div>
      <div class="stat-card"><div class="stat-label">Fallback</div><div style="font-size:14px;color:var(--accent);margin-top:8px;">${(cfg.fallback||[]).join(' > ')}</div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">config.yaml</span></div><div id="config-content" class="card-body"><div class="loading">Loading...</div></div></div>`;
  try { const r = await fetch('/api/config/raw'); const d = await r.json(); document.getElementById('config-content').innerHTML = '<div class="code-block">' + escapeHtml(d.content) + '</div>'; }
  catch(e) { document.getElementById('config-content').innerHTML = '<div class="empty-state">Could not load</div>'; }
}
