# 云端部署

现有服务器如需“合并 main 后自动上线”，见 [GitHub Actions 配置步骤](AUTOMATIC-DEPLOYMENT.md)。首次需要安装服务器部署助手并配置 GitHub 的 production 环境变量与 Secrets；保存工作流本身不表示自动部署已经可用。

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

## 反馈、管理员与已有网站升级

注册用户默认都是普通用户，不能通过注册参数或网页自行成为管理员。新安装导入 `server/schema.sql` 时会包含所有新表；已有网站按下面方式添加表，不会删除或改写已有账户与计划：

```sh
cd /opt/penguin-planner
git pull --ff-only
cd server
npm ci --omit=dev
node manage.js migrate
# 将下面的示例替换为你已经注册的精确用户名；不要填写密码。
node manage.js grant-admin '你的现有用户名'
sudo systemctl restart penguin-planner
```

命令在服务器上运行并读取 `server/.env`，因此无需把数据库密码复制到命令或聊天里。迁移和授权可以重复执行；用户名不存在时授权失败，不会创建新账号。部署必须先完成迁移再重启新版本。授权后刷新网页即可看到「账户」下方的「管理中心」。代码更新不会自动部署，除非另外配置了部署流水线。

还应将新版 Nginx 示例中的 `/server`、`/deploy` 和隐藏文件拒绝访问规则加入现有站点配置（保留已有域名、端口与证书配置），然后执行 `sudo nginx -t && sudo systemctl reload nginx`。这些路径不是公开网页资源。Express 后端同样阻止访问服务器源码目录。

普通用户可提交文字或最多三张 PNG/JPEG/WebP 图片，手机照片会在浏览器中压缩；每张上传图片最多 1 MB、合计最多 2 MB，文字最多 5000 字，每个账号滚动 24 小时最多 20 条。本人只能查看自己的反馈和图片；管理员可查看全部反馈并标为待查看、已查看或已处理。反馈图片单独存储，不与私人计划附件混用。

管理中心只查询用户名、角色、注册时间、最近使用时间及近 30 天活跃天数，不查询用户的计划、主线、计时或私人附件。汇总展示总注册人数、近 24 小时/7 天/30 天活跃人数、反馈总数及待查看数。活跃从功能启用后记录，UTC 自然日内有登录后的接口访问或前台交互即计为活跃；最近使用时间按分钟更新，不等于精确在线时长，管理员自己也计入统计。未登录离线使用无法计入。

原密码和密码哈希均不向管理页面提供。管理员只能重置普通用户的密码：生成随机临时密码，仅在此次响应中显示，并立即撤销该用户全部登录。请安全转交本人，让用户在账户里的「修改密码」设置新密码。管理员通过账户页面修改自己的密码；修改密码也会撤销所有设备的登录。备份应继续包含整个数据库（新增角色、活动和反馈表），不能只备份计划表。

### 本地验证管理功能

测试必须使用单独的、名称以 `_test` 结尾的可丢弃数据库，不能使用线上数据库。先由本地数据库管理员创建测试库并为本地测试用户授权，再从 `server/` 执行：

```sh
MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=planner_management_test MYSQL_USER=你的本地测试数据库用户 node --test test/management.test.js
```

如数据库需要密码，通过测试环境的 `MYSQL_PASSWORD` 安全提供。测试创建并清理临时账号，验证匿名/普通用户权限、授权命令、反馈图片隔离、反馈处理、活跃统计、密码重置和登录失效；测试中的管理员与线上账号无关。
