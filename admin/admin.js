import { createClient } from '@supabase/supabase-js';

const MODULES = [
  { key: 'home', label: '首页' },
  { key: 'companion', label: '修法伴侣' },
  { key: 'library', label: '佛学书库' },
  { key: 'pilgrimage', label: '朝圣' },
  { key: 'vegan', label: '茹素' },
  { key: 'forum', label: '论坛' },
];

let state = {
  token: localStorage.getItem('modao-admin-token') || '',
  moduleKey: 'home',
  profile: null,
};

function byId(id) { return document.getElementById(id); }
function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}
async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

async function login() {
  const email = byId('email').value.trim();
  const password = byId('password').value.trim();
  const supabaseUrl = localStorage.getItem('modao-supabase-url') || prompt('输入 SUPABASE_URL');
  const anonKey = localStorage.getItem('modao-supabase-anon') || prompt('输入 SUPABASE_ANON_KEY');
  if (!email || !password || !supabaseUrl || !anonKey) return alert('登录信息不完整');

  localStorage.setItem('modao-supabase-url', supabaseUrl);
  localStorage.setItem('modao-supabase-anon', anonKey);

  const client = createClient(supabaseUrl, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return alert(`登录失败: ${error.message}`);
  state.token = data.session.access_token;
  localStorage.setItem('modao-admin-token', state.token);
  await refreshProfile();
  await reloadAll();
}

async function refreshProfile() {
  try {
    const data = await fetchJson('/api/admin/profile', { headers: { ...authHeaders() } });
    state.profile = data.profile;
    byId('auth-status').textContent = `已登录：${state.profile.role} / ${data.user.email || '-'}`;
  } catch (err) {
    byId('auth-status').textContent = '未登录';
  }
}

function logout() {
  state.token = '';
  state.profile = null;
  localStorage.removeItem('modao-admin-token');
  byId('auth-status').textContent = '未登录';
}

function initModuleNav() {
  const nav = byId('module-nav');
  nav.innerHTML = MODULES.map(m => `<button data-key="${m.key}">${m.label}</button>`).join('');
  nav.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      state.moduleKey = btn.dataset.key;
      nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      await loadModuleDraft();
      await loadArticles();
    };
    if (btn.dataset.key === state.moduleKey) btn.classList.add('active');
  });
}

async function loadModuleDraft() {
  const data = await fetchJson(`/api/admin/content?module=${encodeURIComponent(state.moduleKey)}`, {
    headers: { ...authHeaders() },
  });
  const root = (data.blocks || []).find(x => x.block_key === 'module_root');
  byId('module-json').value = JSON.stringify(root?.payload || {}, null, 2);
}

async function saveModuleDraft() {
  const payload = JSON.parse(byId('module-json').value || '{}');
  await fetchJson('/api/admin/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      moduleKey: state.moduleKey,
      blockKey: 'module_root',
      payload,
    }),
  });
  alert('模块草稿已保存');
}

async function loadArticles() {
  const data = await fetchJson(`/api/admin/articles?module=${encodeURIComponent(state.moduleKey)}`, {
    headers: { ...authHeaders() },
  });
  byId('article-list').textContent = JSON.stringify(data.articles || [], null, 2);
}

async function upsertArticle() {
  const payload = {
    module_key: state.moduleKey,
    slug: byId('article-slug').value.trim(),
    title: byId('article-title').value.trim(),
    article_url: byId('article-url').value.trim(),
    cover_url: byId('article-cover').value.trim(),
    summary: byId('article-summary').value.trim(),
    content_md: byId('article-md').value.trim(),
  };
  await fetchJson('/api/admin/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  await loadArticles();
  alert('文章已保存');
}

async function uploadMedia() {
  const file = byId('file-input').files?.[0];
  if (!file) return alert('请先选择图片');
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || '');
    const data = await fetchJson('/api/admin/media-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        moduleKey: state.moduleKey,
        fileName: file.name,
        mimeType: file.type || 'image/png',
        base64Data: dataUrl,
      }),
    });
    byId('upload-result').value = data.publicUrl;
  };
  reader.readAsDataURL(file);
}

async function publishModule() {
  const data = await fetchJson('/api/admin/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ moduleKey: state.moduleKey }),
  });
  alert(`发布成功，版本：${data.version}`);
}

async function loadUsers() {
  const data = await fetchJson('/api/admin/users', { headers: { ...authHeaders() } });
  byId('user-list').textContent = JSON.stringify(data.users || [], null, 2);
}

async function updateUser() {
  const payload = {
    id: byId('user-id').value.trim(),
    display_name: byId('user-display-name').value.trim(),
    role: byId('user-role').value.trim(),
    status: byId('user-status').value.trim(),
  };
  if (!payload.id) return alert('请先输入用户ID');
  await fetchJson('/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  await loadUsers();
  alert('用户信息已更新');
}

async function reloadAll() {
  await loadModuleDraft();
  await loadArticles();
  await loadUsers();
}

function bindEvents() {
  byId('login-btn').onclick = login;
  byId('logout-btn').onclick = logout;
  byId('save-module-btn').onclick = saveModuleDraft;
  byId('upsert-article-btn').onclick = upsertArticle;
  byId('reload-article-btn').onclick = loadArticles;
  byId('publish-btn').onclick = publishModule;
  byId('upload-btn').onclick = uploadMedia;
  byId('update-user-btn').onclick = updateUser;
  byId('reload-users-btn').onclick = loadUsers;
}

async function boot() {
  initModuleNav();
  bindEvents();
  if (state.token) {
    await refreshProfile();
    await reloadAll();
  }
}

boot();
