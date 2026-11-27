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
 * 歌单里可能只存着条目的引用（platform + id），够用来判断是不是同一首。
 */
export interface ISheetRef {
    id: string;
    musicList?: IVersionItem[] | null;
}

/**
 * 找出所有包含这首歌的歌单。
 *
 * 换完整版时要覆盖**所有**含这首歌的歌单：用户在哪个列表里看，
 * 都应该是替换后的版本，而不是只有当前打开的那一张被换掉。
 */
export function pickSheetIdsWithSong(
    sheets: ISheetRef[] | null | undefined,
    original: IVersionItem | null | undefined,
): string[] {
    if (!original) {
        return [];
    }
    return (sheets ?? [])
        .filter((sheet) =>
            (sheet.musicList ?? []).some((it) => isSameSong(it, original)),
        )
        .map((sheet) => sheet.id);
}

/**
 * 这个条目是不是短到只可能是试听片段。
 *
 * 两个来源都算：
 * - 插件声明的时长（条目上直接写着 30 秒）
 * - 实际播出来的音频长度（声明 4:35、实际只有 30 秒 —— 最常见的试听片段）
 *
 * 实测优先：只要实际长度短就是片段，不管声明写得多长。
 */
export function isPreviewItem(
    declaredDuration?: number | null,
    measuredDuration?: number | null,
): boolean {
    return (
        isPreviewDuration(declaredDuration) ||
        isPreviewDuration(measuredDuration)
    );
}

/**
 * 候选够不够格算完整版：
 * - 不能是它自己
 * - 必须有时长，否则判断不了
 * - 不能仍然是片段
 * - 必须明显比原曲长
 *
 * @param baseDuration 判定基准时长。原曲是「声明 4:35、实测 30 秒」的片段时，
 *   基准必须用实测的 30 秒而不是声明的 4:35 ——
 *   否则真正的完整版（4:35）会因为「没比 4:35 长 60 秒」被误判掉。
 */
export function isFullVersionCandidate(
    original: IVersionItem | null | undefined,
    candidate: IVersionItem | null | undefined,
    baseDuration?: number | null,
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
    const originalDuration =
        normalizeDuration(baseDuration) ?? normalizeDuration(original?.duration) ?? 0;
    const required = Math.max(
        originalDuration + MIN_EXTRA_SECONDS,
        MIN_FULL_DURATION,
    );
    return duration >= required;
}

/**
 * 从候选里挑一个最好的完整版。
 * 原唱优先，其次时长长的优先。
 *
 * @param baseDuration 判定基准时长，见 isFullVersionCandidate 的说明
 */
export function pickFullVersion<T extends IVersionItem>(
    original: IVersionItem | null | undefined,
    candidates: T[],
    baseDuration?: number | null,
): T | null {
    const valid = (candidates ?? []).filter((it) =>
        isFullVersionCandidate(original, it, baseDuration),
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
