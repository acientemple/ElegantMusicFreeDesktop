import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseSheetBackupJson,
    InvalidSheetBackupError,
} from "./sheet-backup.ts";

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
    const raw = "﻿" + JSON.stringify({
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

test("导出器使用的包络结构可以解析回来", () => {
    const sheets = [
        {
            title: "往返",
            musicList: [{ platform: "local", id: "1", title: "歌" }],
        },
    ];
    assert.deepEqual(
        parseSheetBackupJson(JSON.stringify({ musicSheets: sheets })),
        sheets,
    );
});
