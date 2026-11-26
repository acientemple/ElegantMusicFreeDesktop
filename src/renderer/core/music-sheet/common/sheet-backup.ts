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
 * 序列化备份文件内容（`{ musicSheets: [...] }`）。
 * 导出器 `buildSheetBackupJson` 在清洗完歌单后调用这里，
 * 保证「写文件」和「读文件」用的是同一份包络定义，单测可以真实往返。
 */
export function serializeSheetBackup(sheets: IExportSheet[]): string {
    return JSON.stringify({ musicSheets: sheets });
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
    const text = String(raw);
    // 用码点判断并去掉开头的 UTF-8 BOM，避免源码里出现不可见字符
    const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    try {
        data = JSON.parse(content);
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
