import { localPluginHash, PlayerState, RepeatMode, supportLocalMediaType } from "@/common/constant";
import MusicSheet from "../core/music-sheet";
import trackPlayer from "../core/track-player";
import localMusic from "../core/local-music";
import { setAutoFreeze } from "immer";
import Downloader from "../core/downloader";
import AppConfig from "@shared/app-config/renderer";
import { setupI18n } from "@/shared/i18n/renderer";
import ThemePack from "@/shared/themepack/renderer";
import { addToRecentlyPlaylist, setupRecentlyPlaylist } from "../core/recently-playlist";
import ServiceManager from "@shared/service-manager/renderer";
import { CurrentTime, PlayerEvents } from "@renderer/core/track-player/enum";
import { getSeekTarget } from "@renderer/core/track-player/seek";
import { appWindowUtil, fsUtil } from "@shared/utils/renderer";
import PluginManager from "@shared/plugin-manager/renderer";
import messageBus from "@shared/message-bus/renderer/main";
import throttle from "lodash.throttle";
import { IAppState } from "@shared/message-bus/type";
import MusicDetail from "@renderer/components/MusicDetail";
import { musicDetailShownStore } from "@renderer/components/MusicDetail/store";
import { showModal } from "@renderer/components/Modal";
import { getCurrentPanel, hidePanel, showPanel } from "@renderer/components/Panel";
import shortCut from "@shared/short-cut/renderer";
import { setupMusicMeta } from "@renderer/core/music-meta";
import { setupMusicMv } from "@renderer/core/music-mv";
import { setupMusicDuration } from "@renderer/core/music-duration";
import { startVisualizationService } from "@renderer/core/visualization";
import { readThemeColors } from "@renderer/core/visualization/theme-colors";


setAutoFreeze(false);

/**
 * 静音前的音量。
 * 静音不是「把音量永久设为 0」，取消静音时要还原到静音前的音量，
 * 所以这里记住一份。null 表示当前没有处于静音状态。
 */
let mutedVolume: number | null = null;

export default async function () {
    await Promise.all([
        AppConfig.setup(),
        PluginManager.setup(),
    ]);
    await Promise.all([
        MusicSheet.frontend.setupMusicSheets(),
        trackPlayer.setup(),
        setupMusicMeta(),
        setupMusicMv(),
        setupMusicDuration(),
    ]);
    await setupI18n();
    shortCut.setup();
    dropHandler();
    clearDefaultBehavior();
    setupCommandAndEvents();
    setupDeviceChange();
    localMusic.setupLocalMusic();
    await Downloader.setupDownloader();
    setupRecentlyPlaylist();
    // 本地服务
    ServiceManager.setup();

    // 可视化：把播放中的音频接上分析链路（不介入播放本身）
    startVisualizationService();

    // 自动更新插件
    if (AppConfig.getConfig("plugin.autoUpdatePlugin")) {
        const lastUpdated = +(localStorage.getItem("pluginLastupdatedTime") || 0);
        const now = Date.now();
        if (Math.abs(now - lastUpdated) > 86400000) {
            localStorage.setItem("pluginLastupdatedTime", `${now}`);
            PluginManager.updateAllPlugins();
        }
    }

}

function dropHandler() {
    document.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        console.log(event);

        const validMusicList: IMusic.IMusicItem[] = [];
        for (const f of event.dataTransfer.files) {
            if (f.type === "" && (await fsUtil.isFolder(f.path))) {
                validMusicList.push(
                    ...(await PluginManager.callPluginDelegateMethod(
                        {
                            hash: localPluginHash,
                        },
                        "importMusicSheet",
                        f.path,
                    )),
                );
            } else if (
                supportLocalMediaType.some((postfix) => f.path.endsWith(postfix))
            ) {
                validMusicList.push(
                    await PluginManager.callPluginDelegateMethod(
                        {
                            hash: localPluginHash,
                        },
                        "importMusicItem",
                        f.path,
                    ),
                );
            } else if (f.path.endsWith(".mftheme")) {
                // 主题包
                const themeConfig = await ThemePack.installThemePack(f.path);
                if (themeConfig) {
                    await ThemePack.selectTheme(themeConfig);
                }
            }
        }
        if (validMusicList.length) {
            trackPlayer.playMusicWithReplaceQueue(validMusicList);
        }
    });

    document.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
}

function clearDefaultBehavior() {
    const killSpaceBar = function (evt: any) {
        // https://greasyfork.org/en/scripts/25035-disable-space-bar-scrolling/code
        const target = evt.target || {},
            isInput =
                "INPUT" == target.tagName ||
                "TEXTAREA" == target.tagName ||
                "SELECT" == target.tagName ||
                "EMBED" == target.tagName;

        // if we're an input or not a real target exit
        if (isInput || !target.tagName) return;

        // if we're a fake input like the comments exit
        if (
            target &&
            target.getAttribute &&
            target.getAttribute("role") === "textbox"
        )
            return;

        // ignore the space
        if (evt.keyCode === 32) {
            evt.preventDefault();
        }
    };

    document.addEventListener("keydown", killSpaceBar, false);
}


/** 设置事件 */
function setupCommandAndEvents() {
    messageBus.onCommand("SkipToNext", () => {
        trackPlayer.skipToNext();
    });
    messageBus.onCommand("SkipToPrevious", () => {
        trackPlayer.skipToPrev();
    });
    const seekBy = (delta: number) => {
        if (!trackPlayer.currentMusic) {
            return;
        }
        // 切歌后音源还在取，progress 仍是上一首的；此时记下的跳转会被
        // 下一首的 loadedmetadata 套用（pendingSeek），所以直接忽略
        if (trackPlayer.playerState === PlayerState.Buffering) {
            return;
        }
        const { currentTime, duration } = trackPlayer.progress;
        // duration 非有限说明当前没有可用音源（例如播放失败后被重置）
        if (!isFinite(duration)) {
            return;
        }
        trackPlayer.seekTo(getSeekTarget(currentTime, duration, delta));
    };
    messageBus.onCommand("SeekForward", () => {
        seekBy(5);
    });
    messageBus.onCommand("SeekBackward", () => {
        seekBy(-5);
    });
    messageBus.onCommand("SeekForwardLong", () => {
        seekBy(30);
    });
    messageBus.onCommand("SeekBackwardLong", () => {
        seekBy(-30);
    });
    messageBus.onCommand("ToggleMute", () => {
        // 静音不是「音量永远为 0」：记住静音前的音量，取消时还原回去
        if (mutedVolume !== null) {
            trackPlayer.setVolume(mutedVolume);
            mutedVolume = null;
        } else {
            mutedVolume = trackPlayer.volume;
            trackPlayer.setVolume(0);
        }
    });
    messageBus.onCommand("TogglePlayerState", () => {
        if (trackPlayer.playerState === PlayerState.Playing) {
            trackPlayer.pause();
        } else {
            trackPlayer.resume();
        }
    });
    messageBus.onCommand("SetRepeatMode", (mode) => {
        trackPlayer.setRepeatMode(mode);
    });
    messageBus.onCommand("ToggleRepeatMode", () => {
        trackPlayer.toggleRepeatMode();
    });
    messageBus.onCommand("ToggleMusicDetail", () => {
        if (musicDetailShownStore.getValue()) {
            MusicDetail.hide();
        } else {
            MusicDetail.show();
        }
    });
    messageBus.onCommand("TogglePlayList", () => {
        if (getCurrentPanel()?.type === "PlayList") {
            hidePanel();
        } else {
            showPanel("PlayList", {
                coverHeader: musicDetailShownStore.getValue(),
            });
        }
    });
    messageBus.onCommand("ToggleMinimode", () => {
        const isMiniMode = !!AppConfig.getConfig("private.minimode");
        appWindowUtil.setMinimodeWindow(!isMiniMode);
        if (!isMiniMode) {
            appWindowUtil.minMainWindow(true);
        }
    });
    // 搜索类命令都需要当前播放的歌曲，没有就静默返回
    const withCurrentMusic = (handler: (musicItem: IMusic.IMusicItem) => void) => {
        return () => {
            const musicItem = trackPlayer.currentMusic;
            if (!musicItem) {
                return;
            }
            handler(musicItem);
        };
    };
    messageBus.onCommand(
        "SearchFullVersion",
        withCurrentMusic((musicItem) => {
            showModal("MusicAlternatives", { musicItem });
        }),
    );
    messageBus.onCommand(
        "SearchMusicVideo",
        withCurrentMusic((musicItem) => {
            showModal("MusicVideoSearch", { musicItem });
        }),
    );
    messageBus.onCommand(
        "SearchLyric",
        withCurrentMusic((musicItem) => {
            showModal("SearchLyric", { musicItem });
        }),
    );
    messageBus.onCommand(
        "SmartLyric",
        withCurrentMusic((musicItem) => {
            showModal("SmartLyric", { musicItem });
        }),
    );
    messageBus.onCommand(
        "AudioRecognition",
        withCurrentMusic((musicItem) => {
            showModal("AudioRecognition", { musicItem });
        }),
    );
    messageBus.onCommand("VolumeUp", (val = 0.04) => {
        trackPlayer.setVolume(Math.min(1, trackPlayer.volume + val));
    });

    messageBus.onCommand("VolumeDown", (val = 0.04) => {
        trackPlayer.setVolume(Math.max(0, trackPlayer.volume - val));
    });

    messageBus.onCommand("ToggleFavorite", async (item) => {
        const realItem = item || trackPlayer.currentMusic;
        if (MusicSheet.frontend.isFavoriteMusic(realItem)) {
            MusicSheet.frontend.removeMusicFromFavorite(realItem);
        } else {
            MusicSheet.frontend.addMusicToFavorite(realItem);
        }
    });

    messageBus.onCommand("ToggleDesktopLyric", () => {
        const enableDesktopLyric = AppConfig.getConfig("lyric.enableDesktopLyric");
        appWindowUtil.setLyricWindow(!enableDesktopLyric);
        AppConfig.setConfig({
            "lyric.enableDesktopLyric": !enableDesktopLyric,
        });
    });

    messageBus.onCommand("OpenMusicDetailPage", () => {
        MusicDetail.show();
    });

    messageBus.onCommand("ToggleMainWindowVisible", () => {
        appWindowUtil.toggleMainWindowVisible();
    });


    const sendAppStateTo = (from: "main" | number) => {
        const appState: IAppState = {
            repeatMode: trackPlayer.repeatMode || RepeatMode.Queue,
            playerState: trackPlayer.playerState || PlayerState.None,
            musicItem: trackPlayer.currentMusicBasicInfo || null,
            lyricText: trackPlayer.lyric?.currentLrc?.lrc || null,
            parsedLrc: trackPlayer.lyric?.currentLrc || null,
            fullLyric: trackPlayer.lyric?.parser?.getLyricItems() || [],
            progress: trackPlayer.progress?.currentTime || 0,
            duration: trackPlayer.progress?.duration || 0,
            // 可视化窗口是**按需创建**的，它挂载时主窗口早已启动完毕——
            // 若这里不带主题色，它首次打开只会拿到默认配色，
            // 要等用户切一次主题才会跟上。
            themeColors: readThemeColors(),
        };

        messageBus.syncAppState(appState, from);
    };

    messageBus.onCommand("SyncAppState", (_, from) => {
        sendAppStateTo(from);
    });
    sendAppStateTo("main");

    // 状态同步
    trackPlayer.on(PlayerEvents.StateChanged, state => {
        messageBus.syncAppState({
            playerState: state,
        });
    });

    trackPlayer.on(PlayerEvents.RepeatModeChanged, mode => {
        messageBus.syncAppState({
            repeatMode: mode,
        });
    });

    trackPlayer.on(PlayerEvents.CurrentLyricChanged, lyric => {
        messageBus.syncAppState({
            lyricText: lyric?.lrc,
            parsedLrc: lyric,
        });
    });

    trackPlayer.on(PlayerEvents.LyricChanged, lyric => {
        messageBus.syncAppState({
            fullLyric: lyric?.getLyricItems?.() || [],
        });
    });

    const progressChangedHandler = throttle((currentTime: CurrentTime) => {
        messageBus.syncAppState({
            progress: currentTime?.currentTime || 0,
            duration: currentTime.duration || 0,
        });
    }, 800);

    trackPlayer.on(PlayerEvents.ProgressChanged, progressChangedHandler);

    // 最近播放
    trackPlayer.on(PlayerEvents.MusicChanged, (musicItem) => {
        messageBus.syncAppState({
            musicItem,
            lyricText: null,
            fullLyric: [],
            parsedLrc: null,
            progress: 0,
            duration: 0,
        });
        addToRecentlyPlaylist(musicItem);
    });
}

async function setupDeviceChange() {
    const getAudioDevices = async () =>
        await navigator.mediaDevices.enumerateDevices().catch(() => []);
    let devices = (await getAudioDevices()) || [];

    navigator.mediaDevices.ondevicechange = async (evt) => {
        const newDevices = await getAudioDevices();
        if (
            newDevices.length < devices.length &&
            AppConfig.getConfig("playMusic.whenDeviceRemoved") === "pause"
        ) {
            trackPlayer.pause();
        }
        devices = newDevices;
    };
}
