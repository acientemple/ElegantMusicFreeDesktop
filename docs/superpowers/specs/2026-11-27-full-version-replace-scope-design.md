# 手动选择完整版时的替换范围设计

日期：2026-11-27
状态：已实现并验证

## 目标

在**歌词播放界面**（音乐详情面板）点「搜索歌曲」按钮、或者在歌单里右键「搜索歌曲」，
在结果里选中一个版本后，这首歌要**覆盖掉歌单（播放列表）里的那一条**，
而不只是换掉当前播放队列里的那一项。

非目标：不改变「自动换完整版」的判定逻辑；不动插件的检索接口；不新增弹窗。

## 现状（为什么是现在这样）

三个入口打开的都是同一个弹窗 `Modal/templates/MusicAlternatives`，
但传入的参数不一样，于是替换范围不一样：

| 入口 | 传入 `sheetType` | 歌单里的条目 | 播放队列里的条目 |
| --- | --- | --- | --- |
| 歌单里右键「搜索歌曲」 | 歌单 id | 替换（仅这一个歌单） | 替换 |
| 播放队列里右键 | `"play-list"` | 不替换 | 替换 |
| 歌词播放界面的「搜索歌曲」按钮 | **不传** | **不替换** | 替换 |

`applyFullVersion` 里的条件是：

```ts
if (sheetType && sheetType !== "play-list") {
    await MusicSheet.frontend.replaceMusicInSheet(original, alternative, sheetType);
}
await trackPlayer.replaceMusic(original, alternative, { play: true, restartFromStart: true });
```

从歌词播放界面打开时 `sheetType` 是 `undefined`，**整段歌单替换被跳过**，
只剩队列替换 —— 于是用户看到的是「歌单里的那首还是那个不完整版」。
队列面板右键能生效，正是因为 `"play-list"` 这个值把歌单替换跳过了、
直接走队列替换那条路。

这和 `docs/superpowers/specs/2026-11-27-search-strategy-review.md` 里写的
「本地歌单里的同一首也替换 + 播放队列里的也替换」不一致：实现只覆盖了
「从歌单右键」这一条路径。

## 方案

**采用：统一用「替换所有包含这首歌的本地歌单」的做法，不再依赖 `sheetType`。**

即复用自动换完整版模块里已有的 `replaceInSheets(original, replacement)`：
它扫 `MusicSheet.frontend.getAllSheets()`，对每个包含这首歌的歌单调
`replaceMusicInSheet`，把歌单里的条目换成新版本。

备选一是让歌词播放界面自己算出当前歌曲属于哪个歌单、把 `sheetType` 传进来——
MusicDetail 是盖在所有页面上的全屏覆盖层，拿它底下的歌单要依赖路由状态，
耦合重且只覆盖「当前那一个歌单」；同名的歌在别的歌单里还是会留在旧版本。

备选二是只在缺 `sheetType` 时补一次 `replaceInSheets`、有 `sheetType` 时维持原样——
两条路径行为不一致，用户从歌单右键选中某个版本时别的歌单里仍是旧版本，
「选中的版本没有覆盖到所有地方」的问题依旧。

统一之后：

- 任何入口选中完整版 → 所有包含这首歌的本地歌单（含「我喜欢的」）都换成完整版，
  播放队列里对应的条目也换掉并从头播；
- 用户在歌单页看到的时长、来源标签随之更新，不必再回到歌单里右键一次。

## 改动

1. `src/renderer/components/Modal/templates/MusicAlternatives/index.tsx`
   - `applyFullVersion` 改为先 `await replaceInSheets(original, alternative)`，
     再 `await trackPlayer.replaceMusic(...)`；
   - `IProps` 去掉 `sheetType`，不再需要按来源区分替换范围。
2. `src/renderer/components/MusicList/index.tsx`
   - 打开弹窗时不再传 `sheetType`（`showMusicContextMenu` 的 `sheetType` 参数本身保留，
     别的菜单项还要用）。

`replaceInSheets` 本身不用改：它遍历 `getAllSheets()`，而歌单对象是从 Dexie 的
`sheets` 表整份读出来的，带着 `musicList`，「我喜欢的」也在其中。

## 取舍与已知限制

- 现在从歌单右键选中某个版本，**同名的歌在别的歌单里也会一起换掉**。
  这是有意为之：用户要的是「这个版本覆盖到所有地方」，而不是只改当前这一张列表。
- `replaceMusicInSheet` 只替换歌单里**第一个**匹配的条目（`Array.find`），
  同一张歌单里同一首歌重复出现两次时只换一处。这是既有行为，本次不动。
- `replaceInSheets` 内部吞掉异常，不会因为某个歌单写失败而影响其他歌单，
  也不会让整个替换流程失败。
- 打包版无热重载，改完需重新 `npm run package` 并 `npm run deploy:portable`。

## 验证

- `npx tsc --noEmit` 通过；`npm test` 全绿；`eslint ./src` 0 error。
- 便携版重新打包部署后实测：歌词播放界面点「搜索歌曲」→ 选中一个完整版 →
  歌单里对应那条的时长/来源随即更新，队列里当前项同步换掉并从头播；
  再次从歌单右键选中另一版本，同样覆盖所有含该歌的歌单。
