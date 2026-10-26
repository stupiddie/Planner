# 云端部署

本项目按 Ubuntu 22.04/24.04、Node.js 20、MySQL 8、Nginx 和 systemd 部署。网页和 `/api` 使用同一个主机名，登录 Cookie 才能正常工作。

## 安装依赖

```sh
apt update
apt install -y curl git nginx mysql-server ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 上传代码和初始化数据库

建议将仓库放在 `/opt/penguin-planner`，然后创建独立数据库用户：

```sql
CREATE DATABASE penguin_planner CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'penguin'@'localhost' IDENTIFIED BY '替换为强密码';
GRANT ALL PRIVILEGES ON penguin_planner.* TO 'penguin'@'localhost';
FLUSH PRIVILEGES;
```

```sh
cd /opt/penguin-planner
mysql -u root -p < server/schema.sql
cd server
npm install --omit=dev
cp .env.example .env
chmod 600 .env
```

`.env` 的生产配置：

```env
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=penguin_planner
MYSQL_USER=penguin
MYSQL_PASSWORD=数据库用户密码
SESSION_DAYS=30
COOKIE_SECURE=true
```

## systemd 常驻服务

```sh
useradd --system --home /opt/penguin-planner --shell /usr/sbin/nologin planner
chown -R planner:planner /opt/penguin-planner
install -m 644 deploy/penguin-planner.service /etc/systemd/system/penguin-planner.service
systemctl daemon-reload
systemctl enable --now penguin-planner
systemctl status penguin-planner
```

查看日志：`journalctl -u penguin-planner -f`。服务异常退出或服务器重启后，systemd 会自动恢复服务。

## Nginx 和 HTTPS

将域名 A 记录指向服务器公网 IP，把 `deploy/nginx-penguin-planner.conf` 中的 `planner.example.com` 替换为实际域名，然后：

```sh
cp deploy/nginx-penguin-planner.conf /etc/nginx/sites-available/penguin-planner
ln -s /etc/nginx/sites-available/penguin-planner /etc/nginx/sites-enabled/penguin-planner
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d planner.example.com
certbot renew --dry-run
```

Certbot 会将 HTTP 重定向到 HTTPS。证书生效后确认 `.env` 中 `COOKIE_SECURE=true`，再执行 `systemctl restart penguin-planner`。只有 IP 地址时不能申请 Let's Encrypt 证书，可先使用 HTTP 验证部署。

## 验收和备份

```sh
systemctl is-enabled penguin-planner
systemctl is-active penguin-planner
curl -I https://planner.example.com
mkdir -p /var/backups/penguin-planner
mysqldump -u root -p penguin_planner | gzip > /var/backups/penguin-planner/$(date +%F).sql.gz
```

验收注册、登录、刷新保持登录、计划同步、附件上传下载、账户隔离，以及重启服务和服务器后自动恢复。
