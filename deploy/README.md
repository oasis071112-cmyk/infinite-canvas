# 阿里云单机部署准备

当前 Compose 只把网页容器绑定到服务器本机 `127.0.0.1:3000`，Node API 仅暴露在 Compose 内网。公网流量应先进入宿主机 Nginx，再通过 HTTPS 转发到该端口。

## 首次准备

1. 安装 Docker、Docker Compose、Nginx 和 Certbot，并为 2GB 内存服务器配置 2GB swap。
2. 复制 `.env.example` 为 `.env`，填写正式域名和一次性生成的 32 字节主密钥。主密钥必须与数据库一起备份，丢失后已有 API Key 无法解密。
3. 执行 `mkdir -p data && sudo chown -R 1000:1000 data && chmod 700 data`，让以 UID 1000 运行的 API 容器可以创建 SQLite、WAL 和备份文件。
4. 将 `deploy/nginx-site.conf.example` 复制到宿主机 Nginx 站点目录，替换域名和证书路径。
5. 使用 `docker compose up -d --build` 启动，检查 `https://你的域名/api/health` 返回 `{"ok":true}`。

Compose 已将 API 与 Web 容器日志限制为每份 10MB、保留 3 份；宿主机 Nginx 访问日志仍需使用系统 `logrotate` 管理。

## 数据边界

- `data/ionailabs-canvas.sqlite` 只保存匿名会话、加密渠道、模型和调用摘要。
- 图片、音频、画布和完整生成记录仍在各浏览器 IndexedDB，不进入服务器数据目录。
- 中转站响应和网页静态资源从 ECS 发往浏览器时仍会产生公网出站流量。

## 备份与恢复

- 执行 `docker compose exec api npm run backup` 创建 SQLite 在线备份，默认只保留最近 7 份。
- 备份位于 `data/backups/`；应再复制到服务器之外，并同时保存 `.env` 中的 `API_KEY_MASTER_KEY`。
- 恢复前先执行 `docker compose stop api`，移走现有的 `data/ionailabs-canvas.sqlite`、`-wal` 和 `-shm` 文件，再将选定备份复制为 `data/ionailabs-canvas.sqlite`；确认文件所有者可由容器读取后执行 `docker compose start api`。

本文档仅提供部署文件和步骤，不代表本次已连接或修改阿里云服务器。
