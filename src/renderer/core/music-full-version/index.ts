/**
 * 播放时自动换成完整版：
 *
 * 插件返回的条目有时是试听片段（各平台的试听链接通常只有 30~60 秒），
 * 播完就没了。应用里已经有「完整播放版本」弹窗能手动换，
 * 这里是把它接到播放链路上：播放前先看时长是不是短到只可能是片段，
 * 是的话找同一首歌的完整版本替换掉再播。
 *
 * 完整版的来源是插件的 `getMusicAlternatives` 方法 ——
 * 跟手动弹窗用的是同一套机制，应用侧只负责调度与挑选。
 */

import { getMediaPrimaryKey } from "@/common/media-util";
import { normalizeDuration } from "@/common/duration-util";
import MusicSheet from "@renderer/core/music-sheet";
import { getVerifiedDuration } from "@renderer/core/music-duration";
import PluginManager from "@shared/plugin-manager/renderer";
import {
    isSearchConclusive,
    searchWithPerPluginTimeout,
} from "./search.ts";
import {
    isPreviewDuration,
    isPreviewItem,
    pickFullVersion,
    pickSheetIdsWithSong,
    PREVIEW_MAX_DURATION,
} from "./pure.ts";

export { PREVIEW_MAX_DURATION, pickFullVersion, isPreviewDuration, isPreviewItem };

/**
 * 单个插件检索的最长等待时间（毫秒）。
 *
 * 插件是自己写的网络请求，有的会一直挂着不返回，有的十几秒才回。
 * 这是**每个插件各自**的额度，不是所有插件的总额 ——
 * 早先算的是总额，结果慢插件一拖，其它插件已经搜到的结果全被丢掉，
 * 自动换完整版就时灵时不灵。手动「搜索完整播放版本」弹窗也是这个额度。
 */
export const PLUGIN_SEARCH_TIMEOUT = 8000;

/** 已经找到完整版的条目：原条目主键 -> 完整版 */
const replacementCache = new Map<string, IMusic.IMusicItem>();

/** 已经查过、确认没有完整版的条目。避免每次播放都重新请求插件 */
const searchedKeys = new Set<string>();

/**
 * 实测确认过是试听片段的条目。
 *
 * 主流平台给的条目上写着完整歌曲的时长（4:35），实际音频却只有 30 秒，
 * 光看声明时长是发现不了的，得等播出来量了才知道。记下来之后，
 * 下次播这一首时播放前就能判定，不用再听完那 30 秒。
 */
const previewClipKeys = new Set<string>();

/**
 * 被自动换进去过的条目。
 *
 * 插件给的「完整版」候选质量参差，可能本身还是片段。
 * 这些条目再被判定成片段时不再自动换，否则会 A → B → A 无限来回换。
 * 手动在弹窗里选的版本不经过这条链路，不受影响。
 */
const autoReplacedTargets = new Set<string>();

/** 记下这个条目实测只有几十秒，是试听片段 */
export function markPreviewClip(musicItem: IMusic.IMusicItem) {
    previewClipKeys.add(getMediaPrimaryKey(musicItem));
}

/** 记下这个条目已经被自动换成完整版了，别再自动换它 */
export function markAutoReplaced(musicItem: IMusic.IMusicItem) {
    autoReplacedTargets.add(getMediaPrimaryKey(musicItem));
}

/**
 * 这个条目是不是短到只可能是试听片段。
 *
 * 三个来源任一命中即算：
 * - 插件声明的时长短
 * - 实测出来的音频长度短（声明 4:35、实际 30 秒）
 * - 声明的是长歌、实测只播出来一小截（声明 4:31、实际 68 秒）
 * - 之前实测确认过是片段
 *
 * 时长完全不知道时返回 false —— 不知道长短就不该触发检索。
 */
export function isPreviewClip(
    musicItem?: IMusic.IMusicItem | null,
    measuredDuration?: number | null,
): boolean {
    if (!musicItem) {
        return false;
    }
    if (previewClipKeys.has(getMediaPrimaryKey(musicItem))) {
        return true;
    }
    return isPreviewItem(
        musicItem.duration,
        measuredDuration ?? getVerifiedDuration(musicItem),
    );
}

/**
 * 找出这首歌的完整版。
 *
 * @param measuredDuration 已测到的音频长度（秒），有的话一并作为判定依据
 * @returns 找到就返回完整版条目；找不到、没插件支持、超时都返回 null
 */
export async function findFullVersion(
    musicItem: IMusic.IMusicItem,
    measuredDuration?: number | null,
): Promise<IMusic.IMusicItem | null> {
    if (!musicItem) {
        return null;
    }
    // 已经自动换过一次了，别再来回换
    if (autoReplacedTargets.has(getMediaPrimaryKey(musicItem))) {
        return null;
    }
    if (!isPreviewClip(musicItem, measuredDuration)) {
        return null;
    }
    const key = getMediaPrimaryKey(musicItem);

    const cached = replacementCache.get(key);
    if (cached) {
        return cached;
    }
    if (searchedKeys.has(key)) {
        return null;
    }

    const plugins = PluginManager.getSupportedPlugin("getMusicAlternatives");
    if (!plugins.length) {
        // 没有插件支持查找完整版本，行为与从前一致
        return null;
    }

    const requests = plugins.map((plugin) => () =>
        PluginManager.callPluginDelegateMethod(
            { platform: plugin.platform, hash: plugin.hash },
            "getMusicAlternatives",
            musicItem,
            1,
        ),
    );

    // 每个插件单独兜底：慢插件按「没搜到」处理，不拖累其它插件的结果
    const results = await searchWithPerPluginTimeout<IMusic.IMusicItem>(
        requests,
        PLUGIN_SEARCH_TIMEOUT,
    );
    const merged: IMusic.IMusicItem[] = [];
    for (const result of results) {
        merged.push(...result.data);
    }

    /**
     * 查完了才记「已查过、没有完整版」。
     * 有插件超时、或所有插件都报错，说明这次检索并不完整 ——
     * 这时候不记，下次播放还会再试，不会因为一次运气不好就把这首歌拉黑。
     */
    if (isSearchConclusive(results)) {
        searchedKeys.add(key);
    }

    // 判定基准用实测时长：原曲「声明 4:35、实测 30 秒」时，
    // 真正的完整版就是 4:35，拿声明时长当基准会把它误判掉
    const measured = measuredDuration ?? getVerifiedDuration(musicItem);
    const baseDuration = measured ?? normalizeDuration(musicItem.duration) ?? 0;

    const picked = pickFullVersion(musicItem, merged, baseDuration);
    if (picked) {
        replacementCache.set(key, picked);
    }
    return picked;
}

/**
 * 取已经找到过的完整版（缓存命中，不用再等网络）。
 *
 * 播放前用它决定要不要先换成完整版再播：
 * 命中就立即换，不命中就别挡着播放 —— 检索要几秒，挡住播放体验太差。
 */
export function getCachedFullVersion(
    musicItem: IMusic.IMusicItem | null | undefined,
): IMusic.IMusicItem | null {
    if (!musicItem) {
        return null;
    }
    return replacementCache.get(getMediaPrimaryKey(musicItem)) ?? null;
}

/**
 * 把本地歌单里的同一首也换成完整版。
 * 换了歌单里的条目，下次从歌单再播时不用重新检索。
 *
 * 覆盖**所有**包含这首歌的歌单：用户在哪个列表里看都应该是新版本。
 */
export async function replaceInSheets(
    original: IMusic.IMusicItem,
    replacement: IMusic.IMusicItem,
) {
    const sheets = MusicSheet.frontend.getAllSheets() ?? [];
    const sheetIds = pickSheetIdsWithSong(sheets, original);
    for (const sheetId of sheetIds) {
        // 每个歌单单独兜底：一个歌单写失败不影响其它歌单
        try {
            await MusicSheet.frontend.replaceMusicInSheet(
                original,
                replacement,
                sheetId,
            );
        } catch (e) {
            console.log(e);
        }
    }
}

/** 清掉缓存。歌单里的条目被手工改过之后可以用得上 */
export function clearFullVersionCache() {
    replacementCache.clear();
    searchedKeys.clear();
    previewClipKeys.clear();
    autoReplacedTargets.clear();
}
