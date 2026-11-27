import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isFullVersionCandidate,
    isPreviewDuration,
    isSameSong,
    pickFullVersion,
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
