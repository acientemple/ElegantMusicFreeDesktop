# 歌词播放界面的迷你模式按钮设计

日期：2026-11-27
状态：已实现并验证

## 目标

在**歌词播放界面**（音乐详情面板）里给出一个**迷你模式**入口，
点一下即可切到迷你模式窗口，不必回到主窗口顶部标题栏去找。

非目标：不新增设置项；不改迷你模式窗口自身的行为；不动主窗口标题栏已有的那个入口。

## 现状（为什么这么做）

- 迷你模式原本只有**主窗口顶部标题栏**一个入口：
  `src/renderer/components/Header/index.tsx` 里的 `picture-in-picture-line` 图标，
  点击时 `appWindowUtil.setMinimodeWindow(!isMiniMode)`，
  开启时额外 `appWindowUtil.minMainWindow(true)` 把主窗口收起来。
- 歌词播放界面（`MusicDetail`）本身有自己的一整块全屏面板，
  面板顶部有一条 `music-detail--header-container`：
  左边是收起按钮（`chevron-down`），右边是 `music-detail--header-right`，
  里面并排放着**最小化（`minus`）/ 最大化（`square`）/ 退出（`x-mark`）**三个窗口控制按钮。
- 面板把整个主窗口盖住了，顶部标题栏被挡住，
  所以在**这个面板里**必须再给一个入口，否则用户想开迷你模式得先收起面板。

## 方案

**采用：在 MusicDetail 面板顶部 Header 的 `music-detail--header-right` 里，
于最小化按钮左侧加一个迷你模式按钮，点击逻辑与主窗口标题栏完全一致。**

备选一是把按钮放在歌词区（`.lyric-container-outer`）右上角那组浮动操作按钮里——
那是翻译切换按钮所在的位置（浮动在面板**外侧** 14px 的竖排一组），
塞进窗口控制区会破坏「面板浮动按钮」这一定位约定，且视觉上不在「右上角」。
备选二是去掉主窗口标题栏的入口只留面板入口——标题栏是全局可达的，删掉等于降级。

### 改动

1. `src/renderer/components/MusicDetail/widgets/Header/index.tsx`
   - 新增 `const isMiniMode = useAppConfig("private.minimode")`。
   - 在 `music-detail--header-right` 的**最前面**（即最小化按钮左侧）插入按钮：
     类名沿用 `header-button`，图标 `picture-in-picture-line`，
     `title={t("app_header.minimode")}`，`data-active={isMiniMode}`。
   - 点击逻辑与主窗口标题栏一字不差：
     `setMinimodeWindow(!isMiniMode)`，且**仅当开启时**才 `minMainWindow(true)`；
     关闭时不动主窗口，由主进程自己把主窗口带回来。
2. `src/renderer/components/MusicDetail/widgets/Header/index.scss`
   - 新增 `& .header-button[data-active="true"] { color: var(--primaryColor); opacity: 1; }`，
     让迷你模式开着时按钮点亮（`SvgAsset` 的 svg 用 `fill="currentColor"`，所以 `color` 生效）。
3. 文案**复用已有的** `app_header.minimode`（zh-CN「迷你模式」/ en-US「Minimode」/ zh-TW「迷你模式」），
   不新增 key——同一组按钮区里最小化/退出用的都是 `app_header.*`。

## 取舍与已知限制

- 按钮放在最小化按钮**左侧**而不是右侧：右侧是「最小化/最大化/退出」窗口控制三连，
  按 Windows 惯例额外的应用按钮应排在窗口控制组左边，
  这样最右端仍然是屏幕边缘（`padding-right: 16px`），视觉不歪。
- `data-active` 沿用既有约定：值为 `"true"` 时染成 `--primaryColor`。
- 迷你模式开着时，面板仍在主窗口里；主窗口被 `minMainWindow(true)` 收起，
  迷你模式窗口由主进程单独显示，两者互不影响。
- 打包版无热重载，改完需重新 `npm run package` 并覆盖便携版。

## 验证

- `npx tsc --noEmit` 通过；`npm test` 51/51 通过；`eslint ./src` 0 error。
- 便携版重新打包并覆盖后，通过 CDP 驱动真实页面验证：
  - DOM 命中 `.music-detail--header-right .header-button[title="迷你模式"]`，
    图标 `picture-in-picture-line`；
  - 几何：按钮与最小化按钮同处 `music-detail--header-right`，
    水平相邻（迷你模式按钮在左、最小化按钮在右），垂直居中对齐；
  - 点击行为：点一次迷你模式窗口消失、`private.minimode` 变 `false`、
    按钮 `data-active` 变 `false`；再点一次三者全部复原。

## 变更记录

- **2026-11-27 晚**：初版把按钮放在歌词区右上角的浮动按钮组
  （`.lyric-options-container--top`，面板外侧 14px）。
  按用户反馈改为**面板顶部 Header、最小化按钮旁边**，
  移除了歌词区那组按钮及其 `--top` 样式，歌词区恢复为只有翻译切换按钮。
