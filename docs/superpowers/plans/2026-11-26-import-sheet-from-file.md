# 我的歌单：从文件导入歌单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「我的歌单」侧边栏加一个按钮，从应用自己导出的 JSON 备份文件恢复歌单（一律新建，追加模式）。

**Architecture:** 解析/校验抽成 `export-util.ts` 里的纯函数（可单测），UI 只负责选文件、调 `BackupResume.resume(..., false)`、toast 文案；复用已有的 `BackupResume` 恢复逻辑，不碰数据库层。

**Tech Stack:** Electron + React + TypeScript；`node:test` + `node:assert/strict` 单测（Node 25 原生剥离类型）；i18n 为 `res/lang/*.json`。

**Spec:** `docs/superpowers/specs/2026-11-26-import-sheet-from-file-design.md`

## Global Constraints

- 文案必须同时补 `res/lang/zh-CN.json`、`en-US.json`、`zh-TW.json` 三份。
- 导入强制追加（`resume(..., false)`），不受 `backup.resumeBehavior` 配置影响，绝不覆盖/清空现有歌单。
- 不新增依赖；不修改 `portable/userData` 下任何内容。
- 打包部署时 robocopy 不带 `/MIR`。
- 代码改动全部在源码仓库 `D:\work\projects\MusicFreeDesktop`，不是便携版目录。

## Review Focus

- 带 UTF-8 BOM 的 JSON 文件：应正常导入，而不是报格式错误。（Task 1 单测）
- 坏 JSON、缺 `musicSheets`、`musicSheets` 非数组、`musicList` 非数组、数组里有 null：应抛 `InvalidSheetBackupError` 并提示「不是有效的歌单备份文件」。（Task 1 单测 + Task 2 分支）
- `musicSheets` 为空数组：不创建空歌单，提示「文件里没有歌单」。（Task 3 手工验证）
- 取消选择文件：无 toast、无任何副作用。（Task 3 手工验证）
- 重复导入同一文件 / 同名歌单：产生同名副本，不合并、不覆盖。（Task 3 手工验证）
- 数据库写入失败：走通用失败 toast 并带上原因，而不是静默。（Task 2 catch 分支）

---

### Task 1: 备份文件解析函数 + 单测

**Files:**
- Modify: `src/renderer/core/music-sheet/common/export-util.ts`
- Create: `src/renderer/core/music-sheet/common/export-util.test.ts`

**Interfaces:**
- Consumes: 现有 `buildSheetBackupJson(sheets)` / `IExportSheet`（同文件）。
- Produces:
  - `export class InvalidSheetBackupError extends Error` —— `name` 为 `"InvalidSheetBackupError"`。
  - `export function parseSheetBackupJson(raw: string): IExportSheet[]` —— 校验失败一律抛 `InvalidSheetBackupError`。

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/core/music-sheet/common/export-util.test.ts`：

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildSheetBackupJson,
    parseSheetBackupJson,
    InvalidSheetBackupError,
} from "./export-util.ts";

test("解析单歌单导出文件", () => {
    const raw = JSON.stringify({
        musicSheets: [{ title: "单张", musicList: [] }],
    });
    assert.deepEqual(parseSheetBackupJson(raw), [
        { title: "单张", musicList: [] },
    ]);
});

test("解析全部歌单导出文件", () => {
    const raw = JSON.stringify({
        musicSheets: [
            { title: "A", musicList: [] },
            { title: "B", musicList: [] },
        ],
    });
    assert.equal(parseSheetBackupJson(raw).length, 2);
});

test("空歌单列表原样返回空数组", () => {
    assert.deepEqual(parseSheetBackupJson('{"musicSheets":[]}'), []);
});

test("带 UTF-8 BOM 的文件可以解析", () => {
    const raw = "\uFEFF" + JSON.stringify({
        musicSheets: [{ title: "BOM", musicList: [] }],
    });
    assert.equal(parseSheetBackupJson(raw)[0].title, "BOM");
});

test("坏 JSON 抛 InvalidSheetBackupError", () => {
    assert.throws(
        () => parseSheetBackupJson("not json"),
        InvalidSheetBackupError,
    );
});

test("缺少 musicSheets 抛 InvalidSheetBackupError", () => {
    assert.throws(() => parseSheetBackupJson("{}"), InvalidSheetBackupError);
});

test("musicSheets 不是数组抛 InvalidSheetBackupError", () => {
    assert.throws(
        () => parseSheetBackupJson('{"musicSheets":{}}'),
        InvalidSheetBackupError,
    );
});

test("musicSheets 里有 null 抛 InvalidSheetBackupError", () => {
    assert.throws(
        () => parseSheetBackupJson('{"musicSheets":[null]}'),
        InvalidSheetBackupError,
    );
});

test("musicList 不是数组抛 InvalidSheetBackupError", () => {
    assert.throws(
        () => parseSheetBackupJson('{"musicSheets":[{"title":"x","musicList":{}}]}'),
        InvalidSheetBackupError,
    );
});

test("导出内容可以原样解析回来", () => {
    const sheets = [
        {
            title: "往返",
            musicList: [{ platform: "local", id: "1", title: "歌" }],
        },
    ];
    assert.deepEqual(
        parseSheetBackupJson(buildSheetBackupJson(sheets)),
        sheets,
    );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --no-warnings=MODULE_TYPELESS_PACKAGE_JSON src/renderer/core/music-sheet/common/export-util.test.ts`
Expected: FAIL —— 报 `parseSheetBackupJson` / `InvalidSheetBackupError` 未导出。

- [ ] **Step 3: 实现解析函数**

在 `export-util.ts` 末尾追加（`IExportSheet` 保持私有；`parseSheetBackupJson` 返回它）：

```ts
/** 不是 MusicFree 歌单备份文件 */
export class InvalidSheetBackupError extends Error {
    constructor() {
        super("INVALID_SHEET_BACKUP");
        this.name = "InvalidSheetBackupError";
    }
}

/**
 * 解析「恢复歌单」用的备份 JSON。
 * 兼容带 BOM 的文本；结构不对一律抛 InvalidSheetBackupError，
 * 避免把 null/异常结构带进 BackupResume 里半途静默失败。
 */
export function parseSheetBackupJson(raw: string): IExportSheet[] {
    let data: any;
    try {
        data = JSON.parse(String(raw).replace(/^\uFEFF/, ""));
    } catch {
        throw new InvalidSheetBackupError();
    }
    const sheets = data?.musicSheets;
    if (!Array.isArray(sheets)) {
        throw new InvalidSheetBackupError();
    }
    for (const sheet of sheets) {
        if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) {
            throw new InvalidSheetBackupError();
        }
        if (sheet.musicList != null && !Array.isArray(sheet.musicList)) {
            throw new InvalidSheetBackupError();
        }
    }
    return sheets;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --no-warnings=MODULE_TYPELESS_PACKAGE_JSON src/renderer/core/music-sheet/common/export-util.test.ts`
Expected: 10 个 test 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/core/music-sheet/common/export-util.ts src/renderer/core/music-sheet/common/export-util.test.ts
git commit -m "feat: add playlist backup JSON parser with validation"
```

---

### Task 2: 侧边栏导入按钮 + 三语文案

**Files:**
- Modify: `src/renderer/pages/main-page/components/SideBar/widgets/MySheets/index.tsx`
- Modify: `res/lang/zh-CN.json`（`side_bar` 段，约 148-160 行）
- Modify: `res/lang/en-US.json`（`side_bar` 段，约 142-160 行）
- Modify: `res/lang/zh-TW.json`（`side_bar` 段，约 142-160 行）

**Interfaces:**
- Consumes: Task 1 的 `parseSheetBackupJson` / `InvalidSheetBackupError`；现有 `BackupResume.resume(data, overwrite?)`（`@/renderer/core/backup-resume`）；现有 `dialogUtil` / `fsUtil`（`@shared/utils/renderer`）。
- Produces: `side_bar` 下 5 个新文案键，供其它页面复用。

- [ ] **Step 1: 补三语文案**

在三个语言文件 `side_bar` 段里 `"export_sheet_not_found"` 之后追加：

zh-CN：

```json
"import_sheet_from_file": "从文件导入歌单",
"import_sheet_success": "导入成功",
"import_sheet_fail": "导入失败：{{reason}}",
"import_sheet_invalid": "不是有效的歌单备份文件",
"import_sheet_empty": "文件里没有歌单",
```

en-US：

```json
"import_sheet_from_file": "Import Playlists from File",
"import_sheet_success": "Imported successfully",
"import_sheet_fail": "Import failed: {{reason}}",
"import_sheet_invalid": "Not a valid playlist backup file",
"import_sheet_empty": "No playlists in this file",
```

zh-TW：

```json
"import_sheet_from_file": "從檔案匯入歌單",
"import_sheet_success": "匯入成功",
"import_sheet_fail": "匯入失敗：{{reason}}",
"import_sheet_invalid": "不是有效的歌單備份檔案",
"import_sheet_empty": "檔案裡沒有歌單",
```

注意上一条 `"export_sheet_not_found"` 行末要补逗号，保持 JSON 合法。

- [ ] **Step 2: 在 `MySheets/index.tsx` 加导入逻辑**

在 import 区追加：

```ts
import BackupResume from "@/renderer/core/backup-resume";
import {
    InvalidSheetBackupError,
    parseSheetBackupJson,
} from "@/renderer/core/music-sheet/common/export-util";
```

在 `onExportAllSheets` 之后加处理函数（与现有导出函数同一层）：

```ts
async function onImportSheets() {
    const result = await dialogUtil.showOpenDialog({
        properties: ["openFile"],
        filters: [
            {
                name: "MusicFree",
                extensions: ["json"],
            },
        ],
        title: t("side_bar.import_sheet_from_file"),
    });
    if (result.canceled || !result.filePaths?.length) {
        return;
    }
    try {
        const raw = (await fsUtil.readFile(
            result.filePaths[0],
            "utf-8",
        )) as string;
        const sheets = parseSheetBackupJson(raw);
        if (!sheets.length) {
            toast.error(t("side_bar.import_sheet_empty"));
            return;
        }
        // 强制追加：侧边栏导入永远不覆盖已有歌单
        await BackupResume.resume({ musicSheets: sheets }, false);
        toast.success(t("side_bar.import_sheet_success"));
    } catch (e) {
        if (e instanceof InvalidSheetBackupError) {
            toast.error(t("side_bar.import_sheet_invalid"));
            return;
        }
        toast.error(
            t("side_bar.import_sheet_fail", {
                reason: e?.message ?? "",
            }),
        );
    }
}
```

在标题栏里、插件导入按钮与导出按钮之间插入：

```tsx
<div
    role="button"
    className="option-btn"
    title={t("side_bar.import_sheet_from_file")}
    onClick={(e) => {
        e.stopPropagation();
        onImportSheets();
    }}
>
    <SvgAsset iconName="folder-open"></SvgAsset>
</div>
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出（通过）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/pages/main-page/components/SideBar/widgets/MySheets/index.tsx res/lang/zh-CN.json res/lang/en-US.json res/lang/zh-TW.json
git commit -m "feat: import playlists from exported JSON file in sidebar"
```

---

### Task 3: 全量验证、打包覆盖便携版、手工冒烟

**Files:**
- 无源码改动；产物部署到 `D:\work\OneDrive\Desktop\projects\MusicFree`

**Interfaces:**
- Consumes: Task 1/2 的改动。

- [ ] **Step 1: 跑全量单测**

Run: `npm test`
Expected: 全部 PASS（含新增 10 个）。

- [ ] **Step 2: 再跑类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 3: 打包并覆盖便携版**

先让用户关掉正在运行的 `MusicFree.exe`，然后：

```bash
npm run package
robocopy out\MusicFree-win32-x64 "D:\work\OneDrive\Desktop\projects\MusicFree" /E /R:1 /W:1 /NFL /NDL
```

不要加 `/MIR`。

- [ ] **Step 4: 手工冒烟（四条）**

打开应用，进入「我的歌单」：

1. 先「导出全部歌单」，再从新按钮导入同一文件 → 出现同名副本，原歌单不变，toast「导入成功」。
2. 右键单个歌单导出，再导入该文件 → 新建一张同名歌单，歌曲数量与原歌单一致。
3. 选一个非 JSON / 改坏的文件 → toast「不是有效的歌单备份文件」。
4. 打开选择框后直接取消 → 无 toast、歌单无变化。

- [ ] **Step 5: 提交设计/计划文档（如尚未提交）**

```bash
git add docs/superpowers/specs/2026-11-26-import-sheet-from-file-design.md docs/superpowers/plans/2026-11-26-import-sheet-from-file.md
git commit -m "docs: add playlist import design and plan"
```
