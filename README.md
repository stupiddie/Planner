# 企鹅每日计划

这是一个支持本机缓存和云端个人账户的每日计划工具。未登录时仍可离线使用；登录后计划、主线、计时和附件会同步到服务器。

- 每日计划、任务分组、完成状态和备注
- 主线目标、问答、成就和每日任务日志
- 时间记录、暂停、继续和长按结束
- 计划附件和头像，保存在浏览器本地存储
- 手机和电脑登录同一账户后可使用同一份数据
- 账户下方的「使用反馈」支持文字与图片，登录后可提交并查看自己的反馈
- 管理员的「管理中心」提供反馈处理、注册用户统计和使用活跃情况，不展示个人计划

## 使用

开发时可以在项目根目录使用静态服务器（请勿在电脑用户主目录启动）：

```sh
python3 -m http.server 8000
```

手机和电脑连接同一个 Wi-Fi 后，访问电脑的 `http://局域网IP:8000/`。

云端部署见 [`deploy/README.md`](deploy/README.md)。服务端位于 `server/`，数据库表定义位于 `server/schema.sql`。
反馈与管理功能需要运行后端并登录账户；纯静态离线模式不提供这些功能。

## 数据位置

- 计划、主线和计时保存在浏览器 `localStorage`
- 照片和附件保存在浏览器 `IndexedDB`
- 登录后会将 JSON 数据保存到 MySQL，附件通过独立文件接口保存到 MySQL `MEDIUMBLOB`
- 本机缓存仍然保留，网络失败时可以继续编辑，恢复网络后自动同步

## 文件说明

- `index.html`：主页面和每日计划逻辑
- `mainline.js` / `mainline-model.js`：主线目标功能及数据逻辑
- `time-tracker.js`：计时功能
- `mainline.css` / `time-tracker.css`：对应页面样式
- `vendor/gsap.min.js`：时间轴卡片动画依赖

账户与反馈管理代码位于 `community.js`、`community.css` 和 `server/management.js`。现有部署可运行 `node server/manage.js migrate` 添加管理功能所需表；管理员必须由服务器操作人员对现有账号执行授权命令，详见部署文档。
