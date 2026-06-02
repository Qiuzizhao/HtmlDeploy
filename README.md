# HtmlDeploy 极简静态网页部署平台

## 1. 项目介绍
HtmlDeploy 是一个极简的静态 HTML 页面部署平台。
主要功能：
- 用户可以填写网页名字、作者署名，选择班级，并上传单个 `.html` 文件（或直接粘贴 HTML 代码）。
- 平台将其保存，并在首页生成对应的项目卡片。
- 访客可通过班级密码或全局密码解锁查看项目列表，点击卡片直接在内嵌的 iframe 中大屏预览网页。
- 提供极简后台管理界面（`/admin.html`），需使用管理员密码（默认：`qqqyyy`）登录。后台支持管理班级、全局密码，以及管理和删除用户上传的项目。

## 2. 项目代码结构
本项目采用最基础的技术栈（Node.js + Express + 原生 HTML/JS/CSS），没有使用 React/Vue 等前端框架，也没有连接关系型数据库，非常轻量。

- **`server.js`**：项目启动入口，负责初始化目录结构并启动 Express 服务器。
- **`src/app.js`**：后端核心逻辑，包含所有 Express 路由。实现了文件上传（Multer）、项目 CRUD、密码校验逻辑（Cookie/Token）、以及本地 JSON 数据读写。
- **`public/`**：前端静态资源目录。
  - `index.html`：前台首页页面（纯前端实现），包含上传弹窗、密码解锁、项目卡片展示和预览等。
  - `admin.html`：后台管理页面。
- **`data/`**：数据存储目录（使用 JSON 文件充当轻量数据库）。
  - `sites.json`：保存所有上传项目的元数据（ID、标题、班级、时间等）。
  - `classes.json`：保存班级信息和班级解锁密码。
  - `settings.json`：保存全局设置（如全站访问密码）。
- **`storage/sites/`**：实际 HTML 文件的存储位置。每个项目保存在 `storage/sites/{id}/index.html`。
- **`test/`**：Node.js 原生测试用例（`app.test.js`），覆盖了主要的前后端交互逻辑。
- **`docs/`**：项目原始架构和设计文档。
- **各类部署脚本 (`*.exp`, `*.sh`)**：辅助将项目自动化发布到远程服务器的脚本。

## 3. 部署方式

### 3.1 本地开发与运行
1. 安装依赖：
   ```bash
   npm install
   ```
2. 启动服务：
   ```bash
   npm start
   ```
   服务默认运行在 `http://localhost:3000`。上传的数据和文件会直接存放在项目根目录下的 `data/` 和 `storage/` 文件夹中。

### 3.2 自建服务器部署 (Linux + PM2 + Nginx)
项目中包含了自动化部署到远程主机的脚本。
核心脚本：**`remote_deploy_domain.sh`**。
部署流程（针对 Ubuntu 等 Linux 环境）：
1. 将代码拉取到远程服务器（可使用项目里的 `run_deploy.exp` 等 expect 脚本自动同步代码）。
2. 在服务器上运行 `./remote_deploy_domain.sh`。该脚本会自动：
   - 使用 PM2 启动或重启 `server.js`，分配在 `3005` 端口。
   - 自动生成 Nginx 反向代理配置（代理至本机 3005 端口）。
   - 重启 Nginx 使配置生效。

