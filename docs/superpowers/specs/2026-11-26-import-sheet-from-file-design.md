# 我的歌单：从文件导入歌单设计

日期：2026-11-26
状态：待用户确认

## 目标

在侧边栏「我的歌单」标题栏加一个「从文件导入歌单」按钮，读取
`MusicFree-*-日期.json`（应用自己的导出格式），恢复成新的歌单。

非目标：不改插件版「导入歌单」（按平台链接导入）；不做「导入到当前选中的歌单」；
不解析第三方歌单格式；不改设置页已有的备份/恢复。

## 为什么

导出写的是 `{ musicSheets: [...] }`（`export-util.ts` 的 `buildSheetBackupJson`），
单歌单、全部歌单都是这个结构。设置 → 备份 →「恢复歌单」已经能读这个结构，
但入口藏在设置里；侧边栏那个「导入歌单」按钮走的是插件 `importMusicSheet`，
只能按平台链接抓歌单，读不了本地导出文件，用户容易误以为不支持。

## 方案（已与用户确认）

- **同名一律新建**（方案 A）：导入的每个歌单都作为新歌单追加，允许重名；
  「我喜欢」按 `BackupResume.resume` 现有逻辑并入收藏，不新建同名副本。
- **入口**：侧边栏标题栏，导出按钮旁加 `folder-open` 图标按钮。
- 强制按 **追加模式** 导入（`overwrite=false`），不受设置项
  `backup.resumeBehavior` 影响，导入永远不会覆盖/清空现有歌单。

### 改动

1. 新增 `src/renderer/core/music-sheet/common/sheet-backup.ts`（实施时确定）：
   导出纯函数 `parseSheetBackupJson(raw: string): IExportSheet[]`，
   `JSON.parse` 后校验 `musicSheets` 是数组、每项是对象、`musicList` 为数组或缺失，
   否则抛 `InvalidSheetBackupError`。单独成文件是为了让 `node:test` 能直接加载
   （`export-util.ts` 有 `@/` 别名运行时导入，Node 解析不了）；
   `export-util.ts` 只把 `IExportSheet` 导出供其引用。
2. `src/renderer/pages/main-page/components/SideBar/widgets/MySheets/index.tsx`：
   - 标题栏加导入按钮，调用 `showOpenDialog`（`json` 过滤器）→ `fsUtil.readFile` →
     `parseSheetBackupJson` → `BackupResume.resume({ musicSheets }, false)`；
   - 成功/失败/格式错误分别 toast；
   - 取消选择、空文件不提示。
3. 三语文案（`res/lang/zh-CN.json`、`en-US.json`、`zh-TW.json` 的 `side_bar`）：
   `import_sheet_from_file`、`import_sheet_success`、`import_sheet_fail`、
   `import_sheet_invalid`、`import_sheet_empty`。
4. 新增 `src/renderer/core/music-sheet/common/sheet-backup.test.ts`：
   覆盖合法单歌单/多歌单、坏 JSON、缺 `musicSheets`、`musicSheets` 非数组、
   项为 null、`musicList` 非数组、BOM、导出包络往返。

## 取舍与已知限制

- 重复导入同一个文件会产生同名歌单副本（方案 A 的代价）。
- `BackupResume.resume` 内部已有失效歌曲剔除（`validMusicList`），解析层不重复做。
- 打包版无热重载，改完需重新 `npm run package` 并覆盖便携版。
- 导入不校验歌曲是否仍能播放，只恢复元数据；和设置页恢复行为一致。
