(function () {
  const API = window.PLANNER_API_BASE || '/api';
  const keys = { plan: 'penguin-daily-plan-v1:local', archive: 'penguin-daily-plans-v1:local', time: 'penguin-time-records-v1:local', mainline: 'penguin-mainlines-v1:local', notifications: 'penguin-notifications-v1:local', account: 'penguin-planner-local-account-v1' };
  let loggedIn = false;
  let saveTimer = null;
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) { originalSetItem.call(this, key, value); if (window.CloudClient && loggedIn && Object.values(keys).includes(key)) window.CloudClient.scheduleSave(); };
  async function request(path, options = {}) { const response = await fetch(`${API}${path}`, { credentials: 'include', ...options }); if (!response.ok) { let message = '网络请求失败'; try { message = (await response.json()).error || message; } catch (_) {} const error = new Error(message); error.status = response.status; throw error; } return response.status === 204 ? null : response.json(); }
  function localData() { const data = {}; Object.entries(keys).forEach(([name, key]) => { try { const raw = localStorage.getItem(key); if (raw !== null) data[name] = JSON.parse(raw); } catch (_) {} }); return data; }
  function applyData(data) { Object.entries(keys).forEach(([name, key]) => { if (data && data[name] !== undefined) originalSetItem.call(localStorage, key, JSON.stringify(data[name])); else localStorage.removeItem(key); }); window.dispatchEvent(new Event('planner-sync')); }
  async function save() { if (!loggedIn) return; try { await request('/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(localData()) }); setStatus('已同步到云端'); } catch (error) { setStatus('网络暂时不可用，已保存在本机'); console.warn(error); } }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
  function setStatus(text) { const node = document.getElementById('cloud-status'); if (node) node.textContent = text; }
  function authChanged(me) { window.dispatchEvent(new CustomEvent('cloud-auth-changed', { detail: me || null })); }
  async function refresh() { const me = await request('/account/me'); loggedIn = true; authChanged(me); setStatus(`已登录：${me.username}`); const data = await request('/data'); if (data && Object.keys(data).length) { applyData(data); if (!sessionStorage.getItem('planner-cloud-hydrated')) { sessionStorage.setItem('planner-cloud-hydrated', '1'); location.reload(); } } return me; }
  async function login(username, password, register, displayName) { const me = await request(`/account/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(register && displayName ? { username, password, displayName } : { username, password }) }); loggedIn = true; const data = await request('/data'); if (!Object.keys(data || {}).length) await save(); else applyData(data); sessionStorage.setItem('planner-cloud-hydrated', '1'); location.reload(); return me; }
  async function logout() { await request('/account/logout', { method: 'POST' }); loggedIn = false; Object.values(keys).forEach(key => localStorage.removeItem(key)); authChanged(null); sessionStorage.removeItem('planner-cloud-hydrated'); location.reload(); }
  async function upload(file, id = window.crypto?.randomUUID?.() || `file-${Date.now()}-${Math.random().toString(16).slice(2)}`) { if (!loggedIn) throw new Error('请先登录'); await request(`/files/${id}`, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file }); return { id, name: file.name, type: file.type, size: file.size }; }
  async function fetchFile(id) { if (!loggedIn) throw new Error('请先登录'); const response = await fetch(`${API}/files/${encodeURIComponent(id)}`, { credentials: 'include' }); if (!response.ok) throw new Error('文件不存在'); return response.blob(); }
  async function openFile(file) { const blob = await fetchFile(file.id); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = file.name || '附件'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 60000); }
  window.CloudClient = { request, localData, applyData, save, scheduleSave, login, logout, refresh, fetchFile, upload, openFile, isLoggedIn: () => loggedIn };
  document.addEventListener('DOMContentLoaded', async () => { try { await refresh(); } catch (error) { if (error.status !== 401) setStatus('云端连接失败，继续使用本机数据'); else setStatus('未登录，数据仅保存在本机'); } });
})();
