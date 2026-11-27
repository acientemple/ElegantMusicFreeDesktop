import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Base from "../Base";
import DraggableWindow from "../Base/DraggableWindow";
import "./index.scss";
import Loading from "@/renderer/components/Loading";
import Empty from "@/renderer/components/Empty";
import albumImg from "@/assets/imgs/album-cover.jpg";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import PluginManager, { useSupportedPlugin } from "@shared/plugin-manager/renderer";
import trackPlayer from "@renderer/core/track-player";
import { replaceInSheets } from "@renderer/core/music-full-version";
import { hideModal } from "../..";
import { getMediaPrimaryKey } from "@/common/media-util";
import { delay } from "@/common/time-util";
import { applyMusicMeta } from "@/renderer/core/music-meta";
import SvgAsset from "@/renderer/components/SvgAsset";

interface IProps {
    musicItem?: IMusic.IMusicItem;
}

/**
 * 单个插件检索的最长等待时间（毫秒）。
 *
 * 插件是自己写的网络请求，有的会一直挂着不返回。弹窗是并发问所有插件的，
 * 只要有一个不回，整个弹窗就永远转圈 —— 别的插件明明已经搜到结果了，
 * 用户却什么都看不到。这里给每个插件单独兜个底：超时就当它没搜到，
 * 不影响其它插件的结果。
 */
const PLUGIN_TIMEOUT = 8000;

function formatDuration(duration?: number | null) {
    if (!duration || !isFinite(duration)) {
        return null;
    }
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function MusicAlternatives(props: IProps) {
    const { musicItem } = props;
    const { t } = useTranslation();
    /** 展示用：套用用户手动改过的信息，插件调用仍用原始条目 */
    const displayItem = useMemo(
        () => (musicItem ? applyMusicMeta(musicItem) : null),
        [musicItem?.platform, musicItem?.id],
    );

    /**
     * 用完整版覆盖原来的不完整版本：所在本地歌单与播放队列都替换，
     * 正在播放的那一首从头开始播。
     *
     * 歌单不按来源区分：只要这首歌出现在哪张歌单里，就把那一条换成完整版。
     * 从歌词播放界面打开时拿不到所在歌单，从歌单右键打开时同一首歌也可能在
     * 别的歌单里留着旧版本 —— 统一按「所有含这首歌的歌单」替换，
     * 用户在哪个列表里看都是替换后的版本。
     */
    async function applyFullVersion(
        original: IMusic.IMusicItem,
        alternative: IMusic.IMusicItem,
    ) {
        try {
            await replaceInSheets(original, alternative);
            await trackPlayer.replaceMusic(original, alternative, {
                play: true,
                restartFromStart: true,
            });
            toast.success(t("modal.music_alternatives_replaced"));
        } catch (e) {
            toast.error(
                t("modal.music_alternatives_replace_fail", {
                    reason: e?.message ?? "",
                }),
            );
        }
    }

    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState<IMusic.IMusicItem[]>([]);
    const [emptyText, setEmptyText] = useState<string | null>(null);
    /** 输入框里的实时内容 */
    const [keyword, setKeyword] = useState("");
    /** 已经提交去检索的关键词 */
    const [submittedKeyword, setSubmittedKeyword] = useState<string | null>(
        null,
    );
    const inputRef = useRef<HTMLInputElement>(null);

    const plugins = useSupportedPlugin("getMusicAlternatives");
    // useSupportedPlugin 每次渲染都会返回新数组，取哈希串做依赖才不会反复触发
    const pluginKey = useMemo(
        () => plugins.map((item) => item.hash).join("|"),
        [plugins],
    );

    // 换了曲子就把关键词重置回原歌名
    useEffect(() => {
        setKeyword(displayItem?.title ?? "");
        setSubmittedKeyword(null);
    }, [musicItem?.platform, musicItem?.id]);

    useEffect(() => {
        let canceled = false;
        const target = musicItem;
        if (!target) {
            setLoading(false);
            setItems([]);
            return;
        }
        setLoading(true);
        setItems([]);
        setEmptyText(null);
        (async () => {
            const supports = PluginManager.getSupportedPlugin(
                "getMusicAlternatives",
            );
            if (!supports.length) {
                if (!canceled) {
                    setLoading(false);
                    setEmptyText(t("modal.music_alternatives_unsupported"));
                }
                return;
            }
            const settled = await Promise.allSettled(
                supports.map(async (plugin) => {
                    const request = PluginManager.callPluginDelegateMethod(
                        { platform: plugin.platform, hash: plugin.hash },
                        "getMusicAlternatives",
                        target,
                        1,
                        submittedKeyword?.trim() || undefined,
                    );
                    // 插件挂住时按时返回空结果，别把整个弹窗拖死
                    const timeout = delay(PLUGIN_TIMEOUT).then(() => null);
                    return (await Promise.race([request, timeout])) ?? {
                        data: [],
                    };
                }),
            );
            const merged: IMusic.IMusicItem[] = [];
            for (const result of settled) {
                if (result.status === "fulfilled" && result.value?.data) {
                    merged.push(...result.value.data);
                }
            }
            if (canceled) {
                return;
            }
            setLoading(false);
            setItems(merged);
            if (!merged.length) {
                setEmptyText(t("modal.music_alternatives_empty"));
            }
        })();
        return () => {
            canceled = true;
        };
    }, [musicItem?.platform, musicItem?.id, pluginKey, submittedKeyword]);

    const submitKeyword = () => {
        setSubmittedKeyword(keyword.trim() || null);
    };

    return (
        <Base defaultClose withBlur={false}>
            <DraggableWindow
                className="modal--music-alternatives-container shadow backdrop-color"
                defaultWidth={620}
                defaultHeight={560}
                minWidth={420}
                minHeight={320}
            >
                <Base.Header
                    extra={
                        <div className="alternatives-search">
                            <input
                                ref={inputRef}
                                className="alternatives-search-input"
                                type="text"
                                placeholder={t("modal.music_alternatives_search")}
                                value={keyword}
                                onChange={(e) => {
                                    setKeyword(e.target.value);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        submitKeyword();
                                    }
                                }}
                            />
                            <div
                                className="alternatives-search-btn"
                                role="button"
                                title={t("modal.music_alternatives_search")}
                                onClick={submitKeyword}
                            >
                                <SvgAsset iconName="magnifying-glass"></SvgAsset>
                            </div>
                        </div>
                    }
                >
                    <div className="header-title">
                        {t("modal.music_alternatives")}
                    </div>
                </Base.Header>
                <div className="alternatives-subtitle">
                    {displayItem?.title} - {displayItem?.artist}
                </div>
                <div className="alternatives-body">
                    {loading ? (
                        <Loading></Loading>
                    ) : items.length ? (
                        items.map((item) => {
                            const duration = formatDuration(item.duration);
                            return (
                                <div
                                    className="alternative-item"
                                    key={getMediaPrimaryKey(item)}
                                    role="button"
                                    onClick={() => {
                                        hideModal();
                                        if (musicItem) {
                                            applyFullVersion(musicItem, item);
                                        }
                                    }}
                                >
                                    <img
                                        src={item.artwork ?? albumImg}
                                        onError={setFallbackAlbum}
                                    ></img>
                                    <div className="alternative-info">
                                        <div className="title">{item.title}</div>
                                        <div className="artist">
                                            {item.artist || "-"}
                                            {item.album
                                                ? ` · ${item.album}`
                                                : ""}
                                        </div>
                                    </div>
                                    <div className="alternative-tags">
                                        <div className="source-tag">
                                            {PluginManager.getPluginDisplayName(
                                                item.platform,
                                            )}
                                        </div>
                                        {item.isOriginArtist ? (
                                            <div className="origin-tag">
                                                {t(
                                                    "modal.music_alternatives_origin_tag",
                                                )}
                                            </div>
                                        ) : null}
                                        <div className="full-tag">
                                            {t(
                                                "modal.music_alternatives_full_tag",
                                            )}
                                        </div>
                                        {duration ? (
                                            <div className="duration">
                                                {duration}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="alternatives-empty">
                            <Empty></Empty>
                            <div className="empty-text">
                                {emptyText ??
                                    t("modal.music_alternatives_empty")}
                            </div>
                        </div>
                    )}
                </div>
            </DraggableWindow>
        </Base>
    );
}
