# HtmlDeploy 极简静态网页部署平台

## 1. 项目介绍

HtmlDeploy 是一个轻量的静态 HTML 页面部署平台，适合课堂展示、学生作品提交和本地/服务器快速发布。

主要功能：

- 前台按班级展示项目，访客需要输入班级密码或全部密码后才能查看项目列表。
- 用户可以填写网页名字、作者署名，选择当前班级，并上传单个 `.html` 文件，或直接粘贴 HTML 代码。
- 后台可以为每个班级单独启用或禁用“上传网页”功能。禁用后，前台选中该班级时“上传网页”按钮会变灰且无法点击，后端接口也会拒绝绕过按钮的上传请求。
- 平台可以自动打开项目并截取封面图，前台项目卡片会优先显示对应封面。后台支持单个刷新封面和批量刷新全部封面。
- 项目卡片支持预览。默认优先用独立预览窗口打开项目，避免小窗口 iframe 预览对游戏或 Canvas 项目的性能造成明显影响。
- 后台管理界面位于 `/admin.html`，默认管理员密码为 `qqqyyy`。后台支持项目管理、代码编辑、AI 代码优化、班级管理、班级密码、全部密码、班级排序、项目下载和删除。
- 已上传的 HTML 项目保存在本地 `storage/sites/`，封面保存在 `storage/thumbnails/`，运行元数据写入 `data/app.db` SQLite 数据库。
- 运行数据不再提交 Git。Git 只负责代码、脚本和文档，业务数据通过 SQLite 备份和 `storage/` 归档保护。

## 2. 技术栈

本项目使用最基础的技术栈：

- Node.js
- Express
- Multer
- SQLite / better-sqlite3
- 原生 HTML / CSS / JavaScript

项目没有使用 React、Vue 等前端框架，部署和维护成本较低。

## 3. 项目结构

- `server.js`：项目启动入口，负责初始化目录结构并启动 Express 服务。
- `src/app.js`：后端核心逻辑，包含 Express 路由、文件上传、项目 CRUD、班级权限、Cookie 校验和上传开关校验。
- `src/db/`：SQLite schema、连接、JSON 迁移兼容层和 repository 模块。
- `public/`：前端静态资源目录。
  - `index.html`：前台首页，包含班级筛选、密码解锁、上传弹窗、项目卡片和项目预览逻辑。
  - `admin.html`：后台管理页面，包含项目管理、代码编辑、违禁词、班级管理、全部密码管理和班级上传开关。
- `data/`：运行数据库目录。
  - `app.db`：SQLite 主数据库，保存项目、班级、设置、违禁词、使用频次、审计日志和 AI 日志等元数据。
  - `*.json`：历史兼容数据文件，仅用于首次迁移或迁移桥接，不作为新的生产写入目标。
- `storage/sites/`：上传 HTML 文件的实际存储目录。每个项目保存在 `storage/sites/{id}/index.html`。
- `storage/thumbnails/`：项目封面图存储目录。封面图由服务器使用 Playwright/Chromium 自动截图生成。
- `test/`：Node.js 原生测试用例。
- `docs/`：项目架构和设计文档。
- `remote_deploy_domain.sh`：远程服务器部署辅助脚本。

## 4. 数据说明

### SQLite 数据库

生产运行数据保存在 `data/app.db`。核心表包括：

- `sites`：项目元数据，例如 ID、编号、标题、作者、班级、启用状态、星标、审查结果等。
- `classes`：班级名称、班级密码、上传开关和密码开关。
- `settings`：全部密码、最后使用项目编号等全局设置。
- `forbidden_words`：违禁词列表。
- `site_usage`：预览和查看代码次数。
- `ai_settings`：后台配置的 AI 参数。
- `audit_logs` / `job_logs`：审计记录和后台任务日志。

历史 JSON 数据仍可导入 SQLite：

```bash
npm run migrate:sqlite -- --data-dir data --db-file data/app.db
```

迁移后可运行一致性校验：

```bash
npm run verify:sqlite -- --data-dir data --storage-dir storage/sites --db-file data/app.db
```

校验会检查 SQLite 记录数、违禁词数量、项目文件是否缺失、使用频次孤儿记录以及项目编号计数是否倒退。

## 5. 本地开发与运行

1. 安装依赖：

   ```bash
   npm install
   ```

2. 启动服务：

   ```bash
   npm start
   ```

   默认端口为 `3000`。也可以通过环境变量指定端口：

   ```bash
   PORT=3100 node server.js
   ```

3. 打开页面：

   - 前台：`http://localhost:3000/`
   - 后台：`http://localhost:3000/admin.html`

## 6. 后台管理

后台默认密码为 `qqqyyy`。

后台支持：

- 新增、编辑、删除项目。
- 在代码窗口中查看、编辑或替换项目 HTML 代码。
- 在代码窗口中调用 LLM API 辅助优化 HTML 代码。
- 下载项目 HTML 文件。
- 新增、编辑、删除班级。
- 调整班级显示顺序。
- 设置班级密码。
- 设置全部密码。
- 单独启用或禁用每个班级的“上传网页”功能。

当某个班级的上传功能被禁用时：

- 后台班级行会显示“上传已禁用”。
- 前台选中该班级时，“上传网页”按钮会禁用。
- 直接调用上传接口 `/api/sites` 也会返回禁止上传的错误。

## 7. 预览与性能说明

前台项目预览优先使用独立窗口打开，而不是把项目长期放在首页的小窗口 iframe 中运行。这样可以减少首页容器样式、遮罩、圆角、阴影和 iframe 合成层对游戏、Canvas、WebGL 项目的影响。

如果浏览器阻止弹窗，页面会回退到内嵌预览弹窗。

`storage/sites/2dac8aab/index.html` 中的“霓虹星跃”小游戏已做过本体优化：

- 游戏物理使用固定 `60Hz` 步进，避免 144Hz 屏幕上速度异常加快。
- 粒子、实体清理和 HUD 更新做了轻量化处理。
- 修复触摸重复触发、磁吸 `NaN`、死亡后继续结算等问题。

## 8. 项目封面图

项目封面图由后端使用 Playwright 打开项目页面并截取 `1024x576` 的 PNG 图片，生成后保存到 `storage/thumbnails/{id}.png`。

触发方式：

- 上传新项目后，后端会异步生成封面。
- 后台项目管理中可以点击单个项目的“生成封面/刷新封面”。
- 后台项目管理中可以点击“刷新全部封面”批量处理已有项目。

封面图属于运行时数据，不提交到 Git 仓库。部署或迁移服务器时，应将 `data/app.db`、`storage/sites/` 和 `storage/thumbnails/` 一起作为业务数据备份。

服务器如果需要自行生成封面，需要安装 Playwright Chromium：

```bash
npx playwright install --with-deps chromium
```

## 9. AI 代码优化

后台项目管理中点击“代码”可打开代码窗口。点击代码窗口中的“AI优化”后，后端会把当前编辑框中的 HTML 发给服务器配置的 LLM API，返回优化后的 HTML 并填回编辑框。代码窗口里的 AI 优化不会自动保存，确认无误后需要再点击“保存代码”。

项目管理操作列中的“AI优化”会直接读取项目文件、优化并保存生效；“定向AI优化”会先弹出提示词输入框，把本次要求一并传给 LLM，再直接保存优化结果。

该功能使用 OpenAI-compatible Chat Completions 接口，API Key 只配置在服务器环境变量中，不会暴露给前端：

```bash
export LLM_API_KEY="你的 API Key"
export LLM_MODEL="gpt-4o-mini"
# 可选，默认 https://api.openai.com/v1
export LLM_API_BASE_URL="https://api.openai.com/v1"
```

也支持使用 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL` 作为环境变量名。

如果使用 DeepSeek，可配置为：

```bash
export LLM_API_KEY="你的 DeepSeek API Key"
export LLM_API_BASE_URL="https://api.deepseek.com"
export LLM_MODEL="deepseek-v4-flash"
export LLM_THINKING_TYPE="disabled"
```

## 10. 部署方式

### 自建服务器部署

项目包含远程部署辅助脚本：`remote_deploy_domain.sh`。

典型部署流程：

1. 将代码拉取或同步到服务器。
2. 在服务器上安装 Node.js、PM2、Nginx。
3. 执行：

   ```bash
   ./remote_deploy_domain.sh
   ```

该脚本会：

- 使用 PM2 启动或重启 `server.js`。
- 将服务运行在脚本配置的本地端口。
- 生成 Nginx 反向代理配置。
- 重启 Nginx 让配置生效。

### 运行数据迁移和备份

首次从旧版本升级到 SQLite 时，推荐顺序：

1. 先备份服务器当前目录：

   ```bash
   APP_DIR=/home/ubuntu/HtmlDeploy BACKUP_DIR=/home/ubuntu/backups/htmldeploy ./scripts/backup-runtime-data.sh
   ```

2. 拉取新代码并安装依赖：

   ```bash
   git pull --ff-only origin main
   npm ci
   ```

3. 把历史 JSON 导入 SQLite：

   ```bash
   npm run migrate:sqlite -- --data-dir data --db-file data/app.db
   ```

4. 校验数据库和项目文件：

   ```bash
   npm run verify:sqlite -- --data-dir data --storage-dir storage/sites --db-file data/app.db
   ```

5. 重启服务并做前后台冒烟测试。

日常备份使用：

```bash
APP_DIR=/home/ubuntu/HtmlDeploy BACKUP_DIR=/home/ubuntu/backups/htmldeploy ./scripts/backup-runtime-data.sh
```

该脚本会使用 SQLite `.backup` 生成数据库一致性备份，并把 `storage/` 打包。默认保留 14 天。

## 11. 注意事项

- 项目运行数据写入 `data/app.db` 和 `storage/`，生产环境必须做好定期备份。
- 项目 HTML 文件和封面图不纳入 Git；如果迁移服务器，需要单独备份并恢复 `data/app.db`、`storage/sites/` 和 `storage/thumbnails/`。
- 不要执行 `git add data storage`。本仓库的 Git 范围只包含代码、脚本、文档和占位文件。
- 默认管理员密码建议在正式部署时通过环境变量或代码配置改成更安全的值。
- 上传内容是用户提供的 HTML，建议只在可信课堂或内网环境中使用。
