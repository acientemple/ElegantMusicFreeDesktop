import AppConfig from "@shared/app-config/renderer";
import defaultAppConfig from "@shared/app-config/default-app-config";
import { IAppConfig } from "@/types/app-config";
import { shortCutKeys, shortCutKeysCommands } from "@/common/constant";
import hotkeys from "hotkeys-js";
import messageBus from "@shared/message-bus/renderer/main";

type IShortCutKeys = keyof IAppConfig["shortCut.shortcuts"];

interface IMod {
    registerGlobalShortCut: (key: IShortCutKeys, shortCut: string[]) => void;
    unregisterGlobalShortCut: (key: IShortCutKeys) => void;
}

const mod = window["@shared/short-cut" as any] as unknown as IMod;

const originalHotkeysFilter = hotkeys.filter;

hotkeys.filter = (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset["capture"] === "true") {
        return true;
    }
    return originalHotkeysFilter(event);
};

interface ILocalBinding {
    callback: (...args: any[]) => void;
    /** 实际绑给 hotkeys 的键序列，解绑时要用 */
    keys: string[];
}

class ShortCut {
    private localShortCutMap = new Map<string, ILocalBinding>();

    setup() {
        try {
            const shortCuts = AppConfig.getConfig("shortCut.shortcuts");
            const defaultShortCuts = defaultAppConfig["shortCut.shortcuts"];
            /**
             * 本次要落盘的配置。
             * 设置页改键位是单条即时生效的，这里只在补默认键位时整体写一次，
             * 避免逐条写入时后一条把前一条覆盖掉（配置更新是异步回来的）。
             */
            const nextShortCuts: IAppConfig["shortCut.shortcuts"] = {
                ...(shortCuts || ({} as any)),
            };
            let changed = false;
            for (const shortCutKey of shortCutKeys) {
                const userConfig = shortCuts?.[shortCutKey];
                /**
                 * 用户配置里出现过的键以用户配置为准（显式清空的 null 也算出现过，保持清空）；
                 * 没出现过的键回退到默认键位 —— 这样新版本新增的默认键位对老用户同样生效。
                 */
                const localShortCutConfig = userConfig
                    ? userConfig.local
                    : defaultShortCuts?.[shortCutKey]?.local;
                if (!localShortCutConfig?.length) {
                    continue;
                }
                this.bindLocalShortCut(shortCutKey, localShortCutConfig);
                if (!userConfig) {
                    // 把默认键位补进用户配置，设置页才能显示出实际生效的键位
                    nextShortCuts[shortCutKey] = {
                        local: localShortCutConfig,
                        global: null,
                    };
                    changed = true;
                }
            }
            if (changed) {
                AppConfig.setConfig({
                    "shortCut.shortcuts": nextShortCuts,
                });
            }
        } catch {
            // pass
        }
    }

    /** 绑定热键，不落盘 */
    private bindLocalShortCut(key: IShortCutKeys, shortCut: string[]) {
        this.unbindLocalShortCut(key);
        const callback = (evt: KeyboardEvent) => {
            if (AppConfig.getConfig("shortCut.enableLocal")) {
                evt.preventDefault();
                messageBus.sendCommand(shortCutKeysCommands[key]);
            }
        };
        hotkeys(shortCut.join("+"), "all", callback);
        this.localShortCutMap.set(key as string, {
            callback,
            keys: shortCut,
        });
    }

    /** 解绑热键，不落盘 */
    private unbindLocalShortCut(key: IShortCutKeys) {
        const binding = this.localShortCutMap.get(key as string);
        if (!binding) {
            return;
        }
        hotkeys.unbind(binding.keys.join("+"), "all", binding.callback);
        this.localShortCutMap.delete(key as string);
    }

    registerLocalShortCut(key: IShortCutKeys, shortCut: string[]) {
        if (!shortCut?.length) {
            return;
        }
        this.bindLocalShortCut(key, shortCut);

        const shortCuts = AppConfig.getConfig("shortCut.shortcuts");
        AppConfig.setConfig({
            "shortCut.shortcuts": {
                ...(shortCuts || {} as any),
                [key]: {
                    ...(shortCuts?.[key] || {}),
                    local: shortCut,
                },
            },
        });
    }

    unregisterLocalShortCut(key: IShortCutKeys) {
        this.unbindLocalShortCut(key);

        const shortCuts = AppConfig.getConfig("shortCut.shortcuts");
        AppConfig.setConfig({
            "shortCut.shortcuts": {
                ...(shortCuts || {} as any),
                [key]: {
                    ...(shortCuts?.[key] || {}),
                    local: null,
                },
            },
        });
    }

    registerGlobalShortCut(key: IShortCutKeys, shortCut: string[]) {
        mod.registerGlobalShortCut(key, shortCut);
    }

    unregisterGlobalShortCut(key: IShortCutKeys) {
        mod.unregisterGlobalShortCut(key);
    }
}


const shortCut = new ShortCut();
export default shortCut;
