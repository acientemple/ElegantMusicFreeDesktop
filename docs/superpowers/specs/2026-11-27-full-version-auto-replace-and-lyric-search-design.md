# 播放自动换完整版 + 歌词检索过滤 设计

日期：2026-11-27
状态：待用户确认

## 目标

1. 播放列表里的歌如果不是完整版（一般在一分钟以内），自动搜完整版、覆盖原来的条目再播。
2. 「搜索歌词」弹窗里去掉「哔哩哔哩音乐」「哔哩哔哩MV」两个标签页。
3. 把歌词、完整版、MV 三条检索链路现有的方法与策略写成文档，供用户判断是否扩大检索源。
4. 评估歌词与 MV 的时长能否提取出来跟歌曲时长对比。

非目标：不改插件协议；不新增设置项；不改变「智能匹配歌词」的候选池构成；
不做播放中（已开始播放后）的中途换源。

## 为什么

**完整版**：插件返回的条目有时是试听片段（网易云等平台的试听链接通常只有 30~60 秒），
播完就没了。应用里已经有「完整播放版本」弹窗（`Modal/templates/MusicAlternatives`），
靠插件的 `getMusicAlternatives` 方法搜同曲的完整版本并替换，但需要用户手动点。
用户希望播放时就自动做掉。

**歌词检索**：B 站系插件声明了 `supportedSearchType: ['music', 'lyric']`，
所以在「搜索歌词」弹窗里会各占一个标签页。但它们检索到的是视频条目，
`getLyric` 拿到的多半是 `[00:00.00]暂无字幕` 占位（插件自己的兜底），
点进去只会关联上一份占位歌词。两个标签页是纯噪声。

## 方案

### 一、播放时自动换完整版

新增 `src/renderer/core/music-full-version/index.ts`：

- **片段判定** `isPreviewClip(item)`：取插件声明时长（经 `normalizeDuration` 归一化，
  毫秒当秒返回的会被纠正），没有就用实测校正时长；时长未知一律**不判定**，
  也就不会触发检索。阈值 `PREVIEW_MAX_DURATION = 60` 秒。
- **检索** `findFullVersion(item)`：向所有支持 `getMusicAlternatives` 的插件并发要第一页，
  `Promise.allSettled` 汇总，任一插件失败不影响其它。整体 8 秒超时，
  超时按「没找到」处理并**不**记入缓存，下次播放还会再试。
- **选取** `pickFullVersion(original, candidates)`：
  - 排除与原条目同一首歌（`isSameMedia`）；
  - 排除没有时长的候选（无法判断是不是完整版）；
  - 排除时长仍然 ≤ 60 秒的候选（还是片段）；
  - 要求明显更长：≥ `max(原时长 + 60, 120)` 秒；
  - 排序：原唱（`isOriginArtist`）优先，其次时长长的优先。
- **缓存**：条目主键 `platform@id` → 找到的完整版；查过且确认没有的记进「已查无」集合，
  避免每次播放都重新请求插件。

**接入点**：`src/renderer/core/track-player/index.ts` 的 `playIndex()`，
在 `setCurrentMusic` 之前判断。找到完整版就走 `replaceMusic(original, full, {play: true})`，
它会替换队列里的同名条目并重新播放；替换后的条目时长正常，不会再次触发判定，
天然不会递归。本地歌单里同一首也一并替换（扫 `getAllSheets()` 找出包含该条目的歌单，
逐个调 `replaceMusicInSheet`），这样下次从歌单再播时不用重新检索。

没有插件实现 `getMusicAlternatives` 时直接放行，行为与现在完全一致。

### 二、歌词检索过滤

`src/common/lyric-util.ts` 增加：

```ts
export function isLyricSearchExcluded(platform?: string | null): boolean
```

规则：平台名等于或以「哔哩哔哩」开头的一律排除在歌词检索之外。
用前缀而不是全等，是为了同时盖住「哔哩哔哩音乐」和「哔哩哔哩MV」，
以后再加 B 站的插件也不用改。

`Modal/templates/SearchLyric/index.tsx` 的 `availablePlugins` 过滤掉这些插件，
标签页与面板同时少掉。

**只影响「搜索歌词」弹窗**。「智能匹配歌词」（`core/smart-lyric`）的候选池不变——
B 站视频的字幕在那条链路里是真能用的歌词源，删掉反而丢能力。

### 三、歌词 / 完整版 / MV 的检索方法与策略

单独一份文档：`2026-11-27-search-strategy-review.md`，逐条写清现有做法、
调用到的插件方法、以及可调整的点。

### 四、歌词与 MV 的时长能不能提取

结论写在策略文档里，简述：

- **MV 时长**：能。MV 条目自带 `duration`（B 站视频时长），
  插件里已经有 `isFullLength(video, songDuration)` 做「画面长度 vs 歌曲长度」的比对。
- **歌词时长**：能，但要区分两件事。歌词本身没有时长字段，
  可以从 LRC 的最后一个时间戳推算出歌词覆盖的时间跨度；
  而歌词**来源歌曲**的时长就是该候选条目的 `duration`，本来就有。
  拿歌词跨度跟歌曲时长比，能判断「这份歌词是不是只有开头几句」。

## 改动清单

1. 新增 `src/renderer/core/music-full-version/index.ts`：片段判定、检索、选取、缓存。
2. 新增 `src/renderer/core/music-full-version/index.test.ts`：
   覆盖片段判定边界（59/60/61 秒、毫秒当秒、时长未知）、
   候选筛选（排除自身、无时长、仍是片段、不够长）、排序（原唱优先、时长优先）。
   纯逻辑抽到同目录的 `pure.ts`，`node:test` 才能直接加载。
3. `src/renderer/core/track-player/index.ts`：`playIndex()` 接入自动换完整版。
4. `src/common/lyric-util.ts`：增加 `isLyricSearchExcluded()`。
5. `src/renderer/components/Modal/templates/SearchLyric/index.tsx`：过滤标签页。
6. 三语文案（`res/lang/zh-CN.json`、`en-US.json`、`zh-TW.json`）：
   `play_music_full_version_replaced`（已自动换成完整版）。

## 取舍与已知限制

- 判定依据是**插件声明的时长**。插件没给时长、或时长写错的歌不会被自动处理；
  实测时长只在校正值与声明值一致时才存在（`music-duration` 不会为明显偏短的音频建档），
  所以实测这一路基本帮不上忙。
- 替换会改写本地歌单里的条目，与手动「完整播放版本」弹窗的行为一致。
- 有些歌本来就短（间奏、短曲），只要找不到明显更长的版本就不会被动。
- 检索有 8 秒上限，超时后本次照常播放原条目，只是延迟。
- 歌词检索过滤是写死的平台名前缀，不是设置项；换策略要改
  `src/common/lyric-util.ts`。
- 打包版无热重载，改完需重新 `npm run package` 并覆盖便携版。
