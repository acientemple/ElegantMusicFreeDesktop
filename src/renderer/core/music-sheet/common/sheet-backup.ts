import type { IExportSheet } from "./export-util";

/**
 * 备份文件不是 MusicFree 导出的歌单格式。
 * 单独成类，UI 可以据此提示「不是有效的歌单备份文件」，
 * 而不是把解析错误混进数据库写入失败的提示里。
 */
export class InvalidSheetBackupError extends Error {
    constructor() {
        super("INVALID_SHEET_BACKUP");
        this.name = "InvalidSheetBackupError";
    }
}

/**
 * 解析「恢复歌单」用的备份 JSON（`{ musicSheets: [...] }`）。
 * 兼容带 UTF-8 BOM 的文本；结构不对一律抛 InvalidSheetBackupError，
 * 避免把 null / 异常结构带进 BackupResume 里半途静默失败。
 *
 * 本文件刻意不引入任何运行时依赖，方便 node:test 直接加载做单测
 * （export-util 里有 `@/` 别名导入，Node 解析不了）。
 */
export function parseSheetBackupJson(raw: string): IExportSheet[] {
    let data: any;
    try {
        data = JSON.parse(String(raw).replace(/^﻿/, ""));
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
