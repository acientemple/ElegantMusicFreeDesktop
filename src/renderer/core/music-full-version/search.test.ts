import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isSearchConclusive,
    searchWithPerPluginTimeout,
} from "./search.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("一个插件挂住，其它插件的结果照样能用", async () => {
    const outcomes = await searchWithPerPluginTimeout<{ id: string }>(
        [
            () => Promise.resolve({ data: [{ id: "fast" }] }),
            // 永远不返回的插件
            () => new Promise(() => {}),
            () => Promise.resolve({ data: [{ id: "also-fast" }] }),
        ],
        120,
    );

    // 挂住的那个按「没搜到」处理
    assert.equal(outcomes[1].timedOut, true);
    assert.equal(outcomes[1].data.length, 0);
    // 其它插件的结果没被牵连
    assert.equal(outcomes[0].data.length, 1);
    assert.equal(outcomes[0].data[0].id, "fast");
    assert.equal(outcomes[2].data[0].id, "also-fast");
});

test("插件报错不影响其它插件", async () => {
    const outcomes = await searchWithPerPluginTimeout<{ id: string }>(
        [
            () => Promise.reject(new Error("network down")),
            () => Promise.resolve({ data: [{ id: "ok" }] }),
        ],
        200,
    );
    assert.equal(outcomes[0].failed, true);
    assert.equal(outcomes[1].data[0].id, "ok");
});

test("插件返回空结果不算报错", async () => {
    const outcomes = await searchWithPerPluginTimeout<{ id: string }>(
        [() => Promise.resolve({ data: [] }), () => Promise.resolve(null)],
        200,
    );
    assert.equal(outcomes[0].failed, false);
    assert.equal(outcomes[0].timedOut, false);
    assert.equal(outcomes[0].data.length, 0);
    assert.equal(outcomes[1].data.length, 0);
});

test("有插件超时时，这次检索不算查完", async () => {
    const outcomes = await searchWithPerPluginTimeout<{ id: string }>(
        [() => Promise.resolve({ data: [] }), () => new Promise(() => {})],
        120,
    );
    assert.equal(isSearchConclusive(outcomes), false);
});

test("全部插件都报错时，这次检索不算查完", async () => {
    const outcomes = await searchWithPerPluginTimeout<{ id: string }>(
        [() => Promise.reject(new Error("a")), () => Promise.reject(new Error("b"))],
        200,
    );
    assert.equal(isSearchConclusive(outcomes), false);
});

test("都正常返回时，这次检索算查完了", async () => {
    const outcomes = await searchWithPerPluginTimeout<{ id: string }>(
        [() => Promise.resolve({ data: [] }), () => Promise.reject(new Error("b"))],
        200,
    );
    assert.equal(isSearchConclusive(outcomes), true);
});

test("慢但没超时的插件结果能拿到", async () => {
    const started = Date.now();
    const outcomes = await searchWithPerPluginTimeout<{ id: string }>(
        [
            () =>
                new Promise((resolve) =>
                    setTimeout(() => resolve({ data: [{ id: "slow" }] }), 60),
                ),
        ],
        500,
    );
    assert.equal(outcomes[0].timedOut, false);
    assert.equal(outcomes[0].data[0].id, "slow");
    assert.ok(Date.now() - started < 500);
    await sleep(0);
});
