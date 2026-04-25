# Namecheap + Vercel 绑定 `muodao.com` 操作单

## 1. 在 Vercel 添加域名
1. 打开 Vercel 项目 -> `Settings` -> `Domains`
2. 添加：
   - `muodao.com`
   - `www.muodao.com`
3. 保持该页面打开，等待 Vercel 给出 DNS 记录提示

## 2. 在 Namecheap 配置 DNS
进入 Namecheap -> `Domain List` -> `Manage` -> `Advanced DNS`，添加/修改：

- `A` 记录
  - Host: `@`
  - Value: 按 Vercel 提示（通常是 `76.76.21.21`）
  - TTL: `Automatic`

- `CNAME` 记录
  - Host: `www`
  - Value: `cname.vercel-dns.com`
  - TTL: `Automatic`

若已有冲突记录（比如旧的 `@` 或 `www`），请删除旧记录后再保存。

## 3. 回到 Vercel 完成验证
1. 返回 Vercel 域名页，点击 `Refresh`
2. 等待状态从 `Invalid Configuration` 变为 `Valid Configuration`
3. HTTPS 证书会自动签发（通常 1-10 分钟）

## 4. 验证
- 访问 `https://muodao.com`
- 访问 `https://www.muodao.com`
- 确认都能打开同一应用并为安全锁图标

## 5. 常见问题
- DNS 未生效：等待 5-30 分钟后重试
- 仍提示冲突：检查 Namecheap 是否存在重复 `@` / `www` 记录
- 访问旧站：本地清除 DNS 缓存或换网络测试
