**简体中文** | [English](README.en.md)

<div align="center">
<img src="icon.svg" width="72" alt="文章分享图标">

# DSH Article Share · 文章分享

**把 Markdown、Word、PDF 整理成知乎文章和 X 内容，配上本地 AI 图片，最后确认发送。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DeepSeek Harness 插件 · 本地文档转换 · 复用 Chrome 登录状态 · 每次选择发布平台
</div>

## 使用流程

```text
导入文档 → 原文 / 渲染预览 → 编辑平台内容 → 本地配图
         → 选择知乎 / X → 准备草稿和附件 → 用户确认发送
```

| 功能 | 行为 |
| --- | --- |
| Markdown | 文件导入或粘贴，切换源码与渲染预览 |
| Word `.docx` | 提取标题、加粗、列表、链接、表格及受支持的内嵌图片 |
| PDF | 提取可读文字；扫描件提示需要 OCR |
| 知乎 | 标题、富文本正文和图片准备到专栏编辑器 |
| X 推文串 | 保留全文，按 280 加权字数拆分、编号，保留完整链接和 emoji |
| X Articles | 提供全文文章模式，要求账号有对应权限 |
| 本地配图 | 对接已有 Qwen Image / ComfyUI 与本地媒体调度器 |
| 分享包 | 导出 Markdown、HTML、X 文本、提示词和 PNG |
| 发布确认 | 每次选择平台；准备成功后由用户点击最终确认 |

## 安装与开发

需要支持该插件契约的 DeepSeek Harness、Node.js 22+、npm，以及已登录目标平台的 Chrome。发布自动化主要在 macOS 上调试。当前为本地目录插件，尚未上架插件市场。

```bash
git clone https://github.com/gkgy/dsh-article-share.git
cd dsh-article-share
npm ci
npm test
npm run build
```

在 DSH 中按本地插件方式加载该目录；入口是 `package.json` 中的 `dsh.bundle` / `dsh.client` 和 `cordis.patch.yml`，插件标识为 `@local/article-share`。插件在聊天输入框上方显示「文章分享 · 知乎 / X」。仓库包含构建好的 `client.js`，修改前端后需重新构建。

### 复用 Chrome 登录

在 Chrome 的 `chrome://inspect/#remote-debugging` 启用远程调试，并在 Chrome 提示时允许插件连接。插件使用官方 CDP 连接当前浏览器，不导出密码或 Cookie，也不启动新的登录配置。

如果 macOS 阻止自动读取地址，可在插件里点击「选择 Chrome 连接文件」，选择：

```text
~/Library/Application Support/Google/Chrome/DevToolsActivePort
```

Chrome 重启后可能需要重新选择。连接仅使用本机调试端口，请勿将调试端口暴露到公网。验证码、扫码和平台验证由账号本人处理。

### 可选：本地生图

**本仓库不包含模型、ComfyUI 或媒体调度器。** 文档导入、转换和分享包可独立使用；生图需要已有本地环境。

当前适配器依赖同级 `../media-scheduler/` 的 `media-runner.js`、`media-mutex.js`、`startup-recovery.js` 及其工作流文件。它们需要提供 `runMediaJob`、`MEDIA_DEFAULTS`、`splashStatus`、`MediaMutex`、`recoverMedia` 接口，并管理 Splash / ComfyUI 的内存交接。移植到其他生图环境时请修改 `image-worker.js`。

| 设置 | 默认值 |
| --- | --- |
| `ARTICLE_SHARE_NODE` | `~/.local/bin/node`，应设置为本机 Node 可执行文件绝对路径 |
| `ARTICLE_SHARE_QWEN_START` | `~/AI/Qwen-Image-Studio/start.sh` |
| ComfyUI 地址 | `http://127.0.0.1:8188`，在 `image-worker.js` 中配置 |
| 图片设置 | 1024 × 1024，25 步，1–3 张串行 |

环境变量需在启动 DSH 的环境中设置。生图前等待聊天模型空闲，生成时释放聊天模型，完成后卸载生图模型并恢复聊天模型。关闭面板不取消任务，可以重新查询或主动取消。

## 验证情况与限制

- 自动测试：8 项通过，覆盖文档转换、全文推文拆分、链接和字数边界等。
- 在真实 DSH 界面验证了 Word / PDF 导入及 Markdown 原文与渲染切换。
- 在已登录的 Chrome 上验证了知乎富文本草稿与图片上传、X 12 条推文串及首条图片附件；验证停留在最终确认前。
- 本地 Qwen 生图及图片回填已在开发环境运行成功。其他设备需要自行配置上述依赖。
- **尚未验证实际公开发送回执。X Articles 编辑器也尚未在有权限的账号上完成验证。** Articles 不可用时明确提示，不会擅自切换为推文串。

Word/PDF 上限 15 MB，PDF 最多 100 页。旧 `.doc` 请另存 `.docx`；扫描 PDF 暂无自动 OCR；复杂分栏、表格、公式和 PDF 原图需人工核对。原始 HTML 与脚本不执行。

本地相对图片通过工作区读取时仅允许文章目录内 PNG/JPEG/WebP，单张上限 8 MB；文件选择器导入可用「附加原文图片」。远程图片链接可能需要平台转存。

站点编辑器和账号权限会变化。结果不明确时插件不会自动重发，避免重复发布。选择多个平台不构成原子事务，可能出现部分成功，应查看每个平台状态。

## 数据与发布边界

文档转换在本机进行，生图调用本地服务；准备或发布时，选中的内容与附件会发送给对应平台。智能体工具可以准备草稿，最终发送通过插件界面的用户确认入口执行。

`output/` 包含连接地址、任务记录、草稿状态和生成图片；`.publish-profile/` 是旧版浏览器配置目录。这些目录以及 `.env`、日志、`node_modules/` 均不进入仓库。公开仓库不包含用户文章、账号登录数据或生成结果。

## License

原创插件代码使用 [MIT](LICENSE)。第三方依赖保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
