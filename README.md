# 企鹅每日计划

一个本地运行的每日计划工具，前端使用原生 HTML/CSS/JavaScript，后端使用 Node.js、Express 和 MySQL。

## 本地运行

```bash
cd server
npm install
npm start
```

然后打开项目根目录的 `index.html`。macOS 用户也可以双击桌面的 `启动企鹅计划.command`，它会自动启动后端并打开计划软件。

数据库配置示例见 `server/.env.example`，实际配置文件 `server/.env` 不会提交到 Git。

暂时停用的时间轴功能完整代码保存在 `暂存代码/时间轴/`，以后可以从该目录恢复。
