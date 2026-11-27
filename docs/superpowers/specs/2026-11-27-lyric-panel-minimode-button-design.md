# 歌词面板右上角迷你模式按钮设计

日期：2026-11-27
状态：已实现并验证

## 目标

在**歌词播放界面**（音乐详情面板的歌词区）右上角增加一个**迷你模式**按钮，
点一下即可切到迷你模式窗口，不必先回到顶部标题栏去找入口。

非目标：不新增设置项；不改迷你模式窗口自身的行为；不动标题栏已有的那个入口。

## 现状（为什么这么做）

- 迷你模式目前只有**顶部标题栏**一个入口：`src/renderer/components/Header/index.tsx` 里
  `picture-in-picture-line` 图标，点击时 `appWindowUtil.setMinimodeWindow(!isMiniMode)`，
  开启时额外 `appWindowUtil.minMainWindow(true)` 把主窗口收起来。
- 歌词面板右侧已经有一组**浮动操作按钮**的容器 `.lyric-options-container`：
  绝对定位在面板右外侧 14px（`right: -14px` + `transform: translateX(100%)`），
  当前挂在面板**右下角**（`bottom: 0`），里面是「翻译」切换按钮。
- 所以新增入口不需要另起一套定位体系，只要复用这个容器样式，加一个定位到顶部的修饰类。

## 方案

**采用：在歌词面板里复用既有浮动按钮容器，用 `--top` 修饰类挪到面板右上角，
点击逻辑与标题栏按钮完全一致。**

备选一是把按钮直接写进歌词面板的 Header 区——歌词面板没有 Header，
且那里会被歌词滚动内容覆盖；备选二是把迷你模式入口从标题栏删掉只留歌词面板——
标题栏是全局可达的，删掉等于降级。

### 改动

1. `src/renderer/components/MusicDetail/widgets/Lyric/index.tsx`
   - 新增 `const isMiniMode = useAppConfig("private.minimode")`。
   - 新增 `miniModeComponent`：外层 `<div className="lyric-options-container lyric-options-container--top">`，
     内层按钮类名沿用 `lyric-option-item`，图标 `picture-in-picture-line`，
     `title={t("music_detail.minimode")}`，`data-active={isMiniMode}`。
   - 点击逻辑与 `Header` 保持一字不差：
     `setMinimodeWindow(!isMiniMode)`，且**仅当开启时**才 `minMainWindow(true)`；
     关闭时不动主窗口，由主进程自己把主窗口带回来。
   - 该组件渲染在 `.lyric-container-outer` 内、歌词滚动区之外，
     不参与歌词滚动。
2. `src/renderer/components/MusicDetail/widgets/Lyric/index.scss`
   - 新增 `& .lyric-options-container--top { top: 0; bottom: auto; }`。
     基类只有 `bottom: 0`，不加 `bottom: auto` 会因为 `top`/`bottom` 同时存在而拉伸。
3. 三语文案 `music_detail.minimode`：zh-CN「迷你模式」/ en-US「Minimode」/ zh-TW「迷你模式」。

## 取舍与已知限制

- `data-active` 沿用翻译按钮的约定：值为 `"true"` 时图标染成 `--primaryColor`，
  用来表示迷你模式当前处于开启状态。
- 按钮在面板**外侧** 14px（沿用基类定位），面板宽度 40vw，右侧还有富余空间，
  不会与 `.hide-music-detail`（`position: fixed; right: 36px; top: 36px`）冲突。
- 顶部这组和底部那组是同一个基类的两个实例，两者相距一个面板高度，不会重叠。
- 打包版无热重载，改完需重新 `npm run package` 并覆盖便携版。

## 验证

- `npx tsc --noEmit` 通过；`npm test` 51/51 通过；`eslint ./src` 0 error。
- 便携版重新打包并覆盖后，通过 CDP 驱动真实页面验证：
  - DOM 命中 `.lyric-options-container--top .lyric-option-item`，
    `title="迷你模式"`，图标 18×18；
  - 几何（1920×1008 视口）：歌词面板 `x=779 w=768`（右边缘 1547），
    按钮 `x=1561 y=1217`——**按钮左边缘在面板右边缘外 14px，顶边与面板顶边齐平**，
    即面板右上角；
  - 点击行为：点一次迷你模式窗口消失、`private.minimode` 变 `false`、
    按钮 `data-active` 变 `false`；再点一次三者全部复原。
