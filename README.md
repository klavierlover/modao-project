# 莫道项目

莫道前台应用 + 后台管理（Vercel API + Supabase）一体化工程。

## 目录结构

```text
.
├── index.html                # 前台入口
├── assets/
│   ├── app.js                # 前台逻辑（含发布内容拉取）
│   ├── styles.css
│   ├── images/
│   └── videos/
├── admin/
│   ├── index.html            # 可视化后台
│   ├── admin.js
│   └── styles.css
├── api/                      # Vercel Serverless API
│   ├── content/published.js
│   ├── admin/*.js
│   └── _lib/*.js
├── data/
│   └── supabase-schema.sql   # Supabase 建表 SQL
├── vercel.json
├── .env.example
└── package.json
```

## 本地开发

```bash
npm install
npm run dev
```

访问 [http://localhost:5173](http://localhost:5173)。

## Supabase 初始化

1. 在 Supabase 新建项目。
2. 打开 SQL Editor，执行 `data/supabase-schema.sql`。
3. 在 Storage 创建 bucket：`modao-assets`（或自定义并同步环境变量）。
4. 在 `app_users_profile` 至少插入一个 `owner` 用户（ID 与 Auth 用户一致）。

## 环境变量

根据 `.env.example` 配置：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

## 后台使用

- 后台地址：`/admin`（部署后如 `https://muodao.com/admin`）
- 支持：
  - 模块草稿 JSON 编辑
  - 文章增改
  - 图片上传（写入 Supabase Storage）
  - 用户列表查看
  - 发布按钮（草稿 -> 新发布版本）

## 前台发布内容读取

前台会请求 `/api/content/published`：

- 有发布版本：优先使用发布快照
- 无发布版本或接口失败：回退本地默认内容
- 每 10 秒轻量轮询，检测到新版本后自动刷新当前页面

## AI 对话模型配置（前台）

浏览器控制台执行：

```js
setCompanionModelConfig({
  baseUrl: "https://api.deepseek.com/v1/chat/completions",
  model: "deepseek-chat",
  apiKey: "你的API_KEY"
});
```

## Vercel 部署

1. 将仓库导入 Vercel。
2. 在 Vercel Project Settings -> Environment Variables 填入上述 Supabase 变量。
3. 点击 Deploy。

## Namecheap 绑定 `muodao.com`

在 Namecheap -> Domain -> Advanced DNS：

- `A` 记录：Host `@` -> 值按 Vercel 提示（Root Domain）
- `CNAME` 记录：Host `www` -> `cname.vercel-dns.com`

然后在 Vercel -> Domains 添加：

- `muodao.com`
- `www.muodao.com`

等待 DNS 生效后即可启用 HTTPS（Vercel 自动签发证书）。
