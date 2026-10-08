[简体中文](README.md) | **English**

<div align="center">
<img src="icon.svg" width="72" alt="Article Share icon">

# DSH Article Share

**Turn Markdown, Word, and PDF documents into Zhihu articles and X content, add local AI images, then confirm publication.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DeepSeek Harness plugin · Local document conversion · Reuse your Chrome session · Choose platforms each time
</div>

## Workflow

```text
Import → Source / rendered preview → Edit platform content → Local images
       → Select Zhihu / X → Prepare drafts and attachments → Confirm publication
```

| Feature | Behavior |
| --- | --- |
| Markdown | Import a file or paste text; switch between source and rendered preview |
| Word `.docx` | Extract headings, bold text, lists, links, tables, and supported embedded images |
| PDF | Extract readable text; scanned documents show an OCR-required message |
| Zhihu | Prepare the title, rich text, images, and a separate article cover in the column editor |
| X threads | Preserve the full text, split and number posts within 280 weighted characters, and keep links and emoji intact |
| X Articles | Full-length article mode, requiring the corresponding account access |
| Local images | Integrate an existing Qwen Image / ComfyUI setup and local media scheduler |
| Share package | Export Markdown, HTML, X text, prompts, and PNG files |
| Publication confirmation | Select platforms each time; the user confirms after preparation succeeds |

## Installation and development

Requires DeepSeek Harness with the supported plugin contract, Node.js 22+, npm, and Chrome signed in to the target platforms. Publication automation has mainly been tested on macOS. This is currently a local-directory plugin and is not listed in a plugin marketplace.

```bash
git clone https://github.com/gkgy/dsh-article-share.git
cd dsh-article-share
npm ci
npm test
npm run build
```

Load this directory as a local plugin in DSH. Entry points are declared in `package.json` under `dsh.bundle` / `dsh.client` and in `cordis.patch.yml`. The plugin identifier is `@local/article-share`. The “文章分享 · 知乎 / X” button appears above the chat input. A prebuilt `client.js` is included; rebuild it after editing the frontend.

### Reuse your Chrome session

Enable remote debugging at `chrome://inspect/#remote-debugging` and allow the connection when Chrome prompts you. The plugin connects to your current browser through official CDP. It does not export passwords or cookies or create another browser login profile.

If macOS blocks automatic address discovery, click “选择 Chrome 连接文件” (Select Chrome connection file) in the plugin and choose:

```text
~/Library/Application Support/Google/Chrome/DevToolsActivePort
```

You may need to select it again after restarting Chrome. The connection uses a local debugging port; do not expose it to the public internet. Account owners must handle CAPTCHAs, QR sign-in, and platform verification.

### Optional: local image generation

**This repository does not include models, ComfyUI, or the media scheduler.** Import, conversion, and share-package export work independently; image generation requires an existing local setup.

The current adapter depends on `media-runner.js`, `media-mutex.js`, `startup-recovery.js`, and workflow files in the sibling `../media-scheduler/` directory. They must provide `runMediaJob`, `MEDIA_DEFAULTS`, `splashStatus`, `MediaMutex`, and `recoverMedia`, and manage memory handoff between Splash and ComfyUI. Edit `image-worker.js` to adapt another image-generation setup.

| Setting | Default |
| --- | --- |
| `ARTICLE_SHARE_NODE` | `~/.local/bin/node`; set it to the absolute path of your Node executable |
| `ARTICLE_SHARE_QWEN_START` | `~/AI/Qwen-Image-Studio/start.sh` |
| ComfyUI URL | `http://127.0.0.1:8188`, configured in `image-worker.js` |
| Image settings | 1024 × 1024, 25 steps, 1–3 images generated sequentially |

Set environment variables in the environment that launches DSH. Image generation waits until the chat model is idle, releases it during generation, then unloads the image model and restores the chat model. Closing the panel does not cancel a job; you can check it again or cancel it explicitly.

Zhihu preparation automatically generates a missing local cover or reuses an existing one, then uploads it through the separate cover input in publication settings. Final confirmation requires a verified cover thumbnail. If the cover changes or disappears, prepare the draft again.

## Verification and limitations

- Eleven automated tests passed, covering document conversion, full-text thread splitting, links, and character-count boundaries.
- 2026-10-09: Verified automatic upload of the separate Zhihu cover through DSH → Chrome, with the cover retained after a draft reload. The article was not publicly submitted again.
- Word / PDF import and Markdown source / rendered-preview switching were verified in the actual DSH interface.
- Zhihu rich-text drafts and image uploads, and a 12-post X thread with an image attached to the first post, were verified in signed-in Chrome. Testing stopped before final confirmation.
- Local Qwen image generation and image insertion succeeded in the development environment. Other devices must configure the dependencies above.
- **Actual public-posting receipts have not been verified. The X Articles editor has also not been verified with an eligible account.** If Articles is unavailable, the plugin reports it instead of silently switching to a thread.

Word / PDF files are limited to 15 MB; PDFs to 100 pages. Save legacy `.doc` files as `.docx`. Scanned PDFs have no automatic OCR yet. Check complex columns, tables, formulas, and original PDF images manually. Raw HTML and scripts are not executed.

Workspace loading accepts relative PNG / JPEG / WebP images only within the article directory, up to 8 MB each. File-picker imports can use “附加原文图片” (Attach original images). Remote image links may require the platform to store its own copy.

Editors and account permissions can change. The plugin does not automatically retry when a result is uncertain, to avoid duplicate posts. Multi-platform publication is not atomic: some platforms may succeed while others fail, so check each platform's status.

## Data and publication boundaries

Document conversion runs locally and image generation calls local services. Preparing or publishing sends the selected content and attachments to the selected platforms. Agent tools can prepare drafts; final submission goes through the user-confirmation control in the plugin interface.

`output/` holds connection addresses, job records, draft states, and generated images. `.publish-profile/` is an older browser-profile directory. These directories, `.env`, logs, and `node_modules/` are excluded from the repository. The public repository contains no user articles, account login data, or generated outputs.

## License

Original plugin code is licensed under [MIT](LICENSE). Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
