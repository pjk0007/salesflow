/* eslint-disable @typescript-eslint/no-require-imports -- reproducible customer-only browser distribution */
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process");
const repo = path.resolve(__dirname, ".."), args = new Map();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--") && process.argv[i] !== "--") args.set(process.argv[i].slice(2), process.argv[++i]);
const output = args.get("outdir"), channel = args.get("channel"), origin = new URL(args.get("api-base") || "https://sendb.kr");
const imageAttribute = key => {
    const value = args.get(key);
    if (!value) return "";
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("HTTPS brand image required");
    return ` data-${key}="${url.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`;
};
const branding = imageAttribute("brand-logo") + imageAttribute("brand-icon");
if (!output || !path.isAbsolute(output) || !/^[a-f0-9]{48}$/.test(channel || "") || origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("absolute --outdir, public --channel and HTTPS origin --api-base required");
const esbuild = require(require.resolve("esbuild", { paths: [repo, path.dirname(require.resolve("tsx/package.json"))] }));
const hash = bytes => createHash("sha256").update(bytes).digest("hex"), text = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
(async () => {
    const result = await esbuild.build({ absWorkingDir: repo, entryPoints: ["src/components/customer-messenger/standalone.tsx"], bundle: true, write: false, minify: true, format: "iife", platform: "browser", target: ["es2022"], jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, tsconfig: path.join(repo, "tsconfig.json"), metafile: true });
    const inputs = Object.keys(result.metafile.inputs);
    if (inputs.some(p => /src\/lib\/(db|auth|inbox\/repository|customer-platform\/repository)|sdk\/server|credential[^/]*\.json/.test(p.replaceAll("\\", "/")))) throw new Error("server module in customer bundle");
    const styles = fs.readdirSync(path.join(repo, ".next/static/css")).filter(p => p.endsWith(".css")).sort();
    if (!styles.length) throw new Error("run the verified Next.js build first to prepare styles");
    const values = { js: Buffer.from(result.outputFiles[0].contents), css: Buffer.from(styles.map(p => text(path.join(repo, ".next/static/css", p))).join("\n")), sdk: Buffer.from(text(path.join(repo, "public/sendb-sdk.js"))) };
    const files = { js: `sendb-messenger.${hash(values.js).slice(0, 16)}.js`, css: `sendb-messenger.${hash(values.css).slice(0, 16)}.css`, sdk: `sendb-sdk.${hash(values.sdk).slice(0, 16)}.js` };
    fs.mkdirSync(output, { recursive: true });
    for (const kind of Object.keys(files)) fs.writeFileSync(path.join(output, files[kind]), values[kind]);
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>고객 상담</title><link rel="stylesheet" href="/${files.css}"></head><body><div id="sendb-messenger-root"><p role="status">상담을 연결하고 있습니다…</p></div><script src="/${files.js}" data-api-base="${origin.origin}" data-channel="${channel}"${branding} defer></script></body></html>`;
    fs.writeFileSync(path.join(output, "sendb-messenger.html"), html);
    const sourceHashes = Object.fromEntries(inputs.filter(p => p.startsWith("src/") || p.startsWith("sdk/")).map(p => [p, hash(Buffer.from(text(path.resolve(repo, p))))]));
    let revision = "unknown", modified = true;
    try {
        revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
        modified = !!execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
    } catch { /* source hashes still identify this artifact */ }
    const manifest = { version: 1, sourceRevision: revision, sourceWorkingTreeModified: modified, sourceHashes, apiBase: origin.origin, channelKey: channel, files, hashes: Object.fromEntries(Object.keys(values).map(k => [k, hash(values[k])])), bytes: Object.fromEntries(Object.keys(values).map(k => [k, values[k].length])), htmlSha256: hash(Buffer.from(html)), esbuildVersion: esbuild.version, noServerModules: true };
    fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ status: "built", files, bytes: manifest.bytes, sourceFiles: Object.keys(sourceHashes).length, noServerModules: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
