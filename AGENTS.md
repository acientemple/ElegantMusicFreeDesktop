# AGENTS.md

MusicFree Desktop —— Electron + React 18 + TypeScript 的插件化音乐播放器。
本文件是给所有 AI 编码代理（Codex / Cursor / OpenCode / Claude Code 等）的**自包含速查版**；
**深度架构文档以 [`CLAUDE.md`](./CLAUDE.md) 为唯一权威版本**，动架构前请通读对应章节。

仓库是上游 `maotoumao/MusicFreeDesktop` v0.0.8 的本地定制 fork（`origin` → `acientemple/ElegantMusicFreeDesktop`），
在上游基础上加了 MV 播放/搜索、唱卡拉OK、歌曲信息编辑与时长校正、播放队列定位到歌单、窗口置顶与自由缩放、
音乐可视化、歌单导入导出等定制功能。

> 源码在 `src/`，但**运行时不在仓库里**：用户实际使用便携版
> `D:\work\OneDrive\Desktop\projects\MusicFree`（含 `portable/userData` 用户数据）。
> 改完代码必须走「部署到便携版」才能生效。

## Setup commands

- Install deps: `npm install`
- Start dev:    `npm start`（`npm run dev` 额外带 `--inspect-electron`）
- Build:        `npm run package` → `out/MusicFree-win32-x64`（约 5 分钟，exe 160MB+）
- Test:         `npm test`（`node:test`，无需构建）
- Lint:         `npm run lint`（`eslint ./src --fix`，**会自动改代码**）
- Typecheck:    `npx tsc --noEmit`（package.json 里没有 typecheck 脚本）

## 部署到便携版

覆盖前先结束正在运行的 `MusicFree.exe`，否则 exe 被占用会导致失败：

```bash
npx tsc --noEmit
npm run package
robocopy out\MusicFree-win32-x64 "D:\work\OneDrive\Desktop\projects\MusicFree" /E /R:1 /W:1 /NFL /NDL
```

**robocopy 绝不能加 `/MIR`** —— 会删掉 `portable/` 里的用户数据（插件、设置、歌单数据库）。

## Project layout

- `src/main/` — Electron 主进程：窗口管理、托盘、深链、应用内更新器、插件管理
- `src/renderer/` — 主窗口 React 界面（四个渲染进程中最大的一个）
- `src/renderer-lrc/` `src/renderer-minimode/` `src/renderer-visualization/` — 桌面歌词 / 迷你模式 / 可视化窗口
- `src/preload/` — 各渲染进程的 contextBridge 桥接层
- `src/shared/` — 主进程与渲染进程共用模块（app-config / plugin-manager / message-bus / short-cut / themepack …）
- `src/webworkers/` — downloader / local_file_watcher worker（`db` worker 是孤儿 entry，零引用）
- `src/common/` `src/types/` `src/hooks/` — 公共工具、类型声明、React hooks
- `config/` — webpack 配置（main / renderer / plugins / rules）
- `scripts/` — 构建与上传脚本（`verify-visualization-capture.js`、`feishu-upload.js`）
- `res/lang/` — i18n 资源：`zh-CN.json` / `en-US.json` / `zh-TW.json`
- `plugins/` `themepacks/` — 插件与主题包的**仓库副本**，运行时用便携版 `portable/userData/` 下的，改动要两边同步
- `release/` — **入库的发布产物**（版本信息、精简便携版、在线安装器），不是构建缓存
- `docs/superpowers/specs/` `docs/superpowers/plans/` — 本地定制功能的设计与实施文档（按日期命名）

## Code style

- ESLint 9 flat config：`eslint.config.mjs`，TypeScript + `@stylistic` 插件
- 硬性格式：4 空格缩进、双引号、分号、多行末尾逗号、1tbs 大括号风格
- `import/no-duplicates`、`import/no-self-import` 是 error；`no-console` 是 warn（`src/main/` 与 `scripts/` 例外）
- TypeScript：`noImplicitAny: true`、`noEmit: true`；路径别名 `@/*` `@main/*` `@shared/*` `@native/*` `@renderer*/`
- 浮层层级数值集中在 `src/common/constant.ts` 的 `zIndexLevels`，改组件时两边同步
- 新增文案必须同时补 `res/lang/zh-CN.json`、`en-US.json`、`zh-TW.json` 三个文件
- 配置项键名**扁平**（如 `normal.alwaysOnTop` 直接写在 `config.json` 顶层）

## Testing instructions

- 单测用 node:test，测试文件与源码同目录 `*.test.ts`；`npm test` 跑全部，单跑一个：
  `node --test src/renderer/core/track-player/seek.test.ts`
- 测试由 Node 直接剥离类型运行，**不经过 webpack / ts-node**，因此：
  - import 必须写扩展名（`from "./seek.ts"`），不能依赖目录解析
  - 被测模块不能引用 `@/...`、`@shared/...` 别名，也不能依赖 Electron / 浏览器全局
  - 需要单测的逻辑要抽成零依赖纯模块（`sheet-backup.ts` 就是为此刻意不 import 任何运行时依赖）
  - 本机 Node 25 可直接跑；低于 22.18 的 Node 需要加 `--experimental-strip-types`
- 覆盖范围仅限纯逻辑（歌单备份解析、播放器 seek、可视化频谱/节拍/主题色）；
  **UI / IPC / 播放链路无测试**，只能 `npm start` 手动验证
- 提交前跑 `npx tsc --noEmit`：webpack 用 `fork-ts-checker`，类型错误不一定会让打包失败

## Commit & PR conventions

- 分支从 `master` 切出，不直接推 master
- 提交信息用 Conventional Commits 前缀（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`），一件事一个 commit
- 提交走 husky `pre-commit` → `npm run lint-staged`（对暂存文件跑 lint，**会自动改代码**，改完要一并 `git add`）
- 发版：改 `package.json` 的 version → 提交 → 打同名 tag 推送
  （`git tag v0.0.9 && git push origin v0.0.9`），`.github/workflows/release.yml` 自动构建发布

## Security

- 绝不提交密钥/凭证；`.env` 在 `.gitignore` 里
- AGPL 3.0 协议：二次分发需保留代码出处（https://github.com/maotoumao/MusicFree），不得商用
- 在线安装器的 AppId `{D1286FEF-7F3B-40BA-8881-36005EE2895E}` 永不改——安装版升级识别靠它

## 关键约束（改代码前务必确认）

1. **单测模块零依赖** —— 被测文件不得 import 别名、不得依赖 Electron
2. **主题包变量体系是 camelCase**（`--primaryColor` 等 20 个，见 `src/renderer/document/styles/variables.scss`），
   不是社区主题那套 kebab-case，照抄社区主题会一条都不生效
3. **浮层先看层叠上下文再调 z-index** —— 主题包会给 `.body-container` 设 `z-index` 形成独立层叠上下文，
   侧滑面板因此统一用 React portal 挂到 `document.body`，改渲染位置时务必保留这个 portal
4. **绝不动播放器音频路径** —— 可视化用 `audio.captureStream()`，不给 `<audio>` 加 `crossOrigin`，
   也不动「全局音量 × 本地增益」模型，跨域音源宁可降级也不能让它播不出来
5. **`release/portable/` 是有意入库的** —— 在线安装器 payload 从它组装，别当构建产物清理，也别 `git rm -r`
6. **侧边栏导入歌单一律追加**，不覆盖；只有设置页的「备份恢复」才按 `backup.resumeBehavior` 决定
7. **改本地定制功能前先读 `docs/superpowers/specs/` 下对应设计文档** —— 别推翻已确认过的取舍

---

更多细节（渲染进程自研 store、插件方法三层协议、主题包打包坑、多窗口 message-bus、
发版与在线安装器完整流程、各类「容易踩的点」）见 [`CLAUDE.md`](./CLAUDE.md)。
