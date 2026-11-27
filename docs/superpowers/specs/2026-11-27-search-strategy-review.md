# 歌词 / 完整版 / MV 三条检索链路的方法与策略

日期：2026-11-27
状态：现状梳理，供用户判断是否扩大检索源或调整策略

这份文档只描述**现状**，不含改动。每条链路写清：入口、调用的插件方法、
内部策略、以及可调整的点。

---

## 一、歌词检索

应用里有两条互不相干的歌词检索链路。

### 1. 手动「搜索歌词」弹窗

- 组件：`src/renderer/components/Modal/templates/SearchLyric/`
- 检索逻辑：`hooks/useSearchLyric.ts`

流程：

1. `PluginManager.getSearchablePlugins("lyric")` 取出**声明支持歌词检索**的插件，
   每个插件在界面上占一个标签页。
2. 每个插件调 `search(query, page, "lyric")`，即以 `lyric` 为 type 检索。
3. 结果是 `ILyric.ILyricItem[]`（继承 `IMusicItem`，自带 `duration`、`artwork`）。
4. 点某条结果 → `linkLyric(musicItem, it)` 把歌词关联到当前歌曲；
   关联后立刻 `trackPlayer.fetchCurrentLyric(true)` 刷新当前播放的歌词。

现状要点：

- **只翻第一页**。`useSearchLyric` 有 page 状态，但界面上没有「加载更多」入口。
- 插件的 `search` 若忽略 type 参数，B 站系插件就会把视频条目塞进歌词结果里——
  这正是本次要去掉那两个标签页的原因。

### 2. 自动「智能匹配歌词」

- 组件：`src/renderer/components/Modal/templates/SmartLyric/`
- 核心：`src/renderer/core/smart-lyric/index.ts`
- 打分工具：`src/common/lyric-util.ts`

流程：

1. **挑插件**（`getLyricSearchPlugins`）：声明支持 `lyric` 的按 `lyric` 检索；
   只声明 `music` 的按 `music` 检索（歌词候选本来就是歌，取回后再调 `getLyric`）；
   什么都没声明的按 `defaultSearchType`。
2. **造检索词**（`buildSearchQueries`），最多 5 个：
   - 标题里夹带的歌手 + 歌名（标题形如「歌名 - 歌手 - 歌词片段」时最准）
   - 歌名 + 歌手
   - 歌名
   - 歌手 + 歌名
   - 标题的其它写法（去掉「无损 / 完整版 / Live / DJ」等修饰词后的变体）
   检索词长度上限 16 字，太长的多半是歌词片段，检索只会带回来噪声。
3. **发请求**：串行，插件之间间隔 700ms（网易云这类接口打密了会被风控）。
   某插件返回空 → 等 2s 重试一次；还空 → 该插件冷却 20s。
4. **翻页**：检索词是「歌名 + 歌手」这种复合式时，第一页没找到会翻第二页，最多 3 次
   （原作常被大量翻唱版本挤到第二页）。
5. **打分**（`scoreCandidate`）：
   歌名 0.45 / 歌手 0.22 / 时长 0.13 / 专辑 0.08 / 版本一致性 0.12。
   标题会拆出所有可能写法（去括号、去修饰词、拆「A - B」两侧），两两取最高相似度。
   版本一致性用来区分原版与 Live / DJ / 翻唱。
6. **去重**：
   - 同平台同 id 只留一条；
   - 内容相同（标题 + 歌手 + 时长）合并成一条，得分最高的当主来源，其余进 `alternates`；
   - 不同插件返回同一份结果时（检索词与页码相同、id 指纹相同），后面的插件直接跳过。
7. **交错排列**：按平台交错，避免单个插件把列表刷屏。最多保留 60 个候选。
8. **验证**：最多检查前 16 个候选，并发 4 个，调 `getLyric` 看能不能取到非空歌词
   （插件常用 `[00:00.00]暂无歌词` 占位，`isEmptyLyricSource` 会识别出来）。
   得分高但取不到歌词的候选会被降到后面。
9. **关联**：`linkLyric` → `src/renderer/core/link-lyric`（LRU 缓存，
   支持把两首歌关联起来共享歌词、翻译歌词）。

### 可调整的点

- 检索源：`getLyricSearchPlugins` 是**所有支持检索的插件**都参与，
  没有白名单。想收窄或扩大，改这里。
- 检索词：`buildSearchQueries` 的顺序与上限（当前 5 个、16 字）。
- 打分权重：`scoreCandidate` 里的五个系数。
- 验证成本：`maxLyricCheckCount = 16`、`lyricCheckConcurrency = 4`，
  验证歌词是要发请求的，这是耗时的大头。
- 风控参数：700ms 间隔、2s 重试、20s 冷却、3 次翻页。

---

## 二、完整版（可完整播放的版本）检索

- 插件方法：`getMusicAlternatives(musicItem, page?, keyword?)`
  （定义在 `src/types/plugin.d.ts`，主进程侧在 `plugin-methods.ts` 的
  `PluginMethods.getMusicAlternatives`，会做 `resetMediaItem` 归一化）
- 界面：`src/renderer/components/Modal/templates/MusicAlternatives/`（标题「完整播放版本」）
- 主进程插件协议里的配套字段：`isOriginArtist`（原唱）、`durationDelta`（与原曲时长差）

流程：

1. `useSupportedPlugin("getMusicAlternatives")` 取出所有支持的插件。
2. 并发（`Promise.allSettled`）向每个插件要第 1 页结果，合并。
3. 界面显示：标题、歌手 · 专辑、来源插件标签、「原唱」标签、「整轨」标签、时长。
4. 用户可以改关键词重新搜索（`keyword` 参数直接透传给插件）。
5. 点某条 → `applyFullVersion`：
   - 本地歌单里的同一首也替换（`MusicSheet.frontend.replaceMusicInSheet`）；
   - 播放队列里的也替换并从头播（`trackPlayer.replaceMusic`）。

现状要点：

- **完全依赖插件实现**。应用侧不自己搜，只负责调度与替换。
  没插件实现这个方法，界面上就显示「没有插件支持查找完整版本」。
- 判据由插件负责：插件应该只返回「可完整播放」的条目，
  应用侧目前只展示，不做二次校验（本次新增的自动替换会加一层时长校验）。

### 可调整的点

- 候选质量完全取决于插件的 `getMusicAlternatives` 实现。
- 想让应用自己兜底搜（比如插件不支持时用普通 `search` 找同名的更长版本），
  需要新增逻辑。

---

## 三、MV 检索

- 插件方法：`getMusicVideoCandidates(musicItem, page?, keyword?)`
- 界面：`src/renderer/components/Modal/templates/MusicVideoSearch/`（标题「搜索 MV」）
- 绑定持久化：`src/renderer/core/music-mv/index.ts` → Dexie `musicMv` 表，
  键是歌曲的 `platform@id`，值为选中的 MV 条目；挑过一次就记住，重启后依然有效。
- 播放：`Modal/templates/MVPlayer` → 插件的 `getVideoSource` 取视频轨，
  `getMediaSource` 取音轨（B 站 DASH 把音视频拆开，播放器用 audio 元素，必须给音轨）。

B 站插件内部的检索策略（`plugins/bilibili-mv.js`）：

1. **检索词**：
   - 用户自定义词优先；
   - 否则用「歌名 + 各种修饰词」的组合，并借**网易云、酷狗的官方 MV 标题**补线索
     （`collectMvHints`）——官方 MV 常常标题里既不带「MV」也不带歌手名；
   - 首屏同时搜原词和「原词 + MV」。
2. **过滤**：排除词（`EXCLUDE_WORDS` / `TITLE_EXCLUDE_WORDS` / `EXCLUDE_AUTHORS`）、
   付费与-charge 视频、时长超过上限的。
3. **排序** `scoreMv`：分区惩罚（MV 分区加分）、
   标题命中歌手名加分、「官方 / 正版 / 原版 MV / 歌词视频 / Hi-Res」加分、
   带「MV」字样加分、「完整版 / 正版」加分等。
4. **时长校验** `isFullLength(video, songDuration)`：
   画面时长 < 歌曲时长 × 0.5 → 判为片段丢弃；
   > 歌曲时长 × 4 → 判为合集丢弃。
   官方 MV 常带片头片尾，所以下限放宽到 0.5。
5. 候选条目带 `duration`（视频时长），界面上直接显示。

### 可调整的点

- 检索源：B 站是仓库里唯一的 MV 插件，`plugins/` 下只有它一个。
  要扩源就是再加实现 `getMusicVideoCandidates` 的插件。
- 时长阈值：0.5 / 4 这两个系数在插件里，是「片段 / 合集」的判据。
- 检索线索：目前借网易云与酷狗的官方 MV 标题，属于「用别人的 MV 目录当索引」的做法。

---

## 四、歌词与 MV 的时长能不能提取，用来对比歌曲时长

### MV 时长：可以，而且已经在用

MV 候选条目自带 `duration`（B 站视频时长，`toMusicItem` 里由 `parseDuration(video.duration)` 得到），
`getMusicInfo` 返回的也是它。界面上的时长标签直接读的这个字段。

插件里已经有现成的比对逻辑：`isFullLength(video, songDuration)`
用歌曲时长去卡画面时长，0.5 倍以下当片段、4 倍以上当合集。
所以「MV 时长 vs 歌曲时长」的对比**现在就在跑**，只是没暴露给用户看。

需要的话可以把它提到应用层：把「画面比歌曲短很多」标成「这是片段版 MV」，
在 MV 候选列表上给个标记。

### 歌词时长：要分两层看

**第一层：歌词来源歌曲的时长 —— 已经有了。**
`ILyric.ILyricItem` 继承自 `IMusicItem`，`duration` 字段就是这首歌的时长。
搜索歌词时插件返回的每条候选都带它。用它跟当前歌曲的时长对比，
就是「这份歌词来自哪首歌、多长」的判断，`scoreCandidate` 里的时长项（权重 0.13）已经在做这件事。

**第二层：歌词本身覆盖了多长时间 —— 能算，但没有现成字段。**
`ILyric.ILyricSource` 只有 `lrc` / `rawLrc` / `translation` / `wordLyric`，没有时长。
但 LRC 的每一行都带时间戳（`lyric-parser.ts` 里用 `/\[[\d:.]+\]/g` 提取），
**最后一个时间戳就是歌词唱到的位置**，拿它减去第一行的时间戳就是歌词的时间跨度。

这个跨度能回答一个别处问不出来的问题：**这份歌词是不是只有开头几句**。
比如当前歌曲 4 分钟，歌词时间戳只到 0:30，说明这份歌词是精简版或只匹配到片段。
反过来，如果歌词跨度约等于歌曲时长，说明这份歌词是配套的完整歌词。

要注意的坑：

- 歌词的最后一个时间戳是**最后一句唱到的时间**，比歌曲总长略短很正常
  （尾奏没歌词），所以判据应该是「歌词跨度 ≥ 歌曲时长 × 0.7」这种宽松比例，
  不能要求相等。
- 逐字歌词（`wordLyric`，增强型 LRC / YRC / QRC）的时间戳格式不同，
  但同样取最后一行的时间即可，规则一致。
- 插件返回的占位歌词（`[00:00.00]暂无歌词`）跨度是 0，
  会被这个判据直接判成「没有歌词」，与 `isEmptyLyricSource` 的判断一致。
- 歌词关联是**跨歌曲**的（`link-lyric` 允许把 A 歌的歌词关联给 B 歌），
  所以拿歌词跨度跟「当前歌曲」比，只有在没做人工关联的前提下才成立。

### 建议的用法

如果要把时长对比用起来，优先级从高到低：

1. **MV 候选标记片段版**——数据现成，插件里已经在算，提到应用层显示即可。
2. **歌词候选标记「歌词只到一半」**——需要解析 LRC 末尾时间戳，
   在 `link-lyric` 关联之前给用户一个「这份歌词只有前 XX 秒」的提示。
3. **完整版候选的时长校验**——本次新增的自动替换已经在做（要求明显更长）。
