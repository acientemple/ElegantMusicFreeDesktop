/**
 * 时长处理的纯函数。
 *
 * 插件给的时长并不总是可靠的 —— 有的用毫秒当秒返回，有的干脆不返回。
 * 这里的归一化规则被播放时长校正、完整版判定等几处共用，
 * 单独成文件是为了让 node:test 能直接加载（不依赖 Electron 与浏览器全局）。
 */

/** 超过这个秒数（3 小时）基本可以断定是把毫秒当成秒了 */
export const MAX_PLAUSIBLE_DURATION = 3 * 60 * 60;

/**
 * 把插件给的时长归一化成秒。
 * 毫秒写成了秒的情况很常见（数值大得离谱），这里一并纠正。
 *
 * @returns 归一化后的秒数；拿不到有效时长时返回 undefined
 */
export function normalizeDuration(duration?: number | null): number | undefined {
    if (typeof duration !== "number" || !isFinite(duration) || duration <= 0) {
        return undefined;
    }
    if (duration > MAX_PLAUSIBLE_DURATION) {
        const asMs = duration / 1000;
        if (asMs > 0 && asMs <= MAX_PLAUSIBLE_DURATION) {
            return Math.round(asMs);
        }
        return undefined;
    }
    return Math.round(duration);
}
