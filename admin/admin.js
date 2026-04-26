import { createClient } from '@supabase/supabase-js';

const MODULES = [
  { key: 'home', label: '首页', icon: '🏠', desc: '首页视觉与推荐内容配置' },
  { key: 'companion', label: '修法伴侣', icon: '🤖', desc: 'AI 对话入口与引导内容' },
  { key: 'library', label: '佛学书库', icon: '📚', desc: '书库内容与分类配置' },
  { key: 'pilgrimage', label: '朝圣', icon: '🕍', desc: '朝圣地点与线路攻略内容' },
  { key: 'vegan', label: '茹素', icon: '🥗', desc: '素食推荐与菜谱内容' },
  { key: 'forum', label: '论坛', icon: '🗣️', desc: '论坛帖子与跳转内容管理' },
];
const MODULE_KEY_FALLBACKS = {
  pilgrimage: ['pilgrimage', 'pilgrim'],
};

let state = {
  token: localStorage.getItem('modao-admin-token') || '',
  moduleKey: 'home',
  profile: null,
  articles: [],
  users: [],
  articleKeyword: '',
  userKeyword: '',
  sidebarCollapsed: localStorage.getItem('modao-admin-sidebar-collapsed') === '1',
};

function byId(id) { return document.getElementById(id); }
function getModuleMeta(moduleKey) {
  return MODULES.find(m => m.key === moduleKey);
}
function showToast(text, isError = false) {
  const el = byId('toast');
  if (!el) return;
  el.textContent = text;
  el.style.borderColor = isError ? '#ff5c5c' : '#2f3a55';
  el.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove('show'), 2200);
}
function updateStats() {
  byId('stat-articles').textContent = String(state.articles.length || 0);
  byId('stat-users').textContent = String(state.users.length || 0);
  byId('stat-role').textContent = state.profile?.role || '未登录';
}
function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}
async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function getModuleKeyCandidates(moduleKey) {
  const candidates = MODULE_KEY_FALLBACKS[moduleKey] || [moduleKey];
  return [...new Set(candidates)];
}

async function login() {
  const email = byId('email').value.trim();
  const password = byId('password').value.trim();
  const supabaseUrl = localStorage.getItem('modao-supabase-url') || prompt('输入 SUPABASE_URL');
  const anonKey = localStorage.getItem('modao-supabase-anon') || prompt('输入 SUPABASE_ANON_KEY');
  if (!email || !password || !supabaseUrl || !anonKey) return showToast('登录信息不完整', true);

  localStorage.setItem('modao-supabase-url', supabaseUrl);
  localStorage.setItem('modao-supabase-anon', anonKey);

  const client = createClient(supabaseUrl, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return showToast(`登录失败: ${error.message}`, true);
  state.token = data.session.access_token;
  localStorage.setItem('modao-admin-token', state.token);
  await refreshProfile();
  await reloadAll();
  showToast('登录成功');
}

async function refreshProfile() {
  try {
    const data = await fetchJson('/api/admin/profile', { headers: { ...authHeaders() } });
    state.profile = data.profile;
    byId('auth-status').textContent = `已登录：${state.profile.role} / ${data.user.email || '-'}`;
    updateStats();
  } catch (err) {
    byId('auth-status').textContent = '未登录';
    state.profile = null;
    updateStats();
  }
}

function logout() {
  state.token = '';
  state.profile = null;
  localStorage.removeItem('modao-admin-token');
  byId('auth-status').textContent = '未登录';
  byId('module-json').value = '';
  byId('article-list').innerHTML = '';
  byId('user-list').innerHTML = '';
  state.articles = [];
  state.users = [];
  updateStats();
  showToast('已退出登录');
}

function initModuleNav() {
  const nav = byId('module-nav');
  nav.innerHTML = MODULES.map(m => `<button data-key="${m.key}" data-short="${m.label.slice(0, 1)}">${m.label}</button>`).join('');
  nav.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => switchModule(btn.dataset.key);
    if (btn.dataset.key === state.moduleKey) btn.classList.add('active');
  });
  updateActiveModuleText();
  renderModuleGallery();
}

function renderModuleGallery() {
  const root = byId('module-gallery');
  root.innerHTML = MODULES.map(m => `
    <article class="module-card ${m.key === state.moduleKey ? 'active' : ''}" data-key="${m.key}">
      <div class="module-icon">${m.icon}</div>
      <div class="module-title">${m.label}</div>
    </article>
  `).join('');
  root.querySelectorAll('.module-card').forEach(card => {
    card.onclick = () => switchModule(card.dataset.key);
  });
}

async function switchModule(moduleKey) {
  if (!state.token) return showToast('请先登录后台账号', true);
  state.moduleKey = moduleKey;
  byId('module-nav').querySelectorAll('button')
    .forEach(b => b.classList.toggle('active', b.dataset.key === moduleKey));
  updateActiveModuleText();
  renderModuleGallery();
  await reloadAll();
}

function updateActiveModuleText() {
  const module = getModuleMeta(state.moduleKey);
  byId('active-module-title').textContent = `当前模块：${module?.label || state.moduleKey}`;
  byId('active-module-desc').textContent = module?.desc || '可编辑模块 JSON、文章列表、图片与用户配置。';
}

async function loadModuleDraft() {
  let lastError = null;
  for (const key of getModuleKeyCandidates(state.moduleKey)) {
    try {
      const data = await fetchJson(`/api/admin/content?module=${encodeURIComponent(key)}`, {
        headers: { ...authHeaders() },
      });
      const root = (data.blocks || []).find(x => x.block_key === 'module_root');
      byId('module-json').value = JSON.stringify(root?.payload || {}, null, 2);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('加载模块草稿失败');
}

async function saveModuleDraft() {
  let payload = {};
  try {
    payload = JSON.parse(byId('module-json').value || '{}');
  } catch (err) {
    return showToast('模块 JSON 格式错误，请先修正', true);
  }
  await fetchJson('/api/admin/content', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      moduleKey: state.moduleKey,
      blockKey: 'module_root',
      payload,
    }),
  });
  showToast('模块草稿已保存');
}

async function loadArticles() {
  let lastError = null;
  for (const key of getModuleKeyCandidates(state.moduleKey)) {
    try {
      const data = await fetchJson(`/api/admin/articles?module=${encodeURIComponent(key)}`, {
        headers: { ...authHeaders() },
      });
      state.articles = data.articles || [];
      renderArticleList();
      updateStats();
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('加载文章失败');
}

function renderArticleList() {
  const root = byId('article-list');
  const keyword = state.articleKeyword.trim().toLowerCase();
  const list = state.articles.filter(a => {
    if (!keyword) return true;
    return String(a.title || '').toLowerCase().includes(keyword)
      || String(a.slug || '').toLowerCase().includes(keyword);
  });
  if (!list.length) {
    root.innerHTML = '<div class="meta">当前模块暂无草稿文章</div>';
    return;
  }
  root.innerHTML = list.map(a => `
    <div class="item" data-slug="${a.slug}">
      ${a.cover_url ? `<img class="article-cover" src="${a.cover_url}" alt="${a.title}">` : ''}
      <div class="title">${a.title}</div>
      <div class="meta">slug: ${a.slug} · 排序: ${a.sort_order || 0}</div>
      <div class="meta">${a.summary || '无摘要'}</div>
      <div class="actions">
        <button class="ghost" data-action="edit">编辑</button>
      </div>
    </div>
  `).join('');
  root.querySelectorAll('.item').forEach(el => {
    el.onclick = (event) => {
      if (event.target.dataset.action === 'edit' || !event.target.closest('.actions')) {
        fillArticleForm(el.dataset.slug);
      }
    };
  });
}

function fillArticleForm(slug) {
  const article = state.articles.find(a => a.slug === slug);
  if (!article) return;
  byId('article-slug').value = article.slug || '';
  byId('article-title').value = article.title || '';
  byId('article-url').value = article.article_url || '';
  byId('article-cover').value = article.cover_url || '';
  byId('article-summary').value = article.summary || '';
  byId('article-md').value = article.content_md || '';
  showToast(`已载入文章：${article.title}`);
}

function clearArticleForm() {
  ['article-slug', 'article-title', 'article-url', 'article-cover', 'article-summary', 'article-md']
    .forEach(id => { byId(id).value = ''; });
}

async function upsertArticle() {
  const moduleKey = getModuleKeyCandidates(state.moduleKey)[0];
  const payload = {
    module_key: moduleKey,
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
  showToast('文章已保存');
}

async function deleteArticle() {
  const slug = byId('article-slug').value.trim();
  if (!slug) return showToast('请先填写或选择要删除的 slug', true);
  if (!confirm(`确认删除文章 slug = ${slug} ?`)) return;
  const moduleKey = getModuleKeyCandidates(state.moduleKey)[0];
  await fetchJson('/api/admin/articles', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      module_key: moduleKey,
      slug,
    }),
  });
  await loadArticles();
  clearArticleForm();
  showToast('文章已删除');
}

async function uploadMedia() {
  const file = byId('file-input').files?.[0];
  if (!file) return showToast('请先选择图片', true);
  const moduleKey = getModuleKeyCandidates(state.moduleKey)[0];
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || '');
    const data = await fetchJson('/api/admin/media-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        moduleKey,
        fileName: file.name,
        mimeType: file.type || 'image/png',
        base64Data: dataUrl,
      }),
    });
    byId('upload-result').value = data.publicUrl;
    showToast('图片上传成功，可复制 URL 使用');
  };
  reader.readAsDataURL(file);
}

async function publishModule() {
  const moduleKey = getModuleKeyCandidates(state.moduleKey)[0];
  const data = await fetchJson('/api/admin/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ moduleKey }),
  });
  showToast(`发布成功，版本：${data.version}`);
}

async function loadUsers() {
  const data = await fetchJson('/api/admin/users', { headers: { ...authHeaders() } });
  state.users = data.users || [];
  renderUserList();
  updateStats();
}

function renderUserList() {
  const root = byId('user-list');
  const keyword = state.userKeyword.trim().toLowerCase();
  const list = state.users.filter(u => {
    if (!keyword) return true;
    return String(u.display_name || '').toLowerCase().includes(keyword)
      || String(u.email || '').toLowerCase().includes(keyword)
      || String(u.role || '').toLowerCase().includes(keyword);
  });
  if (!list.length) {
    root.innerHTML = '<div class="meta">暂无用户数据</div>';
    return;
  }
  root.innerHTML = list.map(u => `
    <div class="item" data-id="${u.id}">
      <div class="title">${u.display_name || u.email || u.id}</div>
      <div class="meta">
        <span class="tag role-${u.role}">${u.role}</span>
        <span class="tag status-${u.status}">${u.status}</span>
      </div>
      <div class="meta">${u.email || u.id}</div>
    </div>
  `).join('');
  root.querySelectorAll('.item').forEach(el => {
    el.onclick = () => fillUserForm(el.dataset.id);
  });
}

function fillUserForm(id) {
  const user = state.users.find(u => u.id === id);
  if (!user) return;
  byId('user-id').value = user.id || '';
  byId('user-display-name').value = user.display_name || '';
  byId('user-role').value = user.role || '';
  byId('user-status').value = user.status || '';
  showToast('已载入用户信息');
}

async function updateUser() {
  const payload = {
    id: byId('user-id').value.trim(),
    display_name: byId('user-display-name').value.trim(),
    role: byId('user-role').value.trim(),
    status: byId('user-status').value.trim(),
  };
  if (!payload.id) return showToast('请先输入用户ID', true);
  await fetchJson('/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  await loadUsers();
  showToast('用户信息已更新');
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  localStorage.setItem('modao-admin-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');
}

function applyInitialLayout() {
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
}

async function reloadAll() {
  if (!state.token) return;
  let hasError = false;
  try {
    await loadModuleDraft();
  } catch (err) {
    hasError = true;
    showToast(`模块内容加载失败: ${err.message}`, true);
  }
  try {
    await loadArticles();
  } catch (err) {
    hasError = true;
    showToast(`文章加载失败: ${err.message}`, true);
  }
  try {
    await loadUsers();
  } catch (err) {
    hasError = true;
    showToast(`用户加载失败: ${err.message}`, true);
  }
  if (!hasError) showToast('数据刷新完成');
}

function bindEvents() {
  byId('login-btn').onclick = login;
  byId('logout-btn').onclick = logout;
  byId('save-module-btn').onclick = saveModuleDraft;
  byId('upsert-article-btn').onclick = upsertArticle;
  byId('delete-article-btn').onclick = deleteArticle;
  byId('clear-article-btn').onclick = clearArticleForm;
  byId('publish-btn').onclick = publishModule;
  byId('upload-btn').onclick = uploadMedia;
  byId('update-user-btn').onclick = updateUser;
  byId('reload-users-btn').onclick = loadUsers;
  byId('reload-all-btn').onclick = reloadAll;
  byId('toggle-sidebar-btn').onclick = toggleSidebar;
  byId('file-input').onchange = () => {
    const file = byId('file-input').files?.[0];
    const preview = byId('upload-preview');
    if (!file) {
      preview.style.display = 'none';
      preview.removeAttribute('src');
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  };
  byId('article-search').oninput = (event) => {
    state.articleKeyword = event.target.value || '';
    renderArticleList();
  };
  byId('user-search').oninput = (event) => {
    state.userKeyword = event.target.value || '';
    renderUserList();
  };
}

async function boot() {
  applyInitialLayout();
  initModuleNav();
  bindEvents();
  updateStats();
  if (state.token) {
    await refreshProfile();
    try {
      await reloadAll();
    } catch (err) {
      showToast(`初始化加载失败: ${err.message}`, true);
    }
  }
}

boot();
