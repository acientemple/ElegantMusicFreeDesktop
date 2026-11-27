import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isFullVersionCandidate,
    isPreviewDuration,
    isPreviewItem,
    isSameSong,
    pickFullVersion,
    pickSheetIdsWithSong,
    PREVIEW_MAX_DURATION,
} from "./pure.ts";

test("一分钟以内算片段，一分钟以上不算", () => {
    assert.equal(isPreviewDuration(30), true);
    assert.equal(isPreviewDuration(PREVIEW_MAX_DURATION), true);
    assert.equal(isPreviewDuration(PREVIEW_MAX_DURATION + 1), false);
    assert.equal(isPreviewDuration(240), false);
});

test("时长未知不判定成片段", () => {
    assert.equal(isPreviewDuration(undefined), false);
    assert.equal(isPreviewDuration(null), false);
    assert.equal(isPreviewDuration(0), false);
    assert.equal(isPreviewDuration(-1), false);
});

test("把毫秒当成秒返回的时长会被纠正", () => {
    // 30000 其实是 30 秒，是片段
    assert.equal(isPreviewDuration(30000), true);
    // 240000 其实是 240 秒，是整首
    assert.equal(isPreviewDuration(240000), false);
});

test("同一首歌的判定看平台与 id", () => {
    assert.equal(
        isSameSong({ platform: "a", id: "1" }, { platform: "a", id: "1" }),
        true,
    );
    assert.equal(
        isSameSong({ platform: "a", id: "1" }, { platform: "b", id: "1" }),
        false,
    );
    assert.equal(isSameSong(null, { platform: "a", id: "1" }), false);
});

test("候选得是明显更长的版本", () => {
    const original = { platform: "p", id: "1", duration: 60 };
    // 明显更长
    assert.equal(
        isFullVersionCandidate(original, {
            platform: "p",
            id: "2",
            duration: 240,
        }),
        true,
    );
    // 只是长了一点点，不算
    assert.equal(
        isFullVersionCandidate(original, {
            platform: "p",
            id: "3",
            duration: 100,
        }),
        false,
    );
    // 还是片段
    assert.equal(
        isFullVersionCandidate(original, {
            platform: "p",
            id: "4",
            duration: 45,
        }),
        false,
    );
    // 没有时长，判断不了
    assert.equal(
        isFullVersionCandidate(original, { platform: "p", id: "5" }),
        false,
    );
    // 它自己
    assert.equal(
        isFullVersionCandidate(original, {
            platform: "p",
            id: "1",
            duration: 240,
        }),
        false,
    );
});

test("原曲时长未知时，两分钟以上就算完整版", () => {
    assert.equal(
        isFullVersionCandidate(
            { platform: "p", id: "1" },
            { platform: "p", id: "2", duration: 150 },
        ),
        true,
    );
    assert.equal(
        isFullVersionCandidate(
            { platform: "p", id: "1" },
            { platform: "p", id: "2", duration: 100 },
        ),
        false,
    );
});

test("挑完整版时原唱优先", () => {
    const picked = pickFullVersion(
        { platform: "p", id: "1", duration: 30 },
        [
            { platform: "q", id: "2", duration: 300 },
            {
                platform: "r",
                id: "3",
                duration: 240,
                isOriginArtist: true,
            },
        ],
    );
    assert.equal(picked?.id, "3");
});

test("同样不是原唱时选时长长的", () => {
    const picked = pickFullVersion(
        { platform: "p", id: "1", duration: 30 },
        [
            { platform: "q", id: "2", duration: 200 },
            { platform: "r", id: "3", duration: 320 },
        ],
    );
    assert.equal(picked?.id, "3");
});

test("没有合格的候选就返回 null", () => {
    assert.equal(
        pickFullVersion({ platform: "p", id: "1", duration: 30 }, []),
        null,
    );
    assert.equal(
        pickFullVersion({ platform: "p", id: "1", duration: 30 }, [
            { platform: "q", id: "2", duration: 20 },
        ]),
        null,
    );
});

test("换完整版要覆盖所有包含这首歌的歌单", () => {
    const song = { platform: "wy", id: "123" };
    const sheets = [
        { id: "favorite", musicList: [{ platform: "wy", id: "123" }] },
        { id: "sheet-a", musicList: [{ platform: "wy", id: "999" }] },
        {
            id: "sheet-b",
            musicList: [
                { platform: "wy", id: "123" },
                { platform: "qq", id: "456" },
            ],
        },
        { id: "sheet-c" },
    ];
    // sheet-a 里没有这首歌，不该被改；sheet-c 没有 musicList 也不能炸
    assert.deepStrictEqual(pickSheetIdsWithSong(sheets, song), [
        "favorite",
        "sheet-b",
    ]);
});

test("没有歌单、没有原曲时都不出错", () => {
    assert.deepStrictEqual(pickSheetIdsWithSong([], { platform: "a", id: "1" }), []);
    assert.deepStrictEqual(pickSheetIdsWithSong(null, null), []);
    assert.deepStrictEqual(
        pickSheetIdsWithSong([{ id: "x", musicList: [] }], null),
        [],
    );
});

test("声明时长短就是片段", () => {
    assert.equal(isPreviewItem(30), true);
    assert.equal(isPreviewItem(PREVIEW_MAX_DURATION), true);
    assert.equal(isPreviewItem(275), false);
    assert.equal(isPreviewItem(undefined), false);
    assert.equal(isPreviewItem(null), false);
});

test("声明的是完整时长、实际只有几十秒，也是片段", () => {
    // 最常见的试听片段：条目上写着 4:35，实际音频只有 30 秒
    assert.equal(isPreviewItem(275, 30), true);
    assert.equal(isPreviewItem(275, 45), true);
    assert.equal(isPreviewItem(275, 60), true);
    // 实测不短就不是片段
    assert.equal(isPreviewItem(275, 61), false);
    assert.equal(isPreviewItem(275, 275), false);
    // 声明短、实测未知，也算片段
    assert.equal(isPreviewItem(30, undefined), true);
    // 两个都不知道，判断不了，不判定
    assert.equal(isPreviewItem(undefined, undefined), false);
});
