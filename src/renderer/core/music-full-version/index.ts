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
import { delay } from "@/common/time-util";
import MusicSheet from "@renderer/core/music-sheet";
import PluginManager from "@shared/plugin-manager/renderer";
import {
    isPreviewDuration,
    pickFullVersion,
    pickSheetIdsWithSong,
    PREVIEW_MAX_DURATION,
} from "./pure.ts";

export { PREVIEW_MAX_DURATION, pickFullVersion };

/** 检索完整版的整体超时（毫秒）。超时后照常播放原来的条目，只是慢一点 */
const SEARCH_TIMEOUT = 8000;

/** 已经找到完整版的条目：原条目主键 -> 完整版 */
const replacementCache = new Map<string, IMusic.IMusicItem>();

/** 已经查过、确认没有完整版的条目。避免每次播放都重新请求插件 */
const searchedKeys = new Set<string>();

/**
 * 这个条目是不是短到只可能是试听片段。
 * 时长未知一律返回 false —— 不知道长短就不该触发检索。
 */
export function isPreviewClip(
    musicItem?: IMusic.IMusicItem | null,
): boolean {
    if (!musicItem) {
        return false;
    }
    return isPreviewDuration(musicItem.duration);
}

/**
 * 找出这首歌的完整版。
 *
 * @returns 找到就返回完整版条目；找不到、没插件支持、超时都返回 null
 */
export async function findFullVersion(
    musicItem: IMusic.IMusicItem,
): Promise<IMusic.IMusicItem | null> {
    if (!musicItem || !isPreviewClip(musicItem)) {
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

    const requests = plugins.map((plugin) =>
        PluginManager.callPluginDelegateMethod(
            { platform: plugin.platform, hash: plugin.hash },
            "getMusicAlternatives",
            musicItem,
            1,
        ),
    );

    const settled = await Promise.race([
        Promise.allSettled(requests),
        delay(SEARCH_TIMEOUT).then(() => null),
    ]);

    if (!settled) {
        // 超时：这次不算数，下次播放还会再试
        return null;
    }

    const merged: IMusic.IMusicItem[] = [];
    let responded = false;
    for (const result of settled) {
        if (result.status === "fulfilled") {
            responded = true;
            if (result.value?.data) {
                merged.push(...result.value.data);
            }
        }
    }

    // 查完了：确认没有完整版的记下来，别每次播放都再问一遍插件。
    // 插件直接报错不算数，那多半是网络问题，下次播放还会再试。
    if (responded) {
        searchedKeys.add(key);
    }

    const picked = pickFullVersion(musicItem, merged);
    if (picked) {
        replacementCache.set(key, picked);
    }
    return picked;
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
}
