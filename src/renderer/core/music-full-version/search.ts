/**
 * 并发检索多个插件，每个插件单独兜底。
 *
 * 单独成文件是为了让 node:test 能直接加载（只依赖零依赖的 time-util）。
 *
 * 早先的写法是「所有插件一起等，整体 8 秒兜底」——
 * 只要有一个插件慢（自己写的网络请求，十几秒才回是常事），
 * 整次检索就被作废，别的插件已经搜到的结果全被丢掉，
 * 自动换完整版就时灵时不灵。现在每个插件各自兜底，慢的按「没搜到」处理，
 * 不影响其它插件的结果。
 */

import { delay } from "../../../common/time-util.ts";

export interface ISearchOutcome<T> {
    /** 这个插件是不是超时了（一直没返回） */
    timedOut: boolean;
    /** 这个插件是不是报错了 */
    failed: boolean;
    /** 拿到的结果 */
    data: T[];
}

/**
 * 并发执行所有检索，每个插件单独超时。
 *
 * @param requests 每个插件的检索动作
 * @param timeoutMs 单个插件的最长等待时间
 */
export async function searchWithPerPluginTimeout<T>(
    requests: Array<() => Promise<{ data?: T[] | null } | null | undefined>>,
    timeoutMs: number,
): Promise<ISearchOutcome<T>[]> {
    return Promise.all(
        requests.map(async (request): Promise<ISearchOutcome<T>> => {
            try {
                const result = await Promise.race([
                    request().then((data) => ({ kind: "data" as const, data })),
                    delay(timeoutMs).then(() => ({ kind: "timeout" as const })),
                ]);
                if (result.kind === "timeout") {
                    return { timedOut: true, failed: false, data: [] };
                }
                return {
                    timedOut: false,
                    failed: false,
                    data: (result.data?.data ?? []) as T[],
                };
            } catch {
                // 插件报错（多半是网络问题）
                return { timedOut: false, failed: true, data: [] };
            }
        }),
    );
}

/**
 * 这次检索算不算「查完了」。
 *
 * 只有每个插件都给出了结果（响应或报错）才算查完 ——
 * 有插件超时时这次检索并不完整，下次还得再试，
 * 不能因为一次运气不好就把这首歌记成「没有完整版」。
 */
export function isSearchConclusive(outcomes: ISearchOutcome<any>[]): boolean {
    if (outcomes.some((it) => it.timedOut)) {
        return false;
    }
    const anyResponded = outcomes.some((it) => !it.timedOut && !it.failed);
    const anyFailed = outcomes.some((it) => it.failed);
    // 所有插件都报错 → 这次什么都没查出来，不算查完
    return anyResponded || !anyFailed;
}
