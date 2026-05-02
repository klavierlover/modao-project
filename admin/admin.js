import { createClient } from '@supabase/supabase-js';

/* ═══════════════════════════════════════════════
   内容类型定义
   ═══════════════════════════════════════════════ */
const TYPES = {
  site:       { label: '朝圣地点', icon: '🕍', module: 'pilgrimage', arrayKey: 'sites' },
  restaurant: { label: '素食餐厅', icon: '🍜', module: 'vegan',      arrayKey: 'restaurants' },
  recipe:     { label: '素食菜谱', icon: '🥗', module: 'vegan',      arrayKey: 'recipes' },
  sutra:      { label: '佛学书库', icon: '📚', module: 'library',    arrayKey: 'sutras' },
  article:    { label: '文章攻略', icon: '📖', module: null,          arrayKey: null },
  forum:      { label: '论坛帖子', icon: '🗣',  module: 'forum',      arrayKey: null },
};

const MAP_W = 700, MAP_H = 480;

/* ═══════════════════════════════════════════════
   全局状态
   ═══════════════════════════════════════════════ */
const state = {
  token:      localStorage.getItem('modao-admin-token') || '',
  profile:    null,
  currentView:'hub',

  // Hub
  hubFilter:  'all',
  hubSearch:  '',
  allContent: [],   // [{_type, _id, name/title, cover, shortDesc/summary, region, sort, visible, ...}]

  // 已加载的模块 payload 缓存
  payloads:   {},   // { pilgrimage: {sites:[],...}, vegan: {...} }

  // Articles (from API)
  articles:   [],

  // Publisher
  publisherMode: 'new',   // 'new' | 'edit'
  editingType:   'site',
  editingId:     null,
  tags:          [],
  coverUrl:      '',

  // Users
  users:      [],
  userSearch: '',
  editingUserId: null,
};

/* ═══════════════════════════════════════════════
   DOM helpers
   ═══════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

function showToast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

function setLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

window.closeModal = id => $(id)?.classList.add('hidden');
const openModal  = id => $(id)?.classList.remove('hidden');

function confirmDialog(msg, title = '确认操作', okLabel = '确认') {
  return new Promise(resolve => {
    $('confirm-title').textContent   = title;
    $('confirm-message').textContent = msg;
    $('confirm-ok').textContent      = okLabel;
    openModal('confirm-modal');
    const cleanup = result => {
      closeModal('confirm-modal');
      $('confirm-ok').onclick = $('confirm-cancel').onclick = null;
      resolve(result);
    };
    $('confirm-ok').onclick     = () => cleanup(true);
    $('confirm-cancel').onclick = () => cleanup(false);
  });
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══════════════════════════════════════════════
   认证
   ═══════════════════════════════════════════════ */
function getCfg() {
  return {
    url:     localStorage.getItem('modao-supabase-url')  || '',
    anonKey: localStorage.getItem('modao-supabase-anon') || '',
  };
}

async function login() {
  const email    = $('email').value.trim();
  const password = $('password').value.trim();
  const cfg      = getCfg();
  if (!cfg.url || !cfg.anonKey) { openModal('settings-modal'); showToast('请先配置 Supabase', true); return; }
  if (!email || !password)      { showLoginError('请填写邮箱和密码'); return; }
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
    await loadAllContent();
    showApp();
    showToast('登录成功！');
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
  state.token = '';
  localStorage.removeItem('modao-admin-token');
  $('login-screen').classList.remove('hidden');
  $('app-shell').classList.add('hidden');
  showToast('已退出');
}

function showApp() {
  $('login-screen').classList.add('hidden');
  $('app-shell').classList.remove('hidden');
}

async function refreshProfile() {
  try {
    const data = await api('/api/admin/profile', { headers: authHdr() });
    state.profile = data.profile;
    $('user-avatar').textContent = (data.user?.email || 'A')[0].toUpperCase();
    $('user-name').textContent   = state.profile?.display_name || data.user?.email || '管理员';
    const rb = $('user-role-badge');
    rb.textContent = state.profile?.role || '';
    rb.className   = `badge badge-${state.profile?.role || 'viewer'}`;
  } catch (e) { console.error('[refreshProfile]', e); state.profile = null; }
}

/* ═══════════════════════════════════════════════
   设置
   ═══════════════════════════════════════════════ */
function openSettings() {
  const cfg = getCfg();
  $('settings-url').value      = cfg.url;
  $('settings-anon-key').value = cfg.anonKey;
  openModal('settings-modal');
}
function saveSettings() {
  const url = $('settings-url').value.trim(), key = $('settings-anon-key').value.trim();
  if (!url || !key) { showToast('URL 和 Key 不能为空', true); return; }
  localStorage.setItem('modao-supabase-url',  url);
  localStorage.setItem('modao-supabase-anon', key);
  closeModal('settings-modal');
  showToast('配置已保存');
}

/* ═══════════════════════════════════════════════
   网络请求
   ═══════════════════════════════════════════════ */
function authHdr() { return state.token ? { Authorization: `Bearer ${state.token}` } : {}; }

async function api(url, opts = {}) {
  // 自动合并 Authorization header，确保每次调用都带 token
  const headers = { ...authHdr(), ...(opts.headers || {}) };
  const resp = await fetch(url, { ...opts, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

/* ═══════════════════════════════════════════════
   加载所有内容
   ═══════════════════════════════════════════════ */
async function loadAllContent() {
  const btn = $('reload-btn');
  setLoading(btn, true);
  try {
    // 并行加载四个模块 + 全部文章 + 用户
    const [pilgrimageData, veganData, libraryData, articlesData, usersData] = await Promise.allSettled([
      api(`/api/admin/content?module=pilgrimage`, { headers: authHdr() }),
      api(`/api/admin/content?module=vegan`,      { headers: authHdr() }),
      api(`/api/admin/content?module=library`,    { headers: authHdr() }),
      api(`/api/admin/articles?all=1`,            { headers: authHdr() }),
      api(`/api/admin/users`,                     { headers: authHdr() }),
    ]);

    // 缓存 payload
    if (pilgrimageData.status === 'fulfilled') {
      const root = (pilgrimageData.value.blocks || []).find(b => b.block_key === 'module_root');
      state.payloads.pilgrimage = root?.payload || {};
    }
    if (veganData.status === 'fulfilled') {
      const root = (veganData.value.blocks || []).find(b => b.block_key === 'module_root');
      state.payloads.vegan = root?.payload || {};
    }
    if (libraryData.status === 'fulfilled') {
      const root = (libraryData.value.blocks || []).find(b => b.block_key === 'module_root');
      state.payloads.library = root?.payload || {};
    }

    // 用户
    if (usersData.status === 'fulfilled') {
      state.users = usersData.value.users || [];
      renderUsers();
    }

    // 组合所有内容为扁平列表
    const sites       = (state.payloads.pilgrimage?.sites       || []).map((s,i) => ({ ...s, _type:'site',       _id: String(s.id||s.name||i), _sort: s.sort??i }));
    const restaurants = (state.payloads.vegan?.restaurants       || []).map((s,i) => ({ ...s, _type:'restaurant', _id: String(s.id||s.name||i), _sort: s.sort??i }));
    const recipes     = (state.payloads.vegan?.recipes           || []).map((s,i) => ({ ...s, _type:'recipe',     _id: String(s.id||s.name||i), _sort: s.sort??i }));
    const sutras      = (state.payloads.library?.sutras          || []).map((s,i) => ({
      ...s, _type:'sutra', _id: String(s.id||s.title||i),
      name: s.title, shortDesc: s.desc, _sort: s.sort??i,
    }));
    const articles    = articlesData.status === 'fulfilled'
      ? (articlesData.value.articles || []).map(a => ({
          ...a, _type: a.module_key === 'forum' ? 'forum' : 'article',
          _id: a.slug, name: a.title, cover: a.cover_url,
          shortDesc: a.summary, _sort: a.sort_order ?? 0,
        }))
      : [];

    state.allContent = [...sites, ...restaurants, ...recipes, ...sutras, ...articles];
    renderHub();
  } catch (err) {
    showToast(`加载失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════════
   视图切换
   ═══════════════════════════════════════════════ */
function switchView(viewId) {
  state.currentView = viewId;
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('hidden', v.id !== `view-${viewId}`)
  );
  document.querySelectorAll('.nav-btn[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === viewId)
  );
}

/* ═══════════════════════════════════════════════
   内容管理 Hub
   ═══════════════════════════════════════════════ */
function renderHub() {
  const keyword = state.hubSearch.trim().toLowerCase();
  const filter  = state.hubFilter;

  let list = state.allContent.filter(item => {
    if (filter !== 'all' && item._type !== filter) return false;
    if (keyword) {
      const haystack = `${item.name||''} ${item.shortDesc||''} ${item.region||''} ${(item.tags||[]).join(' ')}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });

  // Sort by _sort
  list = [...list].sort((a,b) => (a._sort??0) - (b._sort??0));

  const grid = $('content-grid');
  if (!list.length) {
    grid.innerHTML = `
      <div class="grid-empty">
        <div class="grid-empty-icon">📭</div>
        <p>${keyword || filter !== 'all' ? '没有匹配的内容' : '暂无内容'}</p>
        <p class="hint">点击右上角「发布内容」添加第一条</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(item => buildContentCard(item)).join('');

  // 绑定事件
  grid.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const { action, id, type } = btn.dataset;
      if (action === 'edit')    openPublisher(id, type);
      if (action === 'delete')  deleteItem(id, type);
      if (action === 'up')      shiftSort(id, type, -1);
      if (action === 'down')    shiftSort(id, type, +1);
      if (action === 'toggle')  toggleVisible(id, type);
    };
  });
}

function buildContentCard(item) {
  const t       = TYPES[item._type] || { label: item._type, icon: '📄' };
  const visible = item.visible !== false;
  const cover   = item.cover || item.cover_url || '';
  const name    = escHtml(item.name || item.title || '（无标题）');
  const sub     = escHtml(item.shortDesc || item.summary || item.region || '');

  return `
    <div class="content-card${visible ? '' : ' hidden-item'}" data-id="${escHtml(item._id)}" data-type="${item._type}">
      ${cover
        ? `<img class="card-cover" src="${escHtml(cover)}" alt="${name}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="card-cover-placeholder">${t.icon}</div>`}
      <div class="card-sort-num">#${(item._sort??0)+1}</div>
      <div class="card-body">
        <span class="card-type-badge">${t.icon} ${t.label}</span>
        <div class="card-title">${name}</div>
        ${sub ? `<div class="card-sub">${sub}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="visibility-toggle${visible ? '' : ' hidden-state'}"
          data-action="toggle" data-id="${escHtml(item._id)}" data-type="${item._type}">
          ${visible ? '✓ 已上线' : '● 已下线'}
        </button>
        <span class="card-action-spacer"></span>
        <button class="card-action-btn icon" title="上移" data-action="up"   data-id="${escHtml(item._id)}" data-type="${item._type}">↑</button>
        <button class="card-action-btn icon" title="下移" data-action="down" data-id="${escHtml(item._id)}" data-type="${item._type}">↓</button>
        <button class="card-action-btn edit"   data-action="edit"   data-id="${escHtml(item._id)}" data-type="${item._type}">编辑</button>
        <button class="card-action-btn delete" data-action="delete" data-id="${escHtml(item._id)}" data-type="${item._type}">删除</button>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════
   上下线切换
   ═══════════════════════════════════════════════ */
async function toggleVisible(id, type) {
  const t = TYPES[type];
  if (!t?.arrayKey) {
    showToast('文章/帖子暂不支持上下线切换', true); return;
  }
  const arr = getPayloadArray(type);
  const idx = arr.findIndex(s => String(s.id||s.name||'') === String(id));
  if (idx < 0) return;
  arr[idx].visible = arr[idx].visible === false ? true : false;
  setPayloadArray(type, arr);
  await saveAndPublishModule(t.module);
  await loadAllContent();
  showToast(arr[idx].visible ? '已上线 ✓' : '已下线');
}

/* ═══════════════════════════════════════════════
   排序
   ═══════════════════════════════════════════════ */
async function shiftSort(id, type, delta) {
  const t = TYPES[type];
  if (!t?.arrayKey) return;
  let arr = getPayloadArray(type);
  const idx = arr.findIndex(s => String(s.id||s.name||'') === String(id));
  if (idx < 0) return;
  const newIdx = Math.max(0, Math.min(arr.length - 1, idx + delta));
  if (newIdx === idx) return;
  const [item] = arr.splice(idx, 1);
  arr.splice(newIdx, 0, item);
  // 重写 sort 字段
  arr = arr.map((s, i) => ({ ...s, sort: i }));
  setPayloadArray(type, arr);
  await saveAndPublishModule(t.module);
  await loadAllContent();
  showToast('排序已更新 ✓');
}

/* ═══════════════════════════════════════════════
   删除内容
   ═══════════════════════════════════════════════ */
async function deleteItem(id, type) {
  const t = TYPES[type];
  const ok = await confirmDialog(`确认删除？此操作不可撤销。`, '删除确认', '删除');
  if (!ok) return;
  if (t?.arrayKey) {
    const arr = getPayloadArray(type).filter(s => String(s.id||s.name||'') !== String(id));
    setPayloadArray(type, arr);
    await saveAndPublishModule(t.module);
  } else {
    // 文章/帖子 — 从 allContent 拿到真实的 module_key
    const item = state.allContent.find(c => c._id === id && c._type === type);
    const moduleKey = item?.module_key || (type === 'forum' ? 'forum' : 'library');
    await api('/api/admin/articles', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHdr() },
      body: JSON.stringify({ module_key: moduleKey, slug: id }),
    });
  }
  await loadAllContent();
  showToast('已删除');
}

/* ═══════════════════════════════════════════════
   Payload 工具
   ═══════════════════════════════════════════════ */
function getPayloadArray(type) {
  const t = TYPES[type];
  if (!t?.arrayKey) return [];
  const payload = state.payloads[t.module] || {};
  return [...(payload[t.arrayKey] || [])];
}

function setPayloadArray(type, arr) {
  const t = TYPES[type];
  if (!t?.arrayKey) return;
  if (!state.payloads[t.module]) state.payloads[t.module] = {};
  state.payloads[t.module][t.arrayKey] = arr;
}

async function ensurePayloadLoaded(moduleKey) {
  if (state.payloads[moduleKey]) return;
  const data = await api(`/api/admin/content?module=${moduleKey}`, { headers: authHdr() });
  const root = (data.blocks || []).find(b => b.block_key === 'module_root');
  state.payloads[moduleKey] = root?.payload || {};
}

async function saveAndPublishModule(moduleKey) {
  const payload = state.payloads[moduleKey] || {};
  // 保存草稿
  await api('/api/admin/content', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', ...authHdr() },
    body: JSON.stringify({ moduleKey, blockKey: 'module_root', payload }),
  });
  // 发布
  await api('/api/admin/publish', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHdr() },
    body: JSON.stringify({ moduleKey, notes: '后台自动发布' }),
  });
}

/* ═══════════════════════════════════════════════
   发布器 Publisher
   ═══════════════════════════════════════════════ */
function openPublisher(id = null, type = 'site') {
  state.publisherMode = id ? 'edit' : 'new';
  state.editingType   = type;
  state.editingId     = id;
  state.tags          = [];
  state.coverUrl      = '';

  $('publisher-title').textContent = id ? '编辑内容' : '发布新内容';

  // 类型选择器：新建时显示，编辑时隐藏
  $('type-selector').style.display = id ? 'none' : '';

  // 选中当前类型
  setActiveTypePill(type);

  // 渲染表单
  renderPublisherForm(type, id);

  switchView('publisher');
}

function setActiveTypePill(type) {
  document.querySelectorAll('.type-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.type === type);
  });
}

function renderPublisherForm(type, id) {
  // 找到已有数据
  let item = null;
  if (id) {
    const t = TYPES[type];
    if (t?.arrayKey) {
      const arr = getPayloadArray(type);
      item = arr.find(s => String(s.id||s.name||'') === String(id));
    } else {
      item = state.allContent.find(c => c._id === id && c._type === type);
    }
  }

  // 重置封面
  state.coverUrl = item?.cover || item?.cover_url || '';
  updateCoverPreview(state.coverUrl);
  if ($('f-cover-url')) $('f-cover-url').value = state.coverUrl;

  // 标题/描述
  $('f-title').value = item?.name || item?.title || '';
  $('f-desc').value  = item?.shortDesc || item?.summary || '';

  // 标签
  state.tags = [...(item?.tags || [])];
  renderTagChips();

  // 地区
  const regionGroup = $('f-region-group');
  if (regionGroup) {
    const hasRegion = ['site','restaurant'].includes(type);
    regionGroup.style.display = hasRegion ? '' : 'none';
    if (hasRegion && $('f-region')) $('f-region').value = item?.region || '';
  }

  // 坐标区域
  const coordSection = $('coord-section');
  const hasCoord = ['site','restaurant'].includes(type);
  coordSection.classList.toggle('hidden', !hasCoord);
  if (hasCoord) {
    const cx = item?.coords?.x ?? null;
    const cy = item?.coords?.y ?? null;
    $('f-coord-x').value = cx != null ? String(cx) : '';
    $('f-coord-y').value = cy != null ? String(cy) : '';
    if (cx != null && cy != null) setCoordDot(cx, cy);
    else $('coord-dot').classList.add('hidden');
    renderRefDots(type, id);
  }

  // 类型专属字段
  renderTypeFields(type, item);

  // 预览
  updatePreview();
}

/* ── 类型专属字段 ── */
function renderTypeFields(type, item) {
  const root = $('type-fields');
  root.innerHTML = '';

  if (type === 'site') {
    root.innerHTML = `
      <div class="form-section">
        <div class="section-title">🕍 朝圣地点详情</div>
        <div class="form-row-3">
          <div class="form-group">
            <label>海拔</label>
            <input id="f-altitude" placeholder="3700m" value="${escHtml(item?.altitude||'')}">
          </div>
          <div class="form-group">
            <label>最佳时节</label>
            <input id="f-season" placeholder="4-10月" value="${escHtml(item?.season||'')}">
          </div>
          <div class="form-group">
            <label>评分（0-5）</label>
            <input id="f-rating" type="number" step="0.1" min="0" max="5" placeholder="4.9" value="${item?.rating??''}">
          </div>
        </div>
        <div class="form-group">
          <label>详细介绍</label>
          <textarea id="f-full-desc" rows="4" placeholder="完整描述…">${escHtml(item?.fullDesc||'')}</textarea>
        </div>
        <div class="form-group">
          <label>注意事项 <span class="field-hint">（每行一条）</span></label>
          <textarea id="f-tips" rows="3" placeholder="每日限流，需提前预约&#10;穿着庄重…">${escHtml((item?.tips||[]).join('\n'))}</textarea>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label>交通</label>
            <textarea id="f-transport" rows="2" placeholder="机场→景区路线">${escHtml(item?.transport||'')}</textarea>
          </div>
          <div class="form-group">
            <label>住宿推荐</label>
            <textarea id="f-accommodation" rows="2" placeholder="推荐酒店/民宿">${escHtml(item?.accommodation||'')}</textarea>
          </div>
        </div>
        <div class="form-group">
          <label>图集 URL <span class="field-hint">（每行一个）</span></label>
          <textarea id="f-gallery" rows="3" placeholder="https://…">${escHtml((item?.gallery||[]).join('\n'))}</textarea>
        </div>
      </div>`;
  }

  else if (type === 'restaurant') {
    root.innerHTML = `
      <div class="form-section">
        <div class="section-title">🍜 餐厅详情</div>
        <div class="form-row-2">
          <div class="form-group">
            <label>评分（0-5）</label>
            <input id="f-rating" type="number" step="0.1" min="0" max="5" placeholder="4.5" value="${item?.rating??''}">
          </div>
          <div class="form-group">
            <label>营业时间</label>
            <input id="f-hours" placeholder="10:00–21:00" value="${escHtml(item?.hours||'')}">
          </div>
        </div>
        <div class="form-group">
          <label>详细介绍</label>
          <textarea id="f-full-desc" rows="3" placeholder="餐厅介绍…">${escHtml(item?.fullDesc||'')}</textarea>
        </div>
        <div class="form-group">
          <label>图集 URL <span class="field-hint">（每行一个）</span></label>
          <textarea id="f-gallery" rows="2" placeholder="https://…">${escHtml((item?.gallery||[]).join('\n'))}</textarea>
        </div>
      </div>`;
  }

  else if (type === 'recipe') {
    root.innerHTML = `
      <div class="form-section">
        <div class="section-title">🥗 菜谱详情</div>
        <div class="form-row-3">
          <div class="form-group">
            <label>难度</label>
            <select id="f-difficulty">
              <option${item?.difficulty==='简单'?' selected':''}>简单</option>
              <option${item?.difficulty==='中等'?' selected':''}>中等</option>
              <option${item?.difficulty==='较难'?' selected':''}>较难</option>
            </select>
          </div>
          <div class="form-group">
            <label>时间</label>
            <input id="f-time" placeholder="30分钟" value="${escHtml(item?.time||'')}">
          </div>
          <div class="form-group">
            <label>卡路里</label>
            <input id="f-calories" placeholder="280卡" value="${escHtml(item?.calories||'')}">
          </div>
        </div>
        <div class="form-group">
          <label>食材 <span class="field-hint">（每行一种）</span></label>
          <textarea id="f-ingredients" rows="4" placeholder="豆腐 200g&#10;香菇 4朵…">${escHtml((item?.ingredients||[]).join('\n'))}</textarea>
        </div>
        <div class="form-group">
          <label>做法步骤</label>
          <textarea id="f-full-desc" rows="6" placeholder="1. 豆腐切块…&#10;2. 热锅热油…">${escHtml(item?.fullDesc||'')}</textarea>
        </div>
      </div>`;
  }

  else if (type === 'sutra') {
    const categoryOptions = [
      { value: 'prajna',   label: '般若部' },
      { value: 'pure',     label: '净土部' },
      { value: 'chan',     label: '禅宗' },
      { value: 'mahayana', label: '大乘部' },
      { value: 'vinaya',   label: '律典' },
      { value: 'tantra',   label: '密宗' },
      { value: 'other',    label: '其他' },
    ].map(o => `<option value="${o.value}"${item?.category===o.value?' selected':''}>${o.label}</option>`).join('');

    root.innerHTML = `
      <div class="form-section">
        <div class="section-title">📚 经典详情</div>
        <div class="form-row-2">
          <div class="form-group">
            <label>简称（卡片显示）</label>
            <input id="f-short-title" placeholder="心经" value="${escHtml(item?.shortTitle||'')}">
          </div>
          <div class="form-group">
            <label>译者/作者</label>
            <input id="f-author" placeholder="玄奘法师 译" value="${escHtml(item?.author||'')}">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label>所属部类</label>
            <select id="f-category">${categoryOptions}</select>
          </div>
          <div class="form-group">
            <label>阅读时长</label>
            <input id="f-read-time" placeholder="5分钟" value="${escHtml(item?.readTime||'')}">
          </div>
          <div class="form-group">
            <label>章节数</label>
            <input id="f-chapters" type="number" min="1" placeholder="1" value="${item?.chapters||''}">
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label>评分（0-5）</label>
            <input id="f-rating" type="number" step="0.1" min="0" max="5" placeholder="4.9" value="${item?.rating??''}">
          </div>
          <div class="form-group">
            <label>封面主色（HEX）</label>
            <input id="f-cover-color" type="color" value="${item?.coverColor||'#8b5a2b'}">
          </div>
        </div>
        <div class="form-group">
          <label>正文 Markdown（可留空，用于在线阅读）</label>
          <textarea id="f-content-md" class="code-editor" rows="8" placeholder="## 第一品&#10;&#10;正文内容…">${escHtml(item?.content_md||'')}</textarea>
        </div>
        <div class="form-group">
          <label>外链 URL（点击跳转，可选）</label>
          <input id="f-article-url" placeholder="https://cbeta.org/…" value="${escHtml(item?.article_url||'')}">
        </div>
        <div class="form-group">
          <label>排序权重（越小越靠前）</label>
          <input id="f-sort" type="number" min="0" placeholder="0" value="${item?.sort??0}">
        </div>
      </div>`;
  }

  else if (type === 'article' || type === 'forum') {
    const moduleOptions = ['home','pilgrimage','vegan','library','forum']
      .map(m => `<option value="${m}"${(item?.module_key===m||(!item&&type==='forum'&&m==='forum'))?' selected':''}>${m}</option>`)
      .join('');
    root.innerHTML = `
      <div class="form-section">
        <div class="section-title">📖 文章详情</div>
        <div class="form-row-2">
          <div class="form-group">
            <label>所属板块</label>
            <select id="f-module">${moduleOptions}</select>
          </div>
          <div class="form-group">
            <label>Slug（URL标识）</label>
            <input id="f-slug" placeholder="auto-from-title" value="${escHtml(item?.slug||item?._id||'')}">
          </div>
        </div>
        <div class="form-group">
          <label>外链 URL（点击跳转，可选）</label>
          <input id="f-article-url" placeholder="https://…" value="${escHtml(item?.article_url||'')}">
        </div>
        <div class="form-group">
          <label>正文 Markdown</label>
          <textarea id="f-content-md" class="code-editor" rows="10" placeholder="# 标题&#10;&#10;正文内容…">${escHtml(item?.content_md||'')}</textarea>
        </div>
        <div class="form-group">
          <label>排序权重（越小越靠前）</label>
          <input id="f-sort" type="number" min="0" placeholder="0" value="${item?.sort_order??0}">
        </div>
      </div>`;
  }

  // 实时预览监听
  root.querySelectorAll('input,textarea').forEach(el => el.addEventListener('input', updatePreview));
}

/* ═══════════════════════════════════════════════
   标签输入
   ═══════════════════════════════════════════════ */
function renderTagChips() {
  const chips = $('tag-chips');
  chips.innerHTML = state.tags.map(tag => `
    <span class="tag-chip">
      ${escHtml(tag)}
      <button class="tag-chip-remove" data-tag="${escHtml(tag)}">×</button>
    </span>`).join('');
  chips.querySelectorAll('.tag-chip-remove').forEach(btn => {
    btn.onclick = () => {
      state.tags = state.tags.filter(t => t !== btn.dataset.tag);
      renderTagChips();
      updatePreview();
    };
  });
}

function addTag(val) {
  const tag = val.trim().replace(/,+$/, '');
  if (tag && !state.tags.includes(tag)) {
    state.tags.push(tag);
    renderTagChips();
    updatePreview();
  }
}

/* ═══════════════════════════════════════════════
   实时预览更新
   ═══════════════════════════════════════════════ */
function updatePreview() {
  const title = $('f-title')?.value || '标题将显示在这里';
  const desc  = $('f-desc')?.value  || '简介将显示在这里';
  const type  = state.editingType;
  const t     = TYPES[type] || {};

  $('preview-name').textContent     = title || '标题将显示在这里';
  $('preview-desc-text').textContent = desc  || '';
  $('preview-tags-row').innerHTML = [
    `<span class="preview-tag">${t.icon||''} ${t.label||''}</span>`,
    ...state.tags.map(tag => `<span class="preview-tag">${escHtml(tag)}</span>`),
  ].join('');

  // 补充信息（评分、时间等）
  const meta = [];
  const rating = document.getElementById('f-rating')?.value;
  const altitude = document.getElementById('f-altitude')?.value;
  const time   = document.getElementById('f-time')?.value;
  if (rating)   meta.push(`⭐ ${rating}`);
  if (altitude) meta.push(`⛰ ${altitude}`);
  if (time)     meta.push(`⏱ ${time}`);
  $('preview-meta').textContent = meta.join('  ');
}

function updateCoverPreview(url) {
  const img  = $('preview-cover-img');
  const empty = $('preview-cover-empty');
  state.coverUrl = url;
  if (url) {
    img.src = url;
    img.classList.remove('hidden');
    if (empty) empty.style.display = 'none';
    img.onerror = () => {
      img.classList.add('hidden');
      if (empty) empty.style.display = '';
    };
  } else {
    img.classList.add('hidden');
    if (empty) empty.style.display = '';
  }
}

/* ═══════════════════════════════════════════════
   图片上传（拖放 + 点击）
   ═══════════════════════════════════════════════ */
async function uploadFile(file) {
  if (!file?.type.startsWith('image/') && !file?.type.startsWith('video/')) {
    showToast('请上传图片文件', true); return;
  }
  // 显示上传中
  $('upload-overlay').classList.remove('hidden');
  try {
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(String(reader.result));
      reader.onerror = () => rej(new Error('读取失败'));
      reader.readAsDataURL(file);
    });
    const data = await api('/api/admin/media-upload', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHdr() },
      body: JSON.stringify({
        moduleKey:  state.editingType,
        fileName:   file.name,
        mimeType:   file.type || 'image/jpeg',
        base64Data: dataUrl,
      }),
    });
    const url = data.publicUrl;
    updateCoverPreview(url);
    if ($('f-cover-url')) $('f-cover-url').value = url;
    showToast('图片上传成功 ✓');
  } catch (err) {
    showToast(`上传失败：${err.message}`, true);
  } finally {
    $('upload-overlay').classList.add('hidden');
  }
}

/* ═══════════════════════════════════════════════
   保存内容
   ═══════════════════════════════════════════════ */
function collectFormData() {
  const type = state.editingType;
  const t    = TYPES[type];

  const base = {
    name:      $('f-title')?.value.trim() || '',
    shortDesc: $('f-desc')?.value.trim()  || '',
    cover:     state.coverUrl,
    tags:      [...state.tags],
    visible:   true,
  };

  if (!base.name) { showToast('标题不能为空', true); return null; }

  if (type === 'site') {
    return {
      ...base,
      region:        $('f-region')?.value.trim()  || '',
      altitude:      $('f-altitude')?.value.trim() || '',
      season:        $('f-season')?.value.trim()   || '',
      rating:        parseFloat($('f-rating')?.value) || null,
      fullDesc:      $('f-full-desc')?.value.trim()   || '',
      tips:          ($('f-tips')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
      transport:     $('f-transport')?.value.trim()   || '',
      accommodation: $('f-accommodation')?.value.trim() || '',
      gallery:       ($('f-gallery')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
      coords: {
        x: Number($('f-coord-x')?.value || 0),
        y: Number($('f-coord-y')?.value || 0),
      },
    };
  }

  if (type === 'restaurant') {
    return {
      ...base,
      region:   $('f-region')?.value.trim()    || '',
      rating:   parseFloat($('f-rating')?.value) || null,
      hours:    $('f-hours')?.value.trim()      || '',
      fullDesc: $('f-full-desc')?.value.trim()  || '',
      gallery:  ($('f-gallery')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
      coords: {
        x: Number($('f-coord-x')?.value || 0),
        y: Number($('f-coord-y')?.value || 0),
      },
    };
  }

  if (type === 'recipe') {
    return {
      ...base,
      difficulty:  $('f-difficulty')?.value || '简单',
      time:        $('f-time')?.value.trim()  || '',
      calories:    $('f-calories')?.value.trim() || '',
      ingredients: ($('f-ingredients')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
      fullDesc:    $('f-full-desc')?.value.trim() || '',
    };
  }

  if (type === 'sutra') {
    const catVal = $('f-category')?.value || 'prajna';
    const catLabels = { prajna:'般若部', pure:'净土部', chan:'禅宗', mahayana:'大乘部', vinaya:'律典', tantra:'密宗', other:'其他' };
    return {
      ...base,
      shortTitle:  $('f-short-title')?.value.trim() || base.name,
      author:      $('f-author')?.value.trim()       || '',
      category:    catVal,
      label:       catLabels[catVal] || '其他',
      readTime:    $('f-read-time')?.value.trim()    || '',
      chapters:    parseInt($('f-chapters')?.value)  || 1,
      rating:      parseFloat($('f-rating')?.value)  || null,
      coverColor:  $('f-cover-color')?.value         || '#8b5a2b',
      desc:        base.shortDesc,
      content_md:  $('f-content-md')?.value.trim()   || '',
      article_url: $('f-article-url')?.value.trim()  || '',
      sort:        parseInt($('f-sort')?.value)       || 0,
    };
  }

  if (type === 'article' || type === 'forum') {
    const titleVal = $('f-title')?.value.trim() || '';
    const slugVal  = $('f-slug')?.value.trim()
      || titleVal.toLowerCase().replace(/\s+/g,'-').replace(/[^\w一-龥-]/g,'').slice(0,60)
      || `post-${Date.now()}`;
    return {
      _isArticle:  true,
      module_key:  $('f-module')?.value || (type==='forum'?'forum':'library'),
      slug:        slugVal,
      title:       titleVal,
      summary:     $('f-desc')?.value.trim()        || '',
      cover_url:   state.coverUrl,
      article_url: $('f-article-url')?.value.trim() || '',
      content_md:  $('f-content-md')?.value.trim()  || '',
      sort_order:  Number($('f-sort')?.value || 0),
      tags:        [...state.tags],
    };
  }

  return base;
}

async function saveContent(publish = false) {
  const formData = collectFormData();
  if (!formData) return;

  const type = state.editingType;
  const t    = TYPES[type];
  const btn  = publish ? $('publish-btn') : $('draft-btn');
  setLoading(btn, true);

  try {
    if (formData._isArticle) {
      await api('/api/admin/articles', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body:    JSON.stringify(formData),
      });
      if (publish) {
        await api('/api/admin/publish', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({ moduleKey: formData.module_key, notes: '后台发布' }),
        });
      }
    } else {
      await ensurePayloadLoaded(t.module);
      let arr = getPayloadArray(type);
      const existIdx = state.editingId
        ? arr.findIndex(s => String(s.id||s.name||'') === String(state.editingId))
        : -1;

      if (existIdx >= 0) {
        formData.id   = arr[existIdx].id || state.editingId;
        formData.sort = arr[existIdx].sort ?? existIdx;
        arr[existIdx] = formData;
      } else {
        formData.id   = Date.now().toString(36);
        formData.sort = arr.length;
        arr.push(formData);
      }
      setPayloadArray(type, arr);

      if (publish) {
        await saveAndPublishModule(t.module);
      } else {
        // 仅保存草稿
        const payload = state.payloads[t.module] || {};
        await api('/api/admin/content', {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({ moduleKey: t.module, blockKey: 'module_root', payload }),
        });
      }
    }

    await loadAllContent();
    switchView('hub');
    showToast(publish ? '🚀 已发布上线！' : '草稿已保存');
  } catch (err) {
    showToast(`保存失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
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
    const x = Math.round(((e.clientX - rect.left) / rect.width)  * MAP_W);
    const y = Math.round(((e.clientY - rect.top)  / rect.height) * MAP_H);
    const cx = Math.max(0, Math.min(MAP_W, x));
    const cy = Math.max(0, Math.min(MAP_H, y));
    $('f-coord-x').value = cx;
    $('f-coord-y').value = cy;
    setCoordDot(cx, cy);
  });
  ['f-coord-x','f-coord-y'].forEach(id => {
    $(id)?.addEventListener('input', () => {
      const x = Number($('f-coord-x').value || 0);
      const y = Number($('f-coord-y').value || 0);
      setCoordDot(x, y);
    });
  });
}

function setCoordDot(x, y) {
  const dot = $('coord-dot');
  if (!dot) return;
  dot.style.left    = `${(x / MAP_W) * 100}%`;
  dot.style.top     = `${(y / MAP_H) * 100}%`;
  dot.classList.remove('hidden');
}

function renderRefDots(type, currentId) {
  const container = $('coord-ref-dots');
  if (!container) return;
  container.innerHTML = getPayloadArray(type)
    .filter(s => String(s.id||s.name||'') !== String(currentId||''))
    .filter(s => s.coords?.x != null && s.coords?.y != null)
    .map(s => {
      const l = (s.coords.x / MAP_W) * 100;
      const t = (s.coords.y / MAP_H) * 100;
      return `<div class="coord-ref-dot" data-name="${escHtml(s.name||'')}" style="left:${l}%;top:${t}%"></div>`;
    }).join('');
}

/* ═══════════════════════════════════════════════
   用户管理
   ═══════════════════════════════════════════════ */
function renderUsers() {
  const keyword = state.userSearch.trim().toLowerCase();
  const root    = $('user-list');
  const list    = state.users.filter(u =>
    !keyword ||
    (u.email||'').toLowerCase().includes(keyword) ||
    (u.display_name||'').toLowerCase().includes(keyword)
  );
  if (!list.length) { root.innerHTML = '<div class="user-empty">暂无用户</div>'; return; }
  root.innerHTML = list.map(u => `
    <div class="user-row" data-id="${u.id}">
      <div class="user-row-avatar">${(u.display_name||u.email||'U')[0].toUpperCase()}</div>
      <div class="user-row-info">
        <div class="user-row-name">${escHtml(u.display_name||'（未设置）')}</div>
        <div class="user-row-email">${escHtml(u.email||u.id)}</div>
      </div>
      <div class="user-row-badges">
        <span class="badge badge-${u.role}">${u.role}</span>
        <span class="badge badge-${u.status}">${u.status}</span>
      </div>
    </div>`).join('');
  root.querySelectorAll('.user-row').forEach(row => {
    row.onclick = () => openUserModal(row.dataset.id);
  });
}

function openUserModal(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;
  state.editingUserId = id;
  $('u-email').value  = u.email        || '';
  $('u-name').value   = u.display_name || '';
  $('u-role').value   = u.role         || 'viewer';
  $('u-status').value = u.status       || 'active';
  openModal('user-modal');
}

async function saveUser() {
  const btn = $('u-save-btn');
  setLoading(btn, true);
  try {
    await api('/api/admin/users', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHdr() },
      body: JSON.stringify({
        id:           state.editingUserId,
        display_name: $('u-name').value.trim(),
        role:         $('u-role').value,
        status:       $('u-status').value,
      }),
    });
    closeModal('user-modal');
    await loadAllContent();
    showToast('用户已更新 ✓');
  } catch (err) {
    showToast(`失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════════
   事件绑定
   ═══════════════════════════════════════════════ */
function bindEvents() {
  // 登录
  $('login-btn').onclick          = login;
  $('settings-btn-login').onclick = openSettings;
  $('password').onkeydown         = e => { if (e.key === 'Enter') login(); };

  // 导航
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.view === 'publisher') openPublisher(null, state.editingType || 'site');
      else switchView(btn.dataset.view);
    };
  });

  // 侧栏：设置 & 退出
  $('logout-btn').onclick   = logout;
  $('settings-btn').onclick = openSettings;
  $('save-settings-btn').onclick = saveSettings;

  // Hub
  $('hub-new-btn').onclick     = () => openPublisher(null, 'site');
  $('reload-btn').onclick      = loadAllContent;
  $('hub-search').oninput      = e => { state.hubSearch = e.target.value; renderHub(); };
  $('seed-btn').onclick        = seedInitialData;
  $('seed-library-btn').onclick = seedLibraryData;

  // Filter pills
  $('filter-pills').querySelectorAll('.pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('#filter-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      state.hubFilter = p.dataset.type;
      renderHub();
    };
  });

  // Publisher：返回
  $('publisher-back').onclick = () => switchView('hub');

  // Publisher：类型切换
  document.querySelectorAll('.type-pill').forEach(p => {
    p.onclick = () => {
      state.editingType = p.dataset.type;
      state.editingId   = null;   // 切换类型时重置编辑 ID
      setActiveTypePill(p.dataset.type);
      renderPublisherForm(p.dataset.type, null);
    };
  });

  // Publisher：保存 & 发布
  $('draft-btn').onclick   = () => saveContent(false);
  $('publish-btn').onclick = () => saveContent(true);

  // 封面图片上传
  const coverWrap = $('preview-cover-wrap');
  const fileInput = $('cover-file-input');

  coverWrap.onclick = () => fileInput.click();
  fileInput.onchange = e => { const f = e.target.files?.[0]; if (f) uploadFile(f); };

  coverWrap.addEventListener('dragover',  e => { e.preventDefault(); coverWrap.style.opacity = '.7'; });
  coverWrap.addEventListener('dragleave', ()  => { coverWrap.style.opacity = ''; });
  coverWrap.addEventListener('drop', e => {
    e.preventDefault(); coverWrap.style.opacity = '';
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  });

  // 封面 URL 直接应用
  $('cover-url-apply').onclick = () => {
    const url = $('f-cover-url').value.trim();
    updateCoverPreview(url);
  };
  $('f-cover-url').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); updateCoverPreview($('f-cover-url').value.trim()); } };

  // 实时预览监听（公共字段）
  ['f-title','f-desc'].forEach(id => $(id)?.addEventListener('input', updatePreview));

  // 标签输入
  $('tag-input').onkeydown = e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag($('tag-input').value);
      $('tag-input').value = '';
    }
  };
  $('tag-input-wrap').onclick = () => $('tag-input').focus();

  // 坐标选取
  initCoordPicker();

  // 全局粘贴图片
  document.addEventListener('paste', e => {
    if (state.currentView !== 'publisher') return;
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) uploadFile(f);
      }
    }
  });

  // Ctrl+S 快捷保存
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (state.currentView === 'publisher') saveContent(false);
    }
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });

  // Modal 遮罩关闭
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.onclick = e => { if (e.target === overlay) overlay.classList.add('hidden'); };
  });

  // 用户搜索
  $('user-search').oninput = e => { state.userSearch = e.target.value; renderUsers(); };
  $('u-save-btn').onclick  = saveUser;
}

/* ═══════════════════════════════════════════════
   导入初始数据（一键迁移硬编码内容）
   ═══════════════════════════════════════════════ */
async function seedInitialData() {
  const role = state.profile?.role;
  if (role !== 'owner') {
    showToast('只有 owner 角色可以执行数据导入', true);
    return;
  }

  const ok = await confirmDialog(
    '将把前端现有的 8 个朝圣地点、12 家素食餐厅、4 个菜谱、8 条论坛帖子、8 部佛经导入数据库。\n\n如后台已有朝圣数据，此操作将被拒绝（防止重复导入）。确认继续？',
    '📥 导入初始数据',
    '确认导入'
  );
  if (!ok) return;

  const btn = $('seed-btn');
  setLoading(btn, true);
  try {
    const data = await api('/api/admin/seed', {
      method: 'POST',
      headers: { ...authHdr(), 'Content-Type': 'application/json' },
    });
    showToast(data.message || '导入成功！');
    // 刷新内容列表
    await loadAllContent();
  } catch (err) {
    if (err.message?.includes('已存在')) {
      showToast('后台已有数据，无需重复导入', true);
    } else {
      showToast(`导入失败：${err.message}`, true);
    }
  } finally {
    setLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════════
   单独导入书库
   ═══════════════════════════════════════════════ */
async function seedLibraryData() {
  const role = state.profile?.role;
  if (role !== 'owner') { showToast('只有 owner 角色可以执行数据导入', true); return; }

  const ok = await confirmDialog(
    '将导入 8 部初始佛经（心经、金刚经、阿弥陀经等）到书库。\n\n此操作会覆盖现有书库数据，确认继续？',
    '📚 导入书库数据',
    '确认导入'
  );
  if (!ok) return;

  const btn = $('seed-library-btn');
  setLoading(btn, true);
  try {
    const data = await api('/api/admin/seed', {
      method: 'POST',
      headers: { ...authHdr(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryOnly: true }),
    });
    showToast(data.message || '书库导入成功！');
    await loadAllContent();
  } catch (err) {
    showToast(`导入失败：${err.message}`, true);
  } finally {
    setLoading(btn, false);
  }
}

/* ═══════════════════════════════════════════════
   启动
   ═══════════════════════════════════════════════ */
async function boot() {
  bindEvents();

  if (state.token) {
    try {
      await refreshProfile();
      showApp();
      switchView('hub');
      await loadAllContent();
    } catch {
      state.token = '';
      localStorage.removeItem('modao-admin-token');
      $('login-screen').classList.remove('hidden');
    }
  } else {
    $('login-screen').classList.remove('hidden');
  }
}

boot();
