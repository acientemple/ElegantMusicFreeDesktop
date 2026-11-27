/**
 * 把 out/MusicFree-win32-x64 部署到便携版目录，并保持"精简"形态。
 *
 * 用法：node scripts/deploy-portable.js [目标目录]
 * 默认目标：release/portable
 *
 * 两个坑都在这里兜住：
 * - robocopy 绝不能带 /MIR：会把 portable/userData 里的用户数据（插件、设置、
 *   歌单数据库）一起删掉。
 * - electron 发行版自带 55 个语言包，入库的便携版只保留 4 个；部署完不清理的话
 *   git status 会一直挂着几十个未跟踪文件。清理是安全的——这些文件每次打包
 *   都会从 out/ 重新生成，不是用户数据。
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const source = path.join(repoRoot, "out", "MusicFree-win32-x64");
const target = path.resolve(repoRoot, process.argv[2] || "release/portable");

/** 便携版保留的语言包，和仓库里入库的一致 */
const keepLocales = ["en-GB.pak", "en-US.pak", "zh-CN.pak", "zh-TW.pak"];

if (!fs.existsSync(source)) {
    console.error(`找不到构建产物：${source}\n请先运行 npm run package`);
    process.exit(1);
}

console.log(`源目录：${source}`);
console.log(`目标目录：${target}`);

// 1) 部署。robocopy 的退出码 0-7 都算成功（>=8 才是真失败）。
const robocopy = spawnSync(
    "robocopy",
    [source, target, "/E", "/R:1", "/W:1", "/NFL", "/NDL"],
    { encoding: "utf8" },
);
if (robocopy.error) {
    console.error(`robocopy 执行失败：${robocopy.error.message}`);
    process.exit(1);
}
if (robocopy.status >= 8) {
    console.error(robocopy.stdout || "");
    console.error(`robocopy 失败，退出码 ${robocopy.status}`);
    process.exit(robocopy.status);
}
console.log(`部署完成（robocopy 退出码 ${robocopy.status}）`);

// 2) 清掉多余语言包，保持精简形态
const localesDir = path.join(target, "locales");
let removed = 0;
if (fs.existsSync(localesDir)) {
    for (const name of fs.readdirSync(localesDir)) {
        if (name.endsWith(".pak") && !keepLocales.includes(name)) {
            fs.rmSync(path.join(localesDir, name));
            removed++;
        }
    }
}
const left = fs.existsSync(localesDir) ? fs.readdirSync(localesDir) : [];
console.log(`语言包：清理 ${removed} 个，保留 ${left.length} 个（${left.join(", ")}）`);

// 3) 提示还剩哪些改动没入库
const status = spawnSync("git", ["status", "--short", target], {
    cwd: repoRoot,
    encoding: "utf8",
});
if (status.stdout) {
    console.log("待入库的便携版改动：");
    console.log(status.stdout.trim());
}
console.log("提醒：打包版没有热重载，改完要重新打包并重新部署本脚本才会生效。");
