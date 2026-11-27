# 按实测时长判定试听片段并自动换完整版

日期：2026-11-27
状态：已实现并验证

## 目标

播放歌曲时自动判断拿到的音频是不是**只有几十秒的试听片段**，
是的话自动搜索完整版并换上去接着播，不���用户手动操作。

非目标：不改变「怎么挑完整版」的既有规则；不动插件的检索接口；
不改手动「搜索歌曲」弹窗的行为。

## 现状（为什么之前没生效）

已有实现（`src/renderer/core/music-full-version/`）在 `trackPlayer.playIndex()`
**播放之前**判定一次，判据只有一条：**插件写在条目上的声明时长**
（`isPreviewClip` → `isPreviewDuration(musicItem.duration)`）。

问题是主流平台的试听片段**不在条目上体现**：

- QQ 音乐 / 网易云给免费用户的播放地址就是 30 秒试听，
  但条目里的 `duration` / `interval` 仍然是**完整歌曲的时长**（比如 4:35）。
- 于是 `isPreviewDuration(275)` → false → 不判定 → 不检索 → 照旧播 30 秒就没了。

**声明时长这一路只覆盖了「插件直接给出 30 秒」的小众情况，
用户实际遇到的是「声明完整、实际片段」，所以功能形同虚设。**

而**实际音频长度是拿得到的**：`audio-controller` 的
`audio.ontimeupdate` 每帧上报 `{currentTime, duration}`，
`duration` 就是音频文件本身的长度（`audio.duration`），
一路送到 `track-player` 的 `captureRealDuration()`。

只是那里拿到实测时长后只做了两件事：
`correctDurationByMeasured()` 在「实测明显短于声明」时直接放弃（不写库），
**没有任何地方拿它去判断片段、更没有触发检索**。

## 方案

**采用：把「是不是片段」的判据扩成两路 —— 声明时长 **或** 实测时长，
两者任一 ≤ 60 秒即判定为片段；实测到片段时立刻检索并替换。**

### 判定规则

| 情况 | 判定 | 触发时机 |
| --- | --- | --- |
| 声明时长 ≤ 60 秒 | 片段 | 播放前 |
| 实测时长 ≤ 60 秒（声明 4:35、实际 30 秒） | 片段 | 播到元数据就绪时 |
| 声明 4:35、实测 30 秒，且这一首之前已确认是片段 | 片段 | 播放前（第二次播就不用再听 30 秒） |

实测时长优先于声明：只要实测短就是片段，不管声明写得多长。

### 三个入口

1. **播放前**（`playIndex`）：已有调用，判定规则换成新的两路判据。
2. **播到元数据就绪**（`captureRealDuration`）：新增。
   实测时长一出来就是准的，不用等播完 30 秒才反应。
3. **再次播放同一首**（`previewClipKeys` 内存集合）：
   实测确认过的片段条目记下来，下次播放前就能判定，直接换完整版。

### 防来回换

完整版候选本身也可能还是片段（插件给的候选质量参差）。
记一个 `autoReplacedTargets` 集合：**被自动换进去过的条目不再自动换**，
否则 A → B → A 会无限循环。手动换（弹窗里选的）不经过这条链路，不受影响。

### 改动

1. `src/renderer/core/music-full-version/pure.ts`
   - 新增纯函数 `isPreviewItem(declaredDuration, measuredDuration)`：
     任一 ≤ `PREVIEW_MAX_DURATION` 即为片段。补单测。
2. `src/renderer/core/music-full-version/index.ts`
   - `isPreviewClip` / `findFullVersion` 改用两路判据；
   - `findFullVersion` 增加可选的 `measuredDuration` 参数；
   - 新增 `previewClipKeys`（实测确认是片段）、`autoReplacedTargets`（防循环）；
   - 新增 `markPreviewClip` / `markAutoReplaced`；
   - `clearFullVersionCache` 一并清这两个集合。
3. `src/renderer/core/track-player/index.ts`
   - `captureRealDuration` 里，实测时长 ≤ 60 秒时调 `checkPreviewClip()`；
   - 新增 `checkPreviewClip()`：检索 → 校验当前仍是这首 → 替换并从头播 →
     标记新条目、顺手把歌单里的同一首也换掉 → 提示「已自动换成完整版」。

## 取舍与已知限制

- **实测路径要等音频元数据就绪**（`audio.ontimeupdate` 第一次上报），
  通常在开始播放后几百毫秒内，不影响听感。
- 实测判据只看「≤ 60 秒」，不比较声明时长：本来就很短的曲子（25 秒的彩蛋）
  也会被判成片段 → 检索一次找不到完整版 → 保持原样，只是多一次无用检索。
  想更保守可以要求实测明显短于声明，但那样「声明未知」的条目就漏了。
- `previewClipKeys` 只在内存里，跨重启不保留：重启后第一次播放仍要走
  「播到 30 秒再换」这条路，之后同一会话内就是播放前直接换。
- 插件检索有 8 秒整体超时，挂死的插件不会卡住播放（这一点在
  `2026-11-27-full-version-replace-scope-design.md` 里一并修的）。

## 验证

- `npx tsc --noEmit` 通过；`npm test` 全绿；`eslint ./src` 0 error。
- 便携版重新打包部署后实测：播放一首 30 秒试听片段 →
  自动检索并换成完整版从头播，歌单里的同一首也跟着换掉，
  播放条提示「已自动换成完整版」。
