# 配置一次，以后合并 main 自动上线

当前生产目录 `/opt/penguin-planner`、应用用户 `planner`、服务 `penguin-planner`、公网 `http://120.27.146.55/`。保留服务器原有 `.env`、Nginx 设置及 `/etc/cron.d/penguin-planner-backup`。首次配置交给能操作服务器的 OpenCode；GitHub 私钥通过设置页面安全录入，不发送到聊天。

## 1. 服务器准备（OpenCode 执行）

先从本 PR 取到最新代码的临时副本，在该副本根目录执行这些命令。这里只安装部署工具，不会发布应用代码。安装前确认 systemd 的 `User=planner`，`WorkingDirectory=/opt/penguin-planner/server`，应用 Node/npm 位于 `/usr/bin`。

```sh
sudo apt-get update
sudo apt-get install -y rsync python3 util-linux
id planner-deploy >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash planner-deploy
sudo passwd --lock planner-deploy
sudo install -d -m 0750 -o root -g planner-deploy /var/lib/planner-deploy
sudo install -d -m 0700 -o planner-deploy -g planner-deploy /var/lib/planner-deploy/incoming
sudo install -d -m 0755 /usr/local/lib/planner-deploy
sudo install -m 0755 deploy/deploy-release.sh /usr/local/sbin/planner-deploy
sudo install -m 0644 deploy/validate-release.py /usr/local/lib/planner-deploy/validate-release.py
sudo install -d -m 0700 -o planner-deploy -g planner-deploy /home/planner-deploy/.ssh
```

在服务器的安全临时目录生成一对**专用于 GitHub 部署**的 Ed25519 密钥，不复用管理员的 SSH 私钥。将公钥以 `restrict ` 为前缀追加到 `/home/planner-deploy/.ssh/authorized_keys`，保留已有行，文件所有者设为 `planner-deploy:planner-deploy`、权限 `0600`。私钥通过 GitHub Secrets 页面直接录入；确认可用后安全删除临时私钥副本，不加入项目目录或备份包。

示例生成命令（路径由 OpenCode 选用安全临时目录）：

```sh
ssh-keygen -t ed25519 -C github-actions-planner -N '' -f /安全临时目录/planner-actions
```

安装以下 sudoers 规则到 `/etc/sudoers.d/planner-deploy`，root 所有、权限 `0440`，并用 `visudo -cf` 验证；不要授予通用 sudo 权限：

```sudoers
planner-deploy ALL=(root) NOPASSWD: /usr/local/sbin/planner-deploy *
```

部署助手为 root 所有，不从应用版本覆盖自身；它只接受一个 40 位小写提交 SHA，不接受任意路径或命令。依赖安装和数据库迁移使用 `planner` 用户执行。后续修改部署助手时，需要服务器操作人员重新安装并验证它和校验脚本。

临时工作目录必须放在 `/tmp/planner-deploy.XXXXXX`。`/var/lib/planner-deploy` 的权限是 root:planner-deploy 0750，应用用户 planner 无权穿过这个目录；即使内部工作目录设为 0711 也无法读取源码和写入 npm 缓存。不要通过放宽 incoming 或整个 state 目录权限来解决。已安装旧部署助手的服务器需要单独更新助手的临时目录位置；拉取应用代码不会更新 root 所有的助手。保留服务器已确认可用的 Node/npm PATH 设置。

## 2. GitHub 设置（仓库管理员执行）

打开仓库 Settings → Environments → New environment，创建名称为 **production** 的环境。在该环境中填写：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `DEPLOY_HOST` | `120.27.146.55` |
| Variable | `DEPLOY_USER` | `planner-deploy` |
| Variable | `DEPLOY_PORT` | 实际 SSH 端口，通常 `22` |
| Secret | `DEPLOY_SSH_KEY` | 上一步生成的专用私钥完整内容 |
| Secret | `DEPLOY_KNOWN_HOSTS` | 经服务器本机核对的 SSH 主机公钥记录 |

SSH 使用严格主机公钥校验。22 端口时，可以在服务器本机用以下命令生成已确认来源的公开主机记录，复制到 `DEPLOY_KNOWN_HOSTS`：

```sh
sudo awk '{print "120.27.146.55 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

非 22 端口时，记录的主机字段使用 `[120.27.146.55]:实际端口`。不要用关闭校验或未经核对的扫描结果替代。确保 GitHub 运行器能访问服务器 SSH 端口。

建议 production 的 Deployment branches 仅允许 main。若希望每次合并后直接部署，不添加额外的环境人工批准步骤。Secrets 不应写成 Variables，也不要发到聊天或写入仓库。未配置时工作流会明确失败，不连接服务器。

## 3. 合并 PR 并验证首次自动部署

先完成服务器工具和 GitHub 设置，再在本 PR 的 Conversation 页面确认测试通过，点击 **Merge pull request → Confirm merge**。若仍显示草稿，先点击 **Ready for review**。可以选择普通 Merge 或 Squash；流水线始终部署 main 上经过测试的完整提交，不依赖功能分支名称。

合并后进入仓库 **Actions → Test and deploy Planner**，查看最新运行：

- `test`：Node.js 22、MySQL 8、账户/反馈集成测试、部署包校验测试。
- `deploy`：上传同一提交的 Git 源代码包，经严格 SSH 校验调用服务器部署助手。

首次成功后，服务器 `/var/lib/planner-deploy/current-commit` 应与此次 GitHub 运行的提交一致。手机刷新应看到黑白灰管理中心；必要时完全关闭旧页面再打开。若失败，只分享不含密钥、密码或 Cookie 的报错行。不要把整个 GitHub Secrets 或 `.env` 截图发到聊天。

此后正常流程：在聊天提需求 → 修改、测试、提交 PR → 确认合并 main → Actions 自动发布。PR 本身只运行测试，不发布。需要重试时，在 Actions 页面选择 main 点击 **Run workflow**；不要选择功能分支。

## 发布与回退边界

GitHub 和服务器均串行部署，避免同时更新。先校验源码包、安装依赖，再在网站目录之外备份当前代码与依赖；之后短暂停服、rsync、运行可重复迁移、重启并检查数据库健康和首页。`.env` 留在原位置，不进入源码包或代码备份，不重新授予管理员，也不修改 cron 备份。

部署失败且应用已开始替换时，助手恢复旧代码及依赖并尝试启动旧服务，失败状态仍返回给 Actions。新增加的数据库表保留，**不会自动回退数据库**。现有迁移仅添加管理表，可重复执行。以后涉及删除字段、修改已有数据或其他不兼容迁移，必须在对应 PR 中另外安排数据库备份、兼容升级和回退方案；代码回退不能恢复这些数据。

这里只备份应用；现有每天 03:00 的数据库备份保持运行。应用代码备份位于 `/var/backups/penguin-planner/code-时间-提交.tar.gz`，按服务器磁盘容量制定保留策略。上传失败的源码包可能留在 incoming，确认无部署进行后可清理旧包。

如果发布失败发生在新提交替换之后，恢复备份会覆盖已有文件，但新增且未被旧版引用的文件可能保留。不要运行宽泛的 `rsync --delete` 清理网站目录，以免误删本地配置或其他运行文件。
