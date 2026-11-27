# 扩展快捷键命令与默认键位设计

日期：2026-11-27
状态：已实现并验证

## 目标

1. 在现有快捷键体系上补一批常用命令：播放控制、播放模式、界面开关，
   以及「搜完整版 / 搜 MV / 搜歌词」这类功能入口。
2. 给这些命令配上符合桌面播放器惯例的**默认键位**，用户开箱即用。
3. 新增的默认键位对**已有用户**同样生效（现在做不到，见「现状」）。

非目标：不重做快捷键设置界面；不改录制输入框的交互；不做全局快捷键的默认绑定。

## 现状（为什么这么做）

现有命令只有 10 条（`src/common/constant.ts` 的 `shortCutKeys`）：
播放/暂停、上下首、快退快进 5 秒、音量增减、桌面歌词、喜欢/不喜欢、显示主窗口。
用户要的「搜完整版 / 搜 MV / 搜歌词」都不在表里。

设置页 `setting-view/routers/ShortCut` 是**自动遍历命令表**渲染的
（`shortCutKeys.map(...)` + `t(\`settings.short_cut.${it}\`)`），
所以新增命令**不用改设置页 UI**，只要命令表、类型、命令处理、文案四处对齐。

### 默认键位对已有用户不生效

`loadConfig` 是浅合并（`{ ...defaultAppConfig, ...this.config }`），
`shortCut.shortcuts` 整个对象被用户配置覆盖。而 `ShortCut.setup()` 只读
`AppConfig.getConfig("shortCut.shortcuts")` 里已有的键，
**不会**把新加的默认键位补进来 —— 老用户升级后新增的默认键位形同虚设。

修法：`setup()` 里对**用户没设置过**的键回退到默认配置，
而用户明确清空的键（值为 `null`）保持清空。区分这两者的关键是
「这个键在用户配置里有没有出现过」，而不是「值是不是空」。

## 命令清单

### 播放控制

| 命令 | 键 | 默认 | 说明 |
| --- | --- | --- | --- |
| `play/pause` | `play/pause` | `Space` | 播放/暂停 |
| `seek-backward` | `seek-backward` | `Left` | 快退 5 秒 |
| `seek-forward` | `seek-forward` | `Right` | 快进 5 秒 |
| `seek-backward-long` | `seek-backward-long` | `Ctrl+Left` | 快退 30 秒 |
| `seek-forward-long` | `seek-forward-long` | `Ctrl+Right` | 快进 30 秒 |
| `skip-previous` | `skip-previous` | `Up` | 上一首 |
| `skip-next` | `skip-next` | `Down` | 下一首 |
| `volume-up` | `volume-up` | `Ctrl+Up` | 音量 +4% |
| `volume-down` | `volume-down` | `Ctrl+Down` | 音量 -4% |
| `toggle-mute` | `toggle-mute` | `M` | 静音切换 |
| `toggle-repeat-mode` | `toggle-repeat-mode` | `R` | 顺序/单曲/随机循环 |

### 界面

| 命令 | 键 | 默认 | 说明 |
| --- | --- | --- | --- |
| `like/dislike` | `like/dislike` | `L` | 喜欢/不喜欢当前歌曲 |
| `toggle-music-detail` | `toggle-music-detail` | `Ctrl+D` | 显示/隐藏音乐详情面板 |
| `toggle-play-list` | `toggle-play-list` | 无 | 显示/隐藏播放队列面板 |
| `toggle-minimode` | `toggle-minimode` | 无 | 切换迷你模式 |
| `toggle-desktop-lyric` | `toggle-desktop-lyric` | 无 | 显示/隐藏桌面歌词 |
| `toggle-main-window-visible` | `toggle-main-window-visible` | 无 | 显示/隐藏主窗口 |

### 功能

| 命令 | 键 | 默认 | 说明 |
| --- | --- | --- | --- |
| `search-full-version` | `search-full-version` | `Ctrl+F` | 搜索完整播放版本 |
| `search-mv` | `search-mv` | `Ctrl+M` | 搜索 MV |
| `search-lyric` | `search-lyric` | `Ctrl+L` | 搜索歌词 |
| `smart-lyric` | `smart-lyric` | 无 | 智能匹配歌词 |
| `audio-recognition` | `audio-recognition` | 无 | 听歌识曲 |

共 22 条（新增 12 条）。

**为什么不都给默认键位**：`Ctrl+P`（播放队列）、`Ctrl+Shift+…` 这类组合容易和
应用/系统快捷键撞车，也可能被用户用来做别的。全局快捷键一律不预置 ——
全局键会占用系统级组合，默认绑定等于替用户做决定。

## 改动

1. `src/types/app-config.d.ts`：`shortCut.shortcuts` 的联合类型加 12 个新键。
2. `src/common/constant.ts`：`shortCutKeys` 加 12 项；`shortCutKeysCommands`
   补上到新命令的映射。
3. `src/shared/message-bus/type.d.ts`：`ICommand` 加 12 个命令。
4. `src/renderer/document/bootstrap.ts`：注册这 12 个命令的处理。
   - 快退/快进 30 秒复用已有的 `seekBy`（把秒数参数化）；
   - 静音用一个模块级变量记住静音前的音量，取消静音时还原；
   - 搜完整版/搜 MV/搜歌词/智能匹配/听歌识曲都是 `showModal(...)`，
     传当前播放的歌曲；没有当前歌曲时直接返回；
   - 循环模式用 `trackPlayer.toggleRepeatMode()`；
   - 音乐详情用 `musicDetailShownStore` 判断显隐；
   - 播放队列用 `getCurrentPanel()?.type === "PlayList"` 判断；
   - 迷你模式与标题栏入口同逻辑：`setMinimodeWindow(!isMiniMode)`，
     开启时额外 `minMainWindow(true)`。
5. `src/shared/app-config/default-app-config.ts`：补 12 条默认键位。
6. `src/shared/short-cut/renderer.ts`：`setup()` 对用户没设置过的键回退到默认配置，
   让新增的默认键位对老用户也生效；用户明确清空（`null`）的键保持清空。
   补上的默认键位**一次性写盘**（不是每个键写一次）—— 配置更新是 IPC 异步回来的，
   逐条写会用旧快照把前一条覆盖掉。
   绑定 / 解绑改为记录实际绑给 `hotkeys-js` 的键序列，不再依赖配置里的旧值。
7. 三语文案：`settings.short_cut.<key>` 补 12 条。

## 取舍与已知限制

- **静音不是音量 0 的永久状态**：取消静音时还原到静音前的音量，
  而不是回到某个固定值。静音期间的音量增减会被忽略（否则记不住该还原成多少）。
- **快退/快进 30 秒**用 `Ctrl+←/→`，与已有的 5 秒区分开。
- **录制输入框里按方向键**时，录制和播放动作可能同时触发（既有机制的通病），
  本次不专门处理。
- **快捷键会阻止默认行为**（`evt.preventDefault()`），所以 `Space` 绑到播放/暂停后，
  焦点在按钮上时按空格会触发播放而不是点按钮。这是快捷键系统的既有行为。
- 搜索类命令在没有当前歌曲时静默返回，不弹提示（避免连按快捷键时刷屏）。
- 打包版无热重载，需重新 `npm run package` 并 `npm run deploy:portable` 后生效。

## 验证

- `npx tsc --noEmit` 通过；`npm test` 全绿；`eslint ./src` 0 error。
- 实机验证：设置页新增的命令行都出现且可录制；按 `Space` 能播放/暂停，
  `Ctrl+→` 能快进 30 秒，`M` 能静音再取消，`Ctrl+F` 弹出「完整播放版本」弹窗。
