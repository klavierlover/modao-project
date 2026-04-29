import { createClient } from '@supabase/supabase-js';

/* ═══════════════════════════════════════════════
   模块配置
   ═══════════════════════════════════════════════ */
const MODULES = [
  { key: 'home',       label: '首页',     icon: '🏠', desc: '首页视觉与推荐内容' },
  { key: 'companion',  label: '修法伴侣', icon: '🤖', desc: 'AI 对话与引导内容' },
  { key: 'library',    label: '佛学书库', icon: '📚', desc: '书库内容与分类' },
  { key: 'pilgrimage', label: '朝圣',     icon: '🕍', desc: '朝圣地点与攻略' },
  { key: 'vegan',      label: '茹素',     icon: '🥗', desc: '素食推荐与菜谱' },
  { key: 'forum',      label: '论坛',     icon: '🗣️', desc: '帖子与跳转内容' },
];

// 朝圣坐标系：x 0–700 (西→东), y 0–480 (北→南)
const MAP_W = 700;
const MAP_H = 480;

/* ═══════════════════════════════════════════════
   状态
   ═══════════════════════════════════════════════ */
const state = {
  token:              localStorage.getItem('modao-admin-token') || '',
  moduleKey:          'home',
  profile:            null,
  articles:           [],
  users:              [],
  articleKeyword:     '',
  userKeyword:        '',
  sidebarCollapsed:   localStorage.getItem('modao-sidebar-collapsed') === '1',
  editingArticleSlug: null,
  // 视觉编辑器
  currentPayload:     {},
  isDirty:            false,
  editingSiteId:      null,   // null = 新建
  editingSiteType:    'site', // 'site' | 'restaurant' | 'recipe'
  veganSubTab:        'restaurants', // 'restaurants' | 'recipes'
};

/* ═══════════════════════════════════════════════
   DOM helpers
   ═══════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

function showToast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function setLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

window.closeModal = function(id) { $(id)?.classList.add('hidden'); };
function openModal(id) { $(id)?.classList.remove('hidden'); }

function confirmDialog(message, title = '确认操作') {
  return new Promise(resolve => {
    $('confirm-title').textContent   = title;
    $('confirm-message').textContent = message;
    openModal('confirm-modal');
    const ok     = $('confirm-ok-btn');
    const cancel = $('confirm-cancel-btn');
    const cleanup = result => {
      closeModal('confirm-modal');
      ok.onclick = cancel.onclick = null;
      resolve(result);
    };
    ok.onclick     = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
  });
}

/* ═══════════════════════════════════════════════
   认证
   ═══════════════════════════════════════════════ */
function getSupabaseConfig() {
  return {
    url:     localStorage.getItem('modao-supabase-url')  || '',
    anonKey: localStorage.getItem('modao-supabase-anon') || '',
  };
}

async function login() {
  const email    = $('email').value.trim();
  const password = $('password').value.trim();
  const cfg      = getSupabaseConfig();

  if (!cfg.url || !cfg.anonKey) { openModal('settings-modal'); showToast('请先配置 Supabase 连接信息', true); return; }
  if (!email || !password)       { showLoginError('请填写邮箱和密码'); return; }

  const btn = $('login-btn');
  setLoading(btn, true);
  $('login-error').classList.add('hidden');

  try {
    const client = createClient(cfg.url, cfg.anonKey);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.token = data.session.access_token;
    localStorage.setItem('modao-admin-token', state.token);
    await refreshProfile();
    await reloadAll();
    showAppShell();
    showToast('登录成功，欢迎回来！');
  } catch (err) {
    showLoginError(`登录失败：${err.message}`);
  } finally {
    setLoading(btn, false);
  }
}

function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function logout() {
  if (state.isDirty) {
    if (!confirm('有未保存的更改，确认退出？')) return;
  }
  state.token = '';
  state.profile = null;
  state.articles = [];
  state.users = [];
  state.currentPayload = {};
  clearDirty();
  localStorage.removeItem('modao-admin-token');
  showLoginScreen();
  showToast('已退出登录');
}

function showLoginScreen() { $('login-screen').classList.remove('hidden'); $('app-shell').classList.add('hidden'); }
function showAppShell()    { $('login-screen').classList.add('hidden');    $('app-shell').classList.remove('hidden'); }

async function refreshProfile() {
  try {
    const data = await fetchJson('/api/admin/profile', { headers: authHeaders() });
    state.profile = data.profile;
    const initial = (data.user?.email || 'A')[0].toUpperCase();
    $('user-avatar').textContent = initial;
    $('user-name').textContent   = state.profile?.display_name || data.user?.email || '管理员';
    const roleEl = $('user-role-badge');
    roleEl.textContent = state.profile?.role || '';
    roleEl.className   = `badge badge-${state.profile?.role || 'viewer'}`;
    updateChips();
  } catch { state.profile = null; }
}

/* ═══════════════════════════════════════════════
   Settings Modal
   ═══════════════════════════════════════════════ */
function openSettings() {
  const cfg = getSupabaseConfig();
  $('settings-url').value      = cfg.url;
  $('settings-anon-key').value = cfg.anonKey;
  openModal('settings-modal');
}

function saveSettings() {
  const url     = $('settings-url').value.trim();
  const anonKey = $('settings-anon-key').value.trim();
  if (!url || !anonKey) { showToast('URL 和 Anon Key 不能为空', true); return; }
  localStorage.setItem('modao-supabase-url',  url);
  localStorage.setItem('modao-supabase-anon', anonKey);
  closeModal('settings-modal');
  showToast('Supabase 配置已保存');
}

/* ═══════════════════════════════════════════════
   网络请求
   ═══════════════════════════════════════════════ */
function authHeaders() { return state.token ? { Authorization: `Bearer ${state.token}` } : {}; }

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

/* ═══════════════════════════════════════════════
   草稿状态（未保存提示）
   ═══════════════════════════════════════════════ */
function markDirty() {
  state.isDirty = true;
  $('dirty-dot')?.classList.remove('hidden');
}

function clearDirty() {
  state.isDirty = false;
  $('dirty-dot')?.classList.add('hidden');
}

/* ═══════════════════════════════════════════════
   发布状态 Badge
   ═══════════════════════════════════════════════ */
async function loadPublishStatus() {
  try {
    const data = await fetchJson(`/api/admin/publish?module=${encodeURIComponent(state.moduleKey)}`, {
      headers: authHeaders(),
    });
    const badge = $('publish-status');
    if (!badge) return;
    if (data.version) {
      const d = new Date(data.published_at || Date.now());
      const fmt = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      badge.textContent = `✓ 已上线 v${data.version}  ${fmt}`;
      badge.className   = 'status-badge published';
    } else {
      badge.textContent = '草稿中';
      badge.className   = 'status-badge draft';
    }
  } catch {
    const badge = $('publish-status');
    if (badge) { badge.textContent = ''; badge.className = 'status-badge'; }
  }
}

/* ═══════════════════════════════════════════════
   模块导航
   ═══════════════════════════════════════════════ */
function initModuleNav() {
  const nav = $('module-nav');
  nav.innerHTML = MODULES.map(m => `
    <button class="module-nav-btn${m.key === state.moduleKey ? ' active' : ''}" data-key="${m.key}">
      <span class="module-nav-icon">${m.icon}</span>
      <span class="module-nav-label">${m.label}</span>
    </button>
  `).join('');
  nav.querySelectorAll('.module-nav-btn').forEach(btn => {
    btn.onclick = () => switchModule(btn.dataset.key);
  });
  updateModuleHeader();
  renderModuleGallery();
}

function renderModuleGallery() {
  $('module-gallery').innerHTML = MODULES.map(m => `
    <div class="module-card${m.key === state.moduleKey ? ' active' : ''}" data-key="${m.key}">
      <span class="module-card-icon">${m.icon}</span>
      <div>
        <div class="module-card-label">${m.label}</div>
        <div class="module-card-desc">${m.desc}</div>
      </div>
    </div>
  `).join('');
  $('module-gallery').querySelectorAll('.module-card').forEach(card => {
    card.onclick = () => switchModule(card.dataset.key);
  });
}

function updateModuleHeader() {
  const m = MODULES.find(x => x.key === state.moduleKey);
  $('active-module-title').textContent = m?.label || state.moduleKey;
  $('active-module-desc').textContent  = m?.desc   || '';
  const publishName = $('publish-module-name');
  if (publishName) publishName.textContent = m?.label || state.moduleKey;
}

async function switchModule(moduleKey) {
  if (!state.token) { showToast('请先登录', true); return; }
  if (state.isDirty && moduleKey !== state.moduleKey) {
    const ok = await confirmDialog('有未保存的更改，切换模块将丢失这些更改，确认继续？', '未保存提醒');
    if (!ok) return;
    clearDirty();
  }
  state.moduleKey = moduleKey;
  $('module-nav').querySelectorAll('.module-nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.key === moduleKey)
  );
  updateModuleHeader();
  renderModuleGallery();
  await reloadAll();
}

/* ═══════════════════════════════════════════════
   模块草稿
   ═══════════════════════════════════════════════ */
async function loadModuleDraft() {
  const data = await fetchJson(`/api/admin/content?module=${encodeURIComponent(state.moduleKey)}`, {
    headers: authHeaders(),
  });
  const root = (data.blocks || []).find(x => x.block_key === 'module_root');
  state.currentPayload = root?.payload || {};
  // 同步到 JSON 编辑器（高级面板）
  $('module-json').value = JSON.stringify(state.currentPayload, null, 2);
  // 渲染视觉编辑器
  renderVisualEditor(state.moduleKey, state.currentPayload);
  clearDirty();
}

async function saveModuleDraft() {
  // 如果高级 JSON 面板是展开状态，先尝试解析用户编辑的 JSON
  const panel = $('json-panel');
  if (panel && panel.open) {
    try {
      const parsed = JSON.parse($('module-json').value || '{}');
      state.currentPayload = parsed;
    } catch {
      showToast('JSON 格式有误，请检查后重试', true);
      return;
    }
  }
  const btn = $('save-module-btn');
  setLoading(btn, true);
  try {
    await fetchJson('/api/admin/content', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body:    JSON.stringify({ moduleKey: state.moduleKey, blockKey: 'module_root', payload: state.currentPayload }),
    });
    // 重新同步 JSON 面板
    $('module-json').value = JSON.stringify(state.currentPayload, null, 2);
    renderVisualEditor(state.moduleKey, state.currentPayload);
    clearDirty();
    showToast('草稿已保存 ✓');
  } catch (err) {
    showToast(`保存失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════════
   视觉编辑器 — 调度
   ═══════════════════════════════════════════════ */
function renderVisualEditor(moduleKey, payload) {
  const root = $('visual-editor-root');
  if (!root) return;

  if (moduleKey === 'pilgrimage') {
    root.innerHTML = '';
    root.appendChild(buildSiteManager(payload.sites || [], 'pilgrimage'));
  } else if (moduleKey === 'vegan') {
    root.innerHTML = '';
    root.appendChild(buildVeganManager(payload));
  } else {
    root.innerHTML = '';
    root.appendChild(buildGenericForm(payload));
  }
}

/* ─── 朝圣管理器 ─────────────────────────────── */
function buildSiteManager(sites, moduleKey) {
  const section = document.createElement('div');
  section.className = 'visual-editor-section';

  section.innerHTML = `
    <div class="visual-section-header">
      <div>
        <span class="visual-section-title">🕍 朝圣地点</span>
        <span class="visual-section-count">${sites.length} 处</span>
      </div>
      <button class="btn-primary btn-sm" id="add-site-btn">＋ 添加地点</button>
    </div>
    <p class="panel-sub">点击卡片可编辑内容，添加新地点后地图上会自动显示对应位置。</p>
    <div class="site-card-grid" id="site-card-grid">
      ${sites.map(s => buildSiteCardHTML(s, 'site')).join('')}
      <div class="add-card" id="add-site-card-btn">
        <div class="add-card-icon">＋</div>
        <div>添加朝圣地点</div>
      </div>
    </div>
  `;

  // 绑定事件
  section.querySelector('#add-site-btn').onclick       = () => openSiteModal(null, 'site');
  section.querySelector('#add-site-card-btn').onclick  = () => openSiteModal(null, 'site');
  section.querySelectorAll('[data-site-id]').forEach(card => {
    card.onclick = () => openSiteModal(card.dataset.siteId, 'site');
  });

  return section;
}

function buildSiteCardHTML(s, type) {
  const cover = s.cover || s.coverUrl || '';
  const name  = escHtml(s.name || '未命名');
  const sub   = escHtml(s.region || s.shortDesc || '');
  return `
    <div class="site-card" data-site-id="${escHtml(String(s.id || s.name || ''))}">
      ${cover
        ? `<img class="site-card-cover" src="${escHtml(cover)}" alt="${name}" onerror="this.classList.add('hidden');this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="site-card-cover-placeholder" style="${cover ? 'display:none' : ''}">🗺</div>
      <div class="site-card-body">
        <div class="site-card-name">${name}</div>
        ${sub ? `<div class="site-card-sub">${sub}</div>` : ''}
      </div>
      <div class="site-card-footer">
        <button class="btn-ghost btn-sm" style="pointer-events:none">编辑 →</button>
      </div>
    </div>`;
}

/* ─── 茹素管理器 ─────────────────────────────── */
function buildVeganManager(payload) {
  const restaurants = payload.restaurants || [];
  const recipes     = payload.recipes     || [];

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '16px';

  // 餐厅区
  const restSection = document.createElement('div');
  restSection.className = 'visual-editor-section';
  restSection.innerHTML = `
    <div class="visual-section-header">
      <div>
        <span class="visual-section-title">🍜 素食餐厅</span>
        <span class="visual-section-count">${restaurants.length} 家</span>
      </div>
      <button class="btn-primary btn-sm" id="add-restaurant-btn">＋ 添加餐厅</button>
    </div>
    <p class="panel-sub">添加餐厅后，茹素地图上会自动显示对应位置。</p>
    <div class="site-card-grid" id="restaurant-card-grid">
      ${restaurants.map(s => buildSiteCardHTML(s, 'restaurant')).join('')}
      <div class="add-card" id="add-restaurant-card-btn">
        <div class="add-card-icon">＋</div>
        <div>添加素食餐厅</div>
      </div>
    </div>
  `;
  restSection.querySelector('#add-restaurant-btn').onclick      = () => openSiteModal(null, 'restaurant');
  restSection.querySelector('#add-restaurant-card-btn').onclick = () => openSiteModal(null, 'restaurant');
  restSection.querySelectorAll('[data-site-id]').forEach(card => {
    card.onclick = () => openSiteModal(card.dataset.siteId, 'restaurant');
  });

  // 菜谱区
  const recipeSection = document.createElement('div');
  recipeSection.className = 'visual-editor-section';
  recipeSection.innerHTML = `
    <div class="visual-section-header">
      <div>
        <span class="visual-section-title">🥗 素食菜谱</span>
        <span class="visual-section-count">${recipes.length} 道</span>
      </div>
      <button class="btn-primary btn-sm" id="add-recipe-btn">＋ 添加菜谱</button>
    </div>
    <p class="panel-sub">编辑菜谱名称、图片、做法说明等内容。</p>
    <div class="site-card-grid" id="recipe-card-grid">
      ${recipes.map(s => buildSiteCardHTML(s, 'recipe')).join('')}
      <div class="add-card" id="add-recipe-card-btn">
        <div class="add-card-icon">＋</div>
        <div>添加菜谱</div>
      </div>
    </div>
  `;
  recipeSection.querySelector('#add-recipe-btn').onclick      = () => openSiteModal(null, 'recipe');
  recipeSection.querySelector('#add-recipe-card-btn').onclick = () => openSiteModal(null, 'recipe');
  recipeSection.querySelectorAll('[data-site-id]').forEach(card => {
    card.onclick = () => openSiteModal(card.dataset.siteId, 'recipe');
  });

  wrap.appendChild(restSection);
  wrap.appendChild(recipeSection);
  return wrap;
}

/* ─── 通用模块表单 ────────────────────────────── */
function buildGenericForm(payload) {
  const section = document.createElement('div');
  section.className = 'visual-editor-section';

  const keys = Object.keys(payload);
  if (!keys.length) {
    section.innerHTML = `
      <div class="visual-section-header">
        <span class="visual-section-title">模块内容</span>
      </div>
      <p class="panel-sub" style="text-align:center;padding:24px 0">
        该模块暂无内容数据。<br>展开下方「高级 JSON 编辑」填写内容后保存。
      </p>`;
    return section;
  }

  let fieldsHtml = '';
  keys.forEach(key => {
    const val = payload[key];
    if (typeof val === 'string') {
      const isLong = val.length > 80 || val.includes('\n');
      fieldsHtml += `
        <div class="generic-form-field">
          <label>${escHtml(key)}</label>
          ${isLong
            ? `<textarea rows="3" data-gkey="${escHtml(key)}">${escHtml(val)}</textarea>`
            : `<input type="text" value="${escHtml(val)}" data-gkey="${escHtml(key)}">`}
        </div>`;
    } else if (typeof val === 'number') {
      fieldsHtml += `
        <div class="generic-form-field">
          <label>${escHtml(key)}</label>
          <input type="number" value="${val}" data-gkey="${escHtml(key)}">
        </div>`;
    } else if (Array.isArray(val) && val.every(v => typeof v === 'string')) {
      fieldsHtml += `
        <div class="generic-form-field">
          <label>${escHtml(key)} <span class="field-hint">（每行一项）</span></label>
          <textarea rows="3" data-gkey="${escHtml(key)}">${val.map(escHtml).join('\n')}</textarea>
        </div>`;
    } else {
      // 复杂值：JSON 文本框
      fieldsHtml += `
        <div class="generic-form-field">
          <label>${escHtml(key)} <span class="field-hint">（JSON 格式）</span></label>
          <textarea class="code-editor" rows="3" data-gkey="${escHtml(key)}">${escHtml(JSON.stringify(val, null, 2))}</textarea>
        </div>`;
    }
  });

  section.innerHTML = `
    <div class="visual-section-header">
      <span class="visual-section-title">模块内容编辑</span>
    </div>
    <p class="panel-sub">修改内容后点击「保存更改」，再点击「上线当前模块」推送到前台。</p>
    <div class="generic-form" id="generic-form-fields">
      ${fieldsHtml}
    </div>
    <div class="generic-save-row">
      <button class="btn-primary btn-sm" id="generic-save-btn">保存更改</button>
      <span class="field-hint" style="line-height:2">修改后需点击保存</span>
    </div>`;

  section.querySelector('#generic-save-btn').onclick = () => {
    // 从表单读取值
    section.querySelectorAll('[data-gkey]').forEach(el => {
      const key = el.dataset.gkey;
      const orig = payload[key];
      let val = el.value;
      if (typeof orig === 'number') {
        state.currentPayload[key] = Number(val);
      } else if (Array.isArray(orig) && orig.every(v => typeof v === 'string')) {
        state.currentPayload[key] = val.split('\n').map(s => s.trim()).filter(Boolean);
      } else if (typeof orig !== 'string') {
        try { state.currentPayload[key] = JSON.parse(val); } catch { /* keep orig */ }
      } else {
        state.currentPayload[key] = val;
      }
    });
    saveModuleDraft();
  };

  return section;
}

/* ═══════════════════════════════════════════════
   地点 / 餐厅 / 菜谱 编辑 Modal
   ═══════════════════════════════════════════════ */

/** type: 'site' | 'restaurant' | 'recipe' */
function openSiteModal(id, type) {
  state.editingSiteType = type || 'site';
  state.editingSiteId   = id   || null;

  const isPilgrimage  = type === 'site';
  const isRestaurant  = type === 'restaurant';
  const isRecipe      = type === 'recipe';
  const hasMap        = isPilgrimage || isRestaurant;

  // 查找已有数据
  let item = null;
  if (id) {
    const arr = getTypeArray(type);
    item = arr.find(s => String(s.id || s.name || '') === String(id));
  }

  // 标题
  const typeLabel = isPilgrimage ? '朝圣地点' : isRestaurant ? '素食餐厅' : '菜谱';
  $('site-modal-title').textContent = item ? `编辑 ${typeLabel}` : `添加${typeLabel}`;

  // 基础字段
  $('site-name').value       = item?.name       || '';
  $('site-region').value     = item?.region      || '';
  $('site-cover').value      = item?.cover       || item?.coverUrl || '';
  $('site-gallery').value    = (item?.gallery    || []).join('\n');
  $('site-tags').value       = (item?.tags       || []).join(', ');
  $('site-short-desc').value = item?.shortDesc   || '';

  // 地区字段显示控制
  const regionWrap = $('site-region-wrap');
  if (regionWrap) regionWrap.style.display = hasMap ? '' : 'none';

  // 朝圣专属
  $('site-stats-wrap').classList.toggle('hidden', !isPilgrimage);
  $('site-full-desc-wrap').classList.toggle('hidden', isRecipe);
  $('site-tips-wrap').classList.toggle('hidden', !isPilgrimage);
  $('site-transport-wrap').classList.toggle('hidden', !isPilgrimage);
  $('site-accommodation-wrap').classList.toggle('hidden', !isPilgrimage);
  $('site-gallery-wrap').classList.toggle('hidden', isRecipe);

  if (isPilgrimage) {
    $('site-altitude').value      = item?.altitude      || '';
    $('site-season').value        = item?.season        || '';
    $('site-rating').value        = item?.rating        != null ? String(item.rating) : '';
    $('site-full-desc').value     = item?.fullDesc      || '';
    $('site-tips').value          = (item?.tips         || []).join('\n');
    $('site-transport').value     = item?.transport     || '';
    $('site-accommodation').value = item?.accommodation || '';
  }

  // 菜谱专属
  $('recipe-stats-wrap').classList.toggle('hidden', !isRecipe);
  if (isRecipe) {
    $('recipe-difficulty').value  = item?.difficulty   || '简单';
    $('recipe-time').value        = item?.time         || '';
    $('recipe-calories').value    = item?.calories     || '';
    $('site-full-desc').value     = item?.fullDesc     || '';
  }

  // 地图区域显示
  const coordBlock = $('coord-picker')?.closest('.form-group');
  if (coordBlock) coordBlock.style.display = hasMap ? '' : 'none';

  // 坐标
  const cx = item?.coords?.x ?? item?.coord?.x ?? null;
  const cy = item?.coords?.y ?? item?.coord?.y ?? null;
  if ($('site-coord-x')) $('site-coord-x').value = cx != null ? String(cx) : '';
  if ($('site-coord-y')) $('site-coord-y').value = cy != null ? String(cy) : '';

  if (hasMap) {
    renderRefDots(type);
    if (cx != null && cy != null) setCoordDot(cx, cy); else hideCoordDot();
  }

  // 封面预览
  updateSiteCoverPreview($('site-cover').value);

  // 删除按钮
  $('delete-site-btn').classList.toggle('hidden', !item);

  openModal('site-modal');
}

function getTypeArray(type) {
  if (type === 'site')       return state.currentPayload.sites       || [];
  if (type === 'restaurant') return state.currentPayload.restaurants || [];
  if (type === 'recipe')     return state.currentPayload.recipes     || [];
  return [];
}

function setTypeArray(type, arr) {
  if (type === 'site')       state.currentPayload.sites       = arr;
  if (type === 'restaurant') state.currentPayload.restaurants = arr;
  if (type === 'recipe')     state.currentPayload.recipes     = arr;
}

async function saveSite() {
  const type = state.editingSiteType;
  const name = $('site-name').value.trim();
  if (!name) { showToast('名称不能为空', true); return; }

  const cx = Number($('site-coord-x').value || 0);
  const cy = Number($('site-coord-y').value || 0);

  const base = {
    name,
    region:    $('site-region').value.trim(),
    cover:     $('site-cover').value.trim(),
    tags:      $('site-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    shortDesc: $('site-short-desc').value.trim(),
    coords:    { x: cx, y: cy },
  };

  if (type === 'site') {
    Object.assign(base, {
      gallery:       $('site-gallery').value.split('\n').map(s => s.trim()).filter(Boolean),
      altitude:      $('site-altitude').value.trim(),
      season:        $('site-season').value.trim(),
      rating:        parseFloat($('site-rating').value) || null,
      fullDesc:      $('site-full-desc').value.trim(),
      tips:          $('site-tips').value.split('\n').map(s => s.trim()).filter(Boolean),
      transport:     $('site-transport').value.trim(),
      accommodation: $('site-accommodation').value.trim(),
    });
  } else if (type === 'restaurant') {
    Object.assign(base, {
      gallery: $('site-gallery').value.split('\n').map(s => s.trim()).filter(Boolean),
      rating:  parseFloat($('site-rating').value) || null,
      fullDesc: $('site-full-desc').value.trim(),
    });
  } else if (type === 'recipe') {
    Object.assign(base, {
      difficulty: $('recipe-difficulty').value,
      time:       $('recipe-time').value.trim(),
      calories:   $('recipe-calories').value.trim(),
      fullDesc:   $('site-full-desc').value.trim(),
    });
    delete base.coords;
    delete base.region;
  }

  let arr = [...getTypeArray(type)];
  const existingIdx = arr.findIndex(s => String(s.id || s.name || '') === String(state.editingSiteId || ''));

  if (state.editingSiteId && existingIdx >= 0) {
    // 保留旧 id
    base.id = arr[existingIdx].id || state.editingSiteId;
    arr[existingIdx] = base;
  } else {
    // 新增：生成 id
    base.id = Date.now().toString(36);
    arr.push(base);
  }

  setTypeArray(type, arr);
  markDirty();
  closeModal('site-modal');
  renderVisualEditor(state.moduleKey, state.currentPayload);
  $('module-json').value = JSON.stringify(state.currentPayload, null, 2);

  // 自动保存
  await saveModuleDraft();
  showToast(`${type === 'site' ? '朝圣地点' : type === 'restaurant' ? '餐厅' : '菜谱'} 已保存 ✓`);
}

async function deleteSite() {
  const type = state.editingSiteType;
  const id   = state.editingSiteId;
  if (!id) return;
  const ok = await confirmDialog(`确认删除「${$('site-name').value || id}」？此操作不可撤销。`, '删除确认');
  if (!ok) return;

  let arr = getTypeArray(type).filter(s => String(s.id || s.name || '') !== String(id));
  setTypeArray(type, arr);
  markDirty();
  closeModal('site-modal');
  renderVisualEditor(state.moduleKey, state.currentPayload);
  $('module-json').value = JSON.stringify(state.currentPayload, null, 2);
  await saveModuleDraft();
  showToast('已删除');
}

function updateSiteCoverPreview(url) {
  const preview     = $('site-cover-preview');
  const placeholder = $('site-cover-placeholder');
  const thumb       = $('site-cover-thumb');
  if (url) {
    if (preview)     { preview.src = url; preview.classList.remove('hidden'); }
    if (placeholder) placeholder.style.display = 'none';
    if (thumb)       { thumb.src = url; thumb.classList.remove('hidden'); }
  } else {
    if (preview)     preview.classList.add('hidden');
    if (placeholder) { placeholder.style.display = ''; placeholder.textContent = '填写封面 URL 后自动预览'; }
    if (thumb)       thumb.classList.add('hidden');
  }
}

/* ═══════════════════════════════════════════════
   坐标选取器
   ═══════════════════════════════════════════════ */
function initCoordPicker() {
  const picker = $('coord-picker');
  if (!picker) return;
  picker.addEventListener('click', e => {
    const rect = picker.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const py   = e.clientY - rect.top;
    // 将点击位置映射到地图坐标
    const x = Math.round((px / rect.width)  * MAP_W);
    const y = Math.round((py / rect.height) * MAP_H);
    $('site-coord-x').value = Math.max(0, Math.min(MAP_W, x));
    $('site-coord-y').value = Math.max(0, Math.min(MAP_H, y));
    setCoordDot(x, y);
  });
  // 手动输入坐标 → 更新点
  ['site-coord-x', 'site-coord-y'].forEach(id => {
    $(id)?.addEventListener('input', () => {
      const x = Number($('site-coord-x').value || 0);
      const y = Number($('site-coord-y').value || 0);
      if (!isNaN(x) && !isNaN(y)) setCoordDot(x, y);
    });
  });
}

function setCoordDot(x, y) {
  const picker = $('coord-picker');
  const dot    = $('coord-dot');
  if (!picker || !dot) return;
  const rect = picker.getBoundingClientRect();
  const w    = rect.width  || picker.offsetWidth;
  const h    = rect.height || picker.offsetHeight;
  const left = (x / MAP_W) * 100;
  const top  = (y / MAP_H) * 100;
  dot.style.left    = `${left}%`;
  dot.style.top     = `${top}%`;
  dot.style.display = 'block';
}

function hideCoordDot() {
  const dot = $('coord-dot');
  if (dot) dot.style.display = 'none';
}

function renderRefDots(type) {
  const container = $('coord-ref-dots');
  if (!container) return;
  const arr = getTypeArray(type);
  const currentId = state.editingSiteId;
  container.innerHTML = arr
    .filter(s => String(s.id || s.name || '') !== String(currentId || ''))
    .filter(s => s.coords?.x != null && s.coords?.y != null)
    .map(s => {
      const left = (s.coords.x / MAP_W) * 100;
      const top  = (s.coords.y / MAP_H) * 100;
      return `<div class="coord-ref-dot" data-name="${escHtml(s.name || '')}"
        style="left:${left}%;top:${top}%"></div>`;
    }).join('');
}

/* ═══════════════════════════════════════════════
   文章管理
   ═══════════════════════════════════════════════ */
async function loadArticles() {
  const data = await fetchJson(`/api/admin/articles?module=${encodeURIComponent(state.moduleKey)}`, {
    headers: authHeaders(),
  });
  state.articles = data.articles || [];
  renderArticleGrid();
  updateChips();
}

function renderArticleGrid() {
  const root    = $('article-list');
  const keyword = state.articleKeyword.trim().toLowerCase();
  const list    = state.articles.filter(a =>
    !keyword ||
    String(a.title || '').toLowerCase().includes(keyword) ||
    String(a.slug  || '').toLowerCase().includes(keyword)
  );

  if (!list.length) {
    root.innerHTML = `
      <div class="article-empty">
        <div class="article-empty-icon">📄</div>
        <p>${keyword ? '没有匹配的文章' : '当前模块暂无草稿文章'}</p>
        ${!keyword ? '<p style="margin-top:8px;font-size:12px;color:#a0927e">点击右上角「新建文章」开始创建</p>' : ''}
      </div>`;
    return;
  }

  root.innerHTML = list.map(a => `
    <div class="article-card" data-slug="${a.slug}">
      ${a.cover_url
        ? `<img class="article-card-cover" src="${a.cover_url}" alt="${escHtml(a.title)}" onerror="this.style.display='none'">`
        : `<div class="article-card-cover-placeholder">🖼</div>`}
      <div class="article-card-body">
        <div class="article-card-title">${escHtml(a.title)}</div>
        <div class="article-card-slug">${escHtml(a.slug)}</div>
        ${a.summary ? `<div class="article-card-summary">${escHtml(a.summary)}</div>` : ''}
      </div>
      <div class="article-card-footer">
        <button class="btn-ghost btn-sm" data-action="edit">编辑 →</button>
      </div>
    </div>
  `).join('');

  root.querySelectorAll('.article-card').forEach(card => {
    card.querySelector('[data-action="edit"]').onclick = e => {
      e.stopPropagation();
      openArticleModal(card.dataset.slug);
    };
    card.onclick = () => openArticleModal(card.dataset.slug);
  });
}

function openArticleModal(slug = null) {
  state.editingArticleSlug = slug;
  const article = slug ? state.articles.find(a => a.slug === slug) : null;

  $('article-modal-title').textContent = article ? '编辑文章' : '新建文章';
  $('article-title').value   = article?.title       || '';
  $('article-slug').value    = article?.slug        || '';
  $('article-summary').value = article?.summary     || '';
  $('article-cover').value   = article?.cover_url   || '';
  $('article-url').value     = article?.article_url || '';
  $('article-md').value      = article?.content_md  || '';
  $('article-sort').value    = article?.sort_order  != null ? String(article.sort_order) : '';
  $('article-tags').value    = Array.isArray(article?.tags) ? article.tags.join(', ') : '';

  $('delete-article-btn').style.display = article ? '' : 'none';
  updateCoverPreview($('article-cover').value);

  // 关闭预览，显示编辑器
  $('article-md').classList.remove('hidden');
  $('article-md-preview').classList.add('hidden');
  $('md-preview-toggle').textContent = '👁 预览';

  openModal('article-modal');
}

function updateCoverPreview(url) {
  const img         = $('article-cover-preview');
  const placeholder = $('cover-placeholder');
  if (url) {
    img.src = url;
    img.classList.remove('hidden');
    if (placeholder) placeholder.style.display = 'none';
    img.onerror = () => {
      img.classList.add('hidden');
      if (placeholder) { placeholder.style.display = ''; placeholder.textContent = 'URL 无法加载图片'; }
    };
  } else {
    img.classList.add('hidden');
    if (placeholder) { placeholder.style.display = ''; placeholder.textContent = '填写封面 URL 后自动预览'; }
  }
}

async function upsertArticle() {
  const btn = $('upsert-article-btn');
  setLoading(btn, true);
  try {
    const tagsRaw = $('article-tags').value;
    const tags    = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    await fetchJson('/api/admin/articles', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        module_key:  state.moduleKey,
        slug:        $('article-slug').value.trim(),
        title:       $('article-title').value.trim(),
        summary:     $('article-summary').value.trim(),
        cover_url:   $('article-cover').value.trim(),
        article_url: $('article-url').value.trim(),
        content_md:  $('article-md').value.trim(),
        sort_order:  Number($('article-sort').value || 0),
        tags,
      }),
    });
    closeModal('article-modal');
    await loadArticles();
    showToast('文章已保存 ✓');
  } catch (err) {
    showToast(`保存失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

async function deleteArticle() {
  const slug = state.editingArticleSlug;
  if (!slug) return;
  const ok = await confirmDialog(`确认删除文章「${slug}」？此操作不可撤销。`, '删除文章');
  if (!ok) return;
  const btn = $('delete-article-btn');
  setLoading(btn, true);
  try {
    await fetchJson('/api/admin/articles', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ module_key: state.moduleKey, slug }),
    });
    closeModal('article-modal');
    await loadArticles();
    showToast('文章已删除');
  } catch (err) {
    showToast(`删除失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

/* ─── Markdown 预览 ─────────────────────────── */
function simpleMarkdown(md) {
  return (md || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm,    '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,     '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,      '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g,  '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,      '<em>$1</em>')
    .replace(/`(.+?)`/g,        '<code>$1</code>')
    .replace(/^> (.+)$/gm,      '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm,      '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hupba])/gm, '')
    .replace(/^(.+)$/gm, s => /^<[hupba]/.test(s) ? s : `<p>${s}</p>`)
    .replace(/<p><\/p>/g, '');
}

function toggleMdPreview() {
  const src     = $('article-md');
  const preview = $('article-md-preview');
  const btn     = $('md-preview-toggle');
  const showing = !preview.classList.contains('hidden');
  if (showing) {
    preview.classList.add('hidden');
    src.classList.remove('hidden');
    btn.textContent = '👁 预览';
  } else {
    preview.innerHTML = simpleMarkdown(src.value);
    preview.classList.remove('hidden');
    src.classList.add('hidden');
    btn.textContent = '✏ 编辑';
  }
}

/* ═══════════════════════════════════════════════
   图片上传
   ═══════════════════════════════════════════════ */
let _pendingFile = null;

function setPendingFile(file) {
  if (!file) return;
  _pendingFile = file;
  const preview = $('upload-preview');
  const idle    = $('drop-zone-idle');
  preview.src   = URL.createObjectURL(file);
  preview.classList.remove('hidden');
  idle.style.display = 'none';
  $('upload-btn').disabled = false;
}

function clearUpload() {
  _pendingFile = null;
  $('upload-preview').classList.add('hidden');
  $('upload-preview').src = '';
  $('drop-zone-idle').style.display = '';
  $('upload-result-row').classList.add('hidden');
  $('upload-result').value = '';
  $('file-input').value = '';
  $('upload-btn').disabled = true;
}

async function uploadMedia() {
  const file = _pendingFile;
  if (!file) { showToast('请先选择图片', true); return; }
  const btn = $('upload-btn');
  setLoading(btn, true);
  try {
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(String(reader.result));
      reader.onerror = () => rej(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
    const data = await fetchJson('/api/admin/media-upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        moduleKey:  state.moduleKey,
        fileName:   file.name,
        mimeType:   file.type || 'image/png',
        base64Data: dataUrl,
      }),
    });
    $('upload-result').value = data.publicUrl;
    $('upload-result-row').classList.remove('hidden');
    showToast('上传成功！URL 已就绪，可复制使用 ✓');
  } catch (err) {
    showToast(`上传失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

function copyUploadUrl() {
  const url = $('upload-result').value;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => showToast('URL 已复制到剪贴板'));
}

/* ═══════════════════════════════════════════════
   用户管理
   ═══════════════════════════════════════════════ */
async function loadUsers() {
  const data = await fetchJson('/api/admin/users', { headers: authHeaders() });
  state.users = data.users || [];
  renderUserList();
  updateChips();
}

function renderUserList() {
  const root    = $('user-list');
  const keyword = state.userKeyword.trim().toLowerCase();
  const list    = state.users.filter(u =>
    !keyword ||
    String(u.email        || '').toLowerCase().includes(keyword) ||
    String(u.display_name || '').toLowerCase().includes(keyword) ||
    String(u.role         || '').toLowerCase().includes(keyword)
  );

  if (!list.length) { root.innerHTML = '<div class="user-empty">暂无用户数据</div>'; return; }

  root.innerHTML = list.map(u => `
    <div class="user-row" data-id="${u.id}">
      <div class="user-row-avatar">${(u.display_name || u.email || 'U')[0].toUpperCase()}</div>
      <div class="user-row-info">
        <div class="user-row-name">${escHtml(u.display_name || '（未设置显示名）')}</div>
        <div class="user-row-email">${escHtml(u.email || u.id)}</div>
      </div>
      <div class="user-row-badges">
        <span class="badge badge-${u.role}">${u.role}</span>
        <span class="badge badge-${u.status}">${u.status}</span>
      </div>
    </div>
  `).join('');

  root.querySelectorAll('.user-row').forEach(row => {
    row.onclick = () => openUserModal(row.dataset.id);
  });
}

function openUserModal(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  $('user-id').value            = u.id           || '';
  $('user-email-display').value = u.email        || '';
  $('user-display-name').value  = u.display_name || '';
  $('user-role').value          = u.role         || 'viewer';
  $('user-status').value        = u.status       || 'active';
  openModal('user-modal');
}

async function updateUser() {
  const btn = $('update-user-btn');
  setLoading(btn, true);
  try {
    await fetchJson('/api/admin/users', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        id:           $('user-id').value.trim(),
        display_name: $('user-display-name').value.trim(),
        role:         $('user-role').value,
        status:       $('user-status').value,
      }),
    });
    closeModal('user-modal');
    await loadUsers();
    showToast('用户信息已更新 ✓');
  } catch (err) {
    showToast(`更新失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════════
   发布
   ═══════════════════════════════════════════════ */
function openPublishModal() {
  const m = MODULES.find(x => x.key === state.moduleKey);
  $('publish-module-name').textContent = m?.label || state.moduleKey;
  $('publish-notes').value = '';
  openModal('publish-modal');
}

async function confirmPublish() {
  const btn = $('confirm-publish-btn');
  setLoading(btn, true);
  try {
    const data = await fetchJson('/api/admin/publish', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        moduleKey: state.moduleKey,
        notes:     $('publish-notes').value.trim(),
      }),
    });
    closeModal('publish-modal');
    showToast(`🚀 上线成功！版本 #${data.version} 已推送到前台`);
    await loadPublishStatus();
  } catch (err) {
    showToast(`发布失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════════
   侧栏折叠
   ═══════════════════════════════════════════════ */
function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('app-shell').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  localStorage.setItem('modao-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');
}

/* ═══════════════════════════════════════════════
   Tab 切换
   ═══════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

function switchTab(tabKey) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabKey)
  );
  document.querySelectorAll('.tab-pane').forEach(pane =>
    pane.classList.toggle('hidden', pane.dataset.tab !== tabKey)
  );
}

/* ═══════════════════════════════════════════════
   统计 Chips
   ═══════════════════════════════════════════════ */
function updateChips() {
  $('chip-articles').textContent = `文章 ${state.articles.length} 篇`;
  $('chip-users').textContent    = `用户 ${state.users.length} 人`;
}

/* ═══════════════════════════════════════════════
   刷新全部
   ═══════════════════════════════════════════════ */
async function reloadAll() {
  if (!state.token) return;
  const btn = $('reload-all-btn');
  setLoading(btn, true);
  const errors = [];
  try { await loadModuleDraft();   } catch (e) { errors.push(`内容：${e.message}`); }
  try { await loadArticles();      } catch (e) { errors.push(`文章：${e.message}`); }
  try { await loadUsers();         } catch (e) { errors.push(`用户：${e.message}`); }
  try { await loadPublishStatus(); } catch (e) { /* 发布状态失败不报错 */ }
  setLoading(btn, false);
  if (errors.length) showToast(`部分加载失败：${errors[0]}`, true);
  else               showToast('数据已刷新 ✓');
}

/* ═══════════════════════════════════════════════
   工具函数
   ═══════════════════════════════════════════════ */
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════
   事件绑定
   ═══════════════════════════════════════════════ */
function bindEvents() {
  // 登录
  $('login-btn').onclick          = login;
  $('settings-btn-login').onclick = openSettings;
  $('password').onkeydown         = e => { if (e.key === 'Enter') login(); };

  // 顶部
  $('logout-btn').onclick         = logout;
  $('toggle-sidebar-btn').onclick = toggleSidebar;
  $('reload-all-btn').onclick     = reloadAll;
  $('settings-btn').onclick       = openSettings;

  // 设置 Modal
  $('save-settings-btn').onclick  = saveSettings;

  // 内容 Tab — 草稿保存
  $('save-module-btn').onclick    = saveModuleDraft;

  // 地点 Modal 按钮
  $('save-site-btn').onclick      = saveSite;
  $('delete-site-btn').onclick    = deleteSite;
  $('site-cover').oninput        = e => updateSiteCoverPreview(e.target.value);

  // 坐标选取器
  initCoordPicker();

  // 文章 Tab
  $('new-article-btn').onclick    = () => openArticleModal(null);
  $('upsert-article-btn').onclick = upsertArticle;
  $('delete-article-btn').onclick = deleteArticle;
  $('article-search').oninput     = e => { state.articleKeyword = e.target.value; renderArticleGrid(); };
  $('article-cover').oninput      = e => updateCoverPreview(e.target.value);
  $('md-preview-toggle').onclick  = toggleMdPreview;

  // 媒体 Tab
  $('file-input').onchange        = e => setPendingFile(e.target.files?.[0]);
  $('upload-btn').onclick         = uploadMedia;
  $('copy-url-btn').onclick       = copyUploadUrl;
  $('clear-upload-btn').onclick   = clearUpload;

  // 拖放上传
  const dz = $('drop-zone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragging'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('dragging'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragging');
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith('image/')) setPendingFile(file);
    else showToast('请拖入图片文件', true);
  });

  // 用户 Tab
  $('user-search').oninput        = e => { state.userKeyword = e.target.value; renderUserList(); };
  $('update-user-btn').onclick    = updateUser;

  // 发布
  $('publish-btn').onclick         = openPublishModal;
  $('confirm-publish-btn').onclick = confirmPublish;

  // Modal 点击遮罩关闭
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.onclick = e => { if (e.target === overlay) overlay.classList.add('hidden'); };
  });

  // ESC 关闭 Modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
    // Ctrl/Cmd + S → 保存草稿
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveModuleDraft();
    }
  });

  // 粘贴图片
  document.addEventListener('paste', e => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          switchTab('media');
          setPendingFile(file);
          showToast('已粘贴图片，点击上传即可');
        }
      }
    }
  });

  // 离开前警告
  window.addEventListener('beforeunload', e => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* ═══════════════════════════════════════════════
   启动
   ═══════════════════════════════════════════════ */
async function boot() {
  if (state.sidebarCollapsed) {
    document.body.classList.add('sidebar-collapsed');
    $('app-shell').classList.add('sidebar-collapsed');
  }

  initTabs();
  bindEvents();

  if (state.token) {
    try {
      await refreshProfile();
      initModuleNav();
      showAppShell();
      await reloadAll();
    } catch {
      state.token = '';
      localStorage.removeItem('modao-admin-token');
      showLoginScreen();
      initModuleNav();
    }
  } else {
    showLoginScreen();
    initModuleNav();
  }
}

boot();
