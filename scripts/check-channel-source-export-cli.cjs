/* eslint-disable @typescript-eslint/no-require-imports -- 실제 offline CLI argv·child·disk 검수, 허구 자료 전용 */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process"), { randomUUID, createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), qaRoot = path.join(root, ".testenv/channel-cli-qa", randomUUID());
const cli = path.join(root, "scripts/export-channel-source.cjs"), fixturePath = path.join(root, "scripts/fixtures/channel-source-export-fictional.json"), fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
assert.equal(fixture.fictional, true);
assert.equal(path.dirname(qaRoot), path.join(root, ".testenv/channel-cli-qa"));
fs.mkdirSync(qaRoot, { recursive: true });
const digest = bytes => createHash("sha256").update(bytes).digest("hex"), json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const tsxDirectory = path.join(path.dirname(require.resolve("tsx/package.json")), "dist"), tsxClients = fs.readdirSync(tsxDirectory).filter(name => /^client-[^/\\]+\.cjs$/.test(name));
assert.equal(tsxClients.length, 1, "Exactly one installed tsx CJS client is required for precise denied IPC classification");
const tsxCaller = fs.realpathSync(path.join(tsxDirectory, tsxClients[0]));
const sources = ["scripts/export-channel-source.cjs", "scripts/check-channel-source-export-cli.cjs", "scripts/check-channel-source-export.cjs", "scripts/fixtures/channel-source-export-fictional.json", "src/lib/customer-imports/channel-export.ts", "src/lib/channel-source-export/http.ts", "src/lib/channel-source-export/collector-request.ts", "src/lib/channel-source-export/chunks.ts", "src/lib/channel-source-export/output.ts", "src/lib/channel-source-export/files.ts", path.relative(root, tsxCaller)];
const sourceHashes = () => Object.fromEntries(sources.map(file => [file, digest(fs.readFileSync(path.join(root, file)))]));
const beforeHashes = sourceHashes(), checks = [], commands = [];
const guardPath = path.join(qaRoot, "block-native-network.cjs");
fs.writeFileSync(guardPath, String.raw`const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const expectedCaller = ${JSON.stringify(tsxCaller)};
const expectedPipe = (process.platform === 'win32' ? '\\\\?\\pipe\\' : '') + path.join(os.tmpdir(), 'tsx-' + os.userInfo().username, process.ppid + '.pipe');
let nativeNetworkAttempts = 0, deniedTsxLocalIpcAttempts = 0;
const blockedApis = [];
function deny(api, ...args) {
    const stack = new Error('Offline CLI QA denies all connections').stack;
    const exactTsxLocalIpc = (api === 'net.connect' || api === 'net.createConnection') && typeof args[0] === 'string' && args[0] === expectedPipe && stack.split('\n').some(line => line.includes(expectedCaller + ':') && /:\d+:\d+\)?$/.test(line));
    if (exactTsxLocalIpc) deniedTsxLocalIpcAttempts++; else nativeNetworkAttempts++;
    blockedApis.push({ api, exactTsxLocalIpc, blocked: true });
    throw new Error('Offline CLI QA prohibits all network and local IPC');
}
global.fetch = (...args) => deny('fetch', ...args);
for (const modName of ['http', 'https']) {
    const mod = require('node:' + modName);
    for (const name of ['request', 'get']) mod[name] = (...args) => deny(modName + '.' + name, ...args);
}
for (const modName of ['net', 'tls']) {
    const mod = require('node:' + modName);
    for (const name of ['connect', 'createConnection']) mod[name] = (...args) => deny(modName + '.' + name, ...args);
}
require('node:net').Socket.prototype.connect = function (...args) { return deny('net.Socket.connect', ...args); };
for (const modName of ['dns', 'dns/promises']) {
    const mod = require('node:' + modName);
    for (const name of Object.keys(mod)) if (/^(lookup|resolve|reverse)/.test(name) && typeof mod[name] === 'function') mod[name] = (...args) => deny(modName + '.' + name, ...args);
    if (mod.Resolver) for (const name of Object.getOwnPropertyNames(mod.Resolver.prototype)) if (/^(lookup|resolve|reverse)/.test(name) && typeof mod.Resolver.prototype[name] === 'function') mod.Resolver.prototype[name] = (...args) => deny(modName + '.Resolver.' + name, ...args);
}
process.on('exit', () => fs.writeFileSync(process.env.SENDB_QA_NETWORK_AUDIT, JSON.stringify({ nativeNetworkAttempts, deniedTsxLocalIpcAttempts, actualRequests: 0, actualLocalIpcConnections: 0, guardInstalled: true, blockedApis })));
`);
const baseEnv = {};
for (const key of ["SystemRoot", "windir", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC"]) if (process.env[key]) baseEnv[key] = process.env[key];
assert.ok(!Object.hasOwn(baseEnv, "CHANNEL_SOURCE_ACCESS_KEY") && !Object.hasOwn(baseEnv, "CHANNEL_SOURCE_ACCESS_SECRET"));
const common = (out, extra = []) => ["--fixture", fixturePath, "--out", out, "--channel-id", fixture.channelId, "--namespace", "fictional-cli-qa", "--workspace-id", "8", "--page-size", "2", "--include-files", ...extra];
function run(label, args, expected = undefined) {
    const id = String(commands.length + 1).padStart(2, "0") + "-" + label, auditPath = path.join(qaRoot, id + "-network.json");
    const child = spawnSync(process.execPath, [cli, ...args], { cwd: qaRoot, env: { ...baseEnv, NODE_OPTIONS: "--require=" + guardPath, NEXT_TELEMETRY_DISABLED: "1", SENDB_QA_NETWORK_AUDIT: auditPath }, encoding: "utf8", windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
    const stdout = child.stdout ?? "", stderr = child.stderr ?? "";
    fs.writeFileSync(path.join(qaRoot, id + "-stdout.log"), stdout); fs.writeFileSync(path.join(qaRoot, id + "-stderr.log"), stderr);
    const audit = fs.existsSync(auditPath) ? json(auditPath) : null;
    let summary;
    for (const line of [stdout.trim().split(/\r?\n/).at(-1), stderr.trim().split(/\r?\n/).at(-1)]) try { if (line?.startsWith("{")) summary = JSON.parse(line); } catch {}
    const result = { label, argv: args, exitCode: child.status, signal: child.signal, error: child.error?.code, summary, network: audit };
    commands.push(result);
    assert.ok(!child.error, label + " child failed: " + child.error?.code);
    assert.equal(child.signal, null, label + " child signal");
    assert.equal(audit?.nativeNetworkAttempts, 0, label + " native HTTP/fetch/net/tls/DNS/socket must not be attempted"); assert.equal(audit?.actualRequests, 0); assert.equal(audit?.actualLocalIpcConnections, 0); assert.equal(audit?.guardInstalled, true);
    assert.ok(Number.isSafeInteger(audit?.deniedTsxLocalIpcAttempts) && audit.deniedTsxLocalIpcAttempts >= 0); assert.equal(audit.blockedApis.length, audit.deniedTsxLocalIpcAttempts);
    for (const event of audit.blockedApis) assert.deepEqual(event, { api: "net.createConnection", exactTsxLocalIpc: true, blocked: true }, label + " only exact tsx parent IPC attempts may be classified separately; these remain denied");
    if (expected !== undefined) assert.equal(child.status, expected, label + ": " + stdout + stderr);
    return { ...result, stdout, stderr };
}
function safeFile(directory, relative) {
    assert.equal(typeof relative, "string"); const resolved = path.resolve(directory, relative);
    assert.ok(resolved.startsWith(path.resolve(directory) + path.sep)); return resolved;
}
function diskOracle(directory) {
    const manifest = json(path.join(directory, "manifest.json"));
    assert.equal(manifest.migrationApplied, false);
    const rawBytes = fs.readFileSync(safeFile(directory, manifest.raw.path)); assert.equal(digest(rawBytes), manifest.raw.sha256); assert.equal(rawBytes.length, manifest.raw.bytes);
    const raw = JSON.parse(rawBytes.toString()), index = json(path.join(directory, "pages-index.json")); assert.equal(index.sha256, digest(JSON.stringify(index.payload)));
    assert.equal(index.payload.length, manifest.pages.scopes);
    for (const entry of index.payload) for (const version of entry.versions) {
        const bytes = fs.readFileSync(safeFile(directory, version.path)); assert.equal(digest(bytes), version.sha256); assert.equal(bytes.length, version.bytes);
        const page = JSON.parse(bytes.toString()); assert.equal(page.path, entry.path); assert.deepEqual(page.query, entry.query); assert.equal(page.apiVersion, "2026-06-01"); assert.equal(page.status, 200); assert.ok(!Object.hasOwn(page, "headers"));
    }
    const chunks = (manifest.chunks ?? []).map(chunk => { const bytes = fs.readFileSync(safeFile(directory, chunk.path)); assert.equal(digest(bytes), chunk.sha256); assert.equal(bytes.length, chunk.bytes); return { phase: chunk.phase, sha256: chunk.sha256, raw: JSON.parse(bytes.toString()) }; });
    const files = fs.existsSync(path.join(directory, "files.json")) ? json(path.join(directory, "files.json")).payload : undefined;
    for (const row of files?.manifest.files ?? []) if (row.state === "saved") { const bytes = fs.readFileSync(safeFile(directory, row.receipt.path)); assert.equal(digest(bytes), row.receipt.sha256); assert.equal(bytes.length, row.receipt.size); }
    assert.equal(fs.existsSync(path.join(directory, ".export.lock")), false);
    return { manifest, raw, chunks, files, pages: index.payload };
}
const canonicalRows = rows => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
function assertFull(oracle) {
    assert.equal(oracle.manifest.sourceStatus, "complete"); assert.equal(oracle.manifest.importReady, true); assert.equal(oracle.raw.hasNext, false); assert.equal(oracle.chunks.length, 3);
    assert.deepEqual(oracle.chunks.map(chunk => chunk.phase), ["contacts", "conversations", "messages"]);
    for (const kind of ["users", "managers", "bots", "userChats", "messages"]) assert.deepEqual(canonicalRows(oracle.raw[kind]), canonicalRows(fixture.bundle[kind]), kind + " full raw rows");
    for (const chunk of oracle.chunks) {
        assert.equal(chunk.raw.hasNext, false);
        for (const kind of ["users", "managers", "bots", "userChats", "messages"]) {
            const included = kind === "users" || chunk.phase === "messages" || (kind === "userChats" && chunk.phase === "conversations");
            assert.deepEqual(canonicalRows(chunk.raw[kind]), canonicalRows(included ? fixture.bundle[kind] : []), chunk.phase + " chunk " + kind + " exact original IDs and fields");
        }
    }
    assert.equal(oracle.manifest.sourceCounts.users, 3); assert.equal(oracle.manifest.sourceCounts.userChats, 6); assert.equal(oracle.manifest.sourceCounts.messages, 20);
    const privateMessage = oracle.raw.messages.find(message => message.id === "qa-open-private"); assert.deepEqual(privateMessage.options, ["private"]); assert.equal(privateMessage.thread.id, "qa-private-thread");
    assert.equal(oracle.files.status, "complete"); assert.equal(oracle.files.counts.saved, 2); assert.equal(oracle.files.counts.savedBytes, 102); assert.equal(oracle.files.manifest.files.filter(row => row.visibility === "private").length, 1);
    assert.deepEqual(oracle.files.manifest.files.map(row => row.receipt.sha256).sort(), fixture.downloads.map(row => digest(Buffer.from(row.base64, "base64"))).sort());
    assert.equal(oracle.files.manifest.files.find(row => row.visibility === "private").kind, "note"); assert.equal(oracle.files.manifest.files.find(row => row.visibility === "public").kind, "reply");
    const states = oracle.pages.filter(page => page.path === "/open/user-chats").map(page => page.query.state); assert.deepEqual(new Set(states), new Set(fixture.states));
}
function copyOutput(source, label) {
    const destination = path.join(qaRoot, label); assert.ok(destination.startsWith(qaRoot + path.sep)); assert.equal(fs.existsSync(destination), false); fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false }); return destination;
}
async function check(name, work) {
    try { const detail = await work(); checks.push({ name, passed: true, detail }); console.log("PASS CHANNEL CLI " + checks.length + " " + name); }
    catch (error) { checks.push({ name, passed: false, error: error.message, stack: error.stack }); console.error("FAIL CHANNEL CLI " + checks.length + " " + name + ": " + error.message); }
}
const completeDir = path.join(qaRoot, "complete");
async function main() {
    await check("실제 node CLI --help는 환경·계정 접근 없이 사용법만 표시", () => { const result = run("help", ["--help"], 0); assert.ok(result.stdout.includes("Offline:")); assert.ok(result.stdout.includes("--run")); return { exitCode: result.exitCode }; });
    let full;
    await check("실제 CLI argv·별도 cwd·정상 export·rawpage·3chunks·102bytes·private 원본 디스크 해시", () => { const result = run("complete", common(completeDir), 0); assert.equal(result.summary.status, "complete"); assert.equal(result.summary.migrationApplied, false); full = diskOracle(completeDir); assertFull(full); return { sourceCounts: result.summary.sourceCounts, chunks: full.chunks.length, files: full.files.counts, rawPages: full.manifest.pages }; });
    await check("완료한 디스크 checkpoint 재개는 bytes 재다운로드0·검증2이며 full oracle 불변", () => { const result = run("complete-resume", common(completeDir, ["--resume"]), 0), next = diskOracle(completeDir); assertFull(next); assert.equal(result.summary.files.counts.downloaded, 0); assert.equal(result.summary.files.counts.verifiedFromResume, 2); assert.equal(result.summary.files.counts.sourceRequests, 0); assert.equal(next.manifest.raw.sha256, full.manifest.raw.sha256); assert.deepEqual(next.chunks.map(chunk => chunk.sha256), full.chunks.map(chunk => chunk.sha256)); return result.summary.files.counts; });
    await check("max-requests5 중단은 importer 준비 불가이며 같은 identity의 실제 CLI resume가 full oracle과 일치", () => { const out = path.join(qaRoot, "partial"), first = run("partial", common(out, ["--max-requests", "5"]), 2), incomplete = diskOracle(out); assert.equal(first.summary.status, "incomplete"); assert.equal(incomplete.manifest.importReady, false); assert.equal(incomplete.chunks.length, 0); const result = run("partial-resume", common(out, ["--resume"]), 0), next = diskOracle(out); assertFull(next); assert.equal(next.manifest.raw.sha256, full.manifest.raw.sha256); assert.deepEqual(next.chunks.map(chunk => chunk.sha256), full.chunks.map(chunk => chunk.sha256)); assert.deepEqual(next.files.manifest.files.map(row => row.receipt.sha256).sort(), full.files.manifest.files.map(row => row.receipt.sha256).sort()); return { partialStatus: first.summary.status, resumedStatus: result.summary.status, fullOracleMatch: true }; });
    await check("channel·namespace·pageSize·workspace identity 불일치는 원본 출력 디렉터리를 변경하지 않음", () => { const before = digest(fs.readFileSync(path.join(completeDir, "manifest.json"))); const names = [["--channel-id", "wrong-fictional-channel"], ["--namespace", "wrong-fictional-namespace"], ["--page-size", "3"], ["--workspace-id", "10"]]; for (const [flag, value] of names) { const args = common(completeDir, ["--resume"]), position = args.indexOf(flag); args[position + 1] = value; const result = run("identity-" + flag.slice(2), args, 1); assert.equal(result.summary.code, "identity"); assert.equal(digest(fs.readFileSync(path.join(completeDir, "manifest.json"))), before); } return { rejected: names.map(([flag]) => flag) }; });
    await check("응답의 foreign channel은 신규·완료재개에서 import 차단하고 foreign profile page를 보관하지 않음", () => {
        const foreignId = "foreign-fictional-channel", file = path.join(qaRoot, "foreign-response-fixture.json");
        fs.writeFileSync(file, JSON.stringify({ fictional: true, channelId: fixture.channelId, responses: [{ path: "/open/channel", query: {}, status: 200, body: { channel: { id: foreignId, name: "허구 타 채널 보관 금지" } } }] }));
        const detail = [];
        for (const resume of [false, true]) {
            const out = resume ? copyOutput(completeDir, "foreign-resume") : path.join(qaRoot, "foreign-new");
            const oldIndex = resume ? digest(fs.readFileSync(path.join(out, "pages-index.json"))) : null;
            const args = common(out, resume ? ["--resume"] : []); args[args.indexOf("--fixture") + 1] = file;
            const result = run(resume ? "foreign-channel-resume" : "foreign-channel-new", args, 2), manifest = json(path.join(out, "manifest.json")), checkpoint = json(path.join(out, "checkpoint.json"));
            assert.equal(result.summary.status, "failed"); assert.equal(manifest.importReady, false); assert.equal(checkpoint.payload.failure.code, "channel_mismatch");
            const indexPath = path.join(out, "pages-index.json"), pages = fs.existsSync(indexPath) ? json(indexPath).payload : [];
            for (const page of pages) for (const version of page.versions) assert.ok(!fs.readFileSync(safeFile(out, version.path), "utf8").includes(foreignId));
            if (resume) assert.equal(digest(fs.readFileSync(indexPath)), oldIndex); else assert.equal(pages.length, 0);
            assert.equal(fs.existsSync(path.join(out, ".export.lock")), false); detail.push({ resume, status: result.summary.status, failure: checkpoint.payload.failure.code, foreignPages: 0, priorPagesUnchanged: resume });
        }
        return detail;
    });
    await check("owner 출력 충돌 및 중복 CLI 옵션은 명확히 거절", () => { const collision = run("owner-collision", common(completeDir), 1); assert.equal(collision.summary.code, "collision"); const repeated = run("duplicate-argument", common(path.join(qaRoot, "duplicate-argument"), ["--namespace", "duplicate"]), 1); assert.equal(repeated.summary.code, "arguments"); return { collision: collision.summary.code, duplicate: repeated.summary.code }; });
    await check("동일 원본 ID의 상충 fixture는 source failed·importReady false", () => { const altered = structuredClone(fixture); altered.bundle.userChats.push({ ...altered.bundle.userChats[0], title: "허구 상충 제목" }); const file = path.join(qaRoot, "conflicting-fixture.json"); fs.writeFileSync(file, JSON.stringify(altered)); const args = common(path.join(qaRoot, "conflict")); args[args.indexOf("--fixture") + 1] = file; const result = run("conflicting-fixture", args, 2); assert.equal(result.summary.status, "failed"); const manifest = json(path.join(qaRoot, "conflict/manifest.json")); assert.equal(manifest.importReady, false); return { status: result.summary.status, importReady: manifest.importReady }; });
    await check("미완료 bundle fixture는 hasNext·nextCursor·next를 검증하고 output 생성 전에 거절", () => {
        const rejected = [];
        for (const [key, value] of [["hasNext", true], ["nextCursor", "fictional-more"], ["next", "fictional-more"]]) {
            const altered = structuredClone(fixture); altered.bundle[key] = value;
            const label = "incomplete-fixture-" + key, file = path.join(qaRoot, label + ".json"), out = path.join(qaRoot, label); fs.writeFileSync(file, JSON.stringify(altered));
            const args = common(out); args[args.indexOf("--fixture") + 1] = file; const result = run(label, args, 1);
            assert.equal(result.summary.code, "source_incomplete"); assert.equal(fs.existsSync(out), false);
            rejected.push({ key, exitCode: result.exitCode, code: result.summary.code, outputCreated: false });
        }
        return rejected;
    });
    await check("raw page 손상은 resume 전에 hash 검증으로 거절하고 덮어쓰지 않음", () => { const out = copyOutput(completeDir, "corrupt-page"), index = json(path.join(out, "pages-index.json")), file = safeFile(out, index.payload[0].versions[0].path); fs.appendFileSync(file, "\nfictional corruption"); const corrupted = digest(fs.readFileSync(file)); const result = run("corrupt-page", common(out, ["--resume"]), 1); assert.equal(result.summary.code, "checkpoint"); assert.equal(digest(fs.readFileSync(file)), corrupted); return { code: result.summary.code, corruptedFileUnchanged: true }; });
    await check("checkpoint payload 손상은 checksum 검증으로 resume 거절", () => { const out = copyOutput(completeDir, "corrupt-checkpoint"), file = path.join(out, "checkpoint.json"), state = json(file); state.payload.bundle.users[0].profile.name = "허구 손상 이름"; fs.writeFileSync(file, JSON.stringify(state)); const corrupted = digest(fs.readFileSync(file)); const result = run("corrupt-checkpoint", common(out, ["--resume"]), 1); assert.equal(result.summary.code, "checkpoint"); assert.equal(digest(fs.readFileSync(file)), corrupted); return { code: result.summary.code, corruptedFileUnchanged: true }; });
    await check("bytes 손상 후 resume는 조용한 덮어쓰기·파일완료 없이 files incomplete로 보고", () => { const out = copyOutput(completeDir, "corrupt-bytes"), receipt = json(path.join(out, "files.json")).payload.manifest.files[0].receipt, file = safeFile(out, receipt.path), data = fs.readFileSync(file); data[0] ^= 255; fs.writeFileSync(file, data); const corrupted = digest(data), result = run("corrupt-bytes", common(out, ["--resume"]), 2), manifest = json(path.join(out, "manifest.json")), files = json(path.join(out, "files.json")).payload; assert.equal(result.summary.status, "complete"); assert.equal(manifest.files.status, "incomplete"); assert.equal(files.counts.saved, 1); assert.equal(files.counts.failed, 1); assert.equal(digest(fs.readFileSync(file)), corrupted); return { sourceStatus: result.summary.status, filesStatus: files.status, failed: files.counts.failed, corruptedBytesUnchanged: true }; });
    await check("실계정 --run은 기본 꺼짐·fixture와 혼합 거절·키 없는 격리 환경에서 호출 전 실패", () => { const without = ["--out", path.join(qaRoot, "no-mode"), "--channel-id", fixture.channelId, "--namespace", "fictional-cli-qa", "--workspace-id", "8"]; assert.equal(run("no-run-default", without, 1).summary.code, "arguments"); assert.equal(run("mixed-run-fixture", common(path.join(qaRoot, "mixed"), ["--run"]), 1).summary.code, "arguments"); const missing = run("run-no-credentials", [...without.map(value => value === path.join(qaRoot, "no-mode") ? path.join(qaRoot, "missing-credentials") : value), "--run"], 1); assert.equal(missing.summary.code, "credentials"); assert.equal(fs.existsSync(path.join(qaRoot, "missing-credentials")), false); return { actualRunExecuted: false, actualCredentialVariablesForwarded: false, missingCode: missing.summary.code }; });
    const afterHashes = sourceHashes(), failed = checks.filter(check => !check.passed);
    const result = { checkedAt: new Date().toISOString(), environment: "fictional offline CLI children with OS-only allowlisted environment; all fetch/http/https/net/tls/DNS/Socket.connect and local IPC denied", qaRoot, actualNetworkRequests: 0, actualLocalIpcConnections: 0, nativeNetworkAttempts: commands.reduce((sum, command) => sum + (command.network?.nativeNetworkAttempts ?? 0), 0), deniedTsxLocalIpcAttempts: commands.reduce((sum, command) => sum + (command.network?.deniedTsxLocalIpcAttempts ?? 0), 0), checks, commands, sourceHashesBefore: beforeHashes, sourceHashesAfter: afterHashes, sourceStable: JSON.stringify(beforeHashes) === JSON.stringify(afterHashes), preservedEvidenceDirectory: true, recursivelyDeletedFiles: false, limitations: ["No real Channel account, credentials, customer data, API/server/DB access or deployment was tested.", "CLI disk/argv behavior is verified against a declared fictional bundle, not source account permissions or retention.", "Only the exact parent-PID tsx named-pipe probe with the installed client CJS caller is counted separately; every such probe is also denied, with no network or IPC connections permitted."] };
    fs.writeFileSync(path.join(qaRoot, "result.json"), JSON.stringify(result, null, 2));
    console.log("CLI evidence: " + path.join(qaRoot, "result.json")); console.log(`Offline Channel CLI QA ${checks.length - failed.length}/${checks.length} passed; native network attempts ${result.nativeNetworkAttempts}; denied exact tsx IPC probes ${result.deniedTsxLocalIpcAttempts}; actual IPC connections ${result.actualLocalIpcConnections}.`);
    if (failed.length || !result.sourceStable) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
