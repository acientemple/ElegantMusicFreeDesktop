/**
 * 自动换完整版的纯逻辑。
 *
 * 单独成文件是为了让 node:test 能直接加载：
 * 只依赖 @/common/duration-util.ts（同样零运行时依赖），不碰 Electron 与浏览器全局。
 */

import { normalizeDuration } from "../../../common/duration-util.ts";

/** 试听片段的时长上限（秒）。插件给的试听链接一般只有 30~60 秒 */
export const PREVIEW_MAX_DURATION = 60;

/** 完整版至少要比原曲长这么多秒，才算「明显是完整版」 */
export const MIN_EXTRA_SECONDS = 60;

/** 完整版的时长下限（秒）。两分钟以内的更可能是短曲，而不是完整版 */
export const MIN_FULL_DURATION = 120;

/** 判定时用到的最小信息集 */
export interface IVersionItem {
    platform?: string | null;
    id?: string | null;
    /** 单位：秒 */
    duration?: number | null;
    /** 是不是原唱 */
    isOriginArtist?: boolean | null;
}

/**
 * 是不是同一首歌。
 * 与 @/common/media-util 的 isSameMedia 语义一致，这里单独写一份是为了让本文件保持零依赖。
 */
export function isSameSong(
    a?: IVersionItem | null,
    b?: IVersionItem | null,
): boolean {
    if (!a || !b) {
        return false;
    }
    return a.id === b.id && a.platform === b.platform;
}

/**
 * 这个时长是不是短到只可能是试听片段。
 * 时长未知一律返回 false —— 不知道长短就不该触发检索。
 */
export function isPreviewDuration(duration?: number | null): boolean {
    const normalized = normalizeDuration(duration);
    if (normalized === undefined) {
        return false;
    }
    return normalized <= PREVIEW_MAX_DURATION;
}

/**
 * 候选够不够格算完整版：
 * - 不能是它自己
 * - 必须有时长，否则判断不了
 * - 不能仍然是片段
 * - 必须明显比原曲长
 */
export function isFullVersionCandidate(
    original: IVersionItem | null | undefined,
    candidate: IVersionItem | null | undefined,
): boolean {
    if (!candidate || isSameSong(original, candidate)) {
        return false;
    }
    const duration = normalizeDuration(candidate.duration);
    if (duration === undefined) {
        return false;
    }
    if (duration <= PREVIEW_MAX_DURATION) {
        return false;
    }
    const originalDuration = normalizeDuration(original?.duration) ?? 0;
    const required = Math.max(
        originalDuration + MIN_EXTRA_SECONDS,
        MIN_FULL_DURATION,
    );
    return duration >= required;
}

/**
 * 从候选里挑一个最好的完整版。
 * 原唱优先，其次时长长的优先。
 */
export function pickFullVersion<T extends IVersionItem>(
    original: IVersionItem | null | undefined,
    candidates: T[],
): T | null {
    const valid = (candidates ?? []).filter((it) =>
        isFullVersionCandidate(original, it),
    );
    if (!valid.length) {
        return null;
    }
    valid.sort((a, b) => {
        const aOrigin = a.isOriginArtist ? 1 : 0;
        const bOrigin = b.isOriginArtist ? 1 : 0;
        if (aOrigin !== bOrigin) {
            return bOrigin - aOrigin;
        }
        return (
            (normalizeDuration(b.duration) ?? 0) -
            (normalizeDuration(a.duration) ?? 0)
        );
    });
    return valid[0] ?? null;
}
