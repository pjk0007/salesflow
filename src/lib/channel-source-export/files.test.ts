import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { backupChannelFiles, type ChannelFileBackupOptions, type ChannelFileManifest, type ChannelFileReceipt } from "./files";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import { ChannelSourceHttpError } from "./http";
const pdf = Buffer.from("%PDF-1.4\nfictional backup only\n%%EOF");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function source<T = Record<string, unknown>>(files: T[] = [{ id: "file-1", key: "private-source-key", name: "private-original-name.pdf", size: pdf.length, contentType: "application/pdf", sha256: hash(pdf) }] as unknown as T[]) {
    return { users: [], managers: [], userChats: [], bots: [], hasNext: false, messages: [{ id: "private-message-id", chatId: "private-chat-id", personType: "user", plainText: "private customer message", files }] };
}
function fixture(overrides: Partial<ChannelFileBackupOptions> = {}) {
    const calls = { requests: 0, downloads: [] as string[], saves: 0, verifies: 0, sleeps: [] as number[] };
    const storage = new Map<string, Buffer>();
    const checkpoints: ChannelFileManifest[] = [];
    const options: ChannelFileBackupOptions = {
        channelId: "fictional-channel",
        request: async request => {
            calls.requests++;
            assert.equal(request.method, "GET");
            assert.equal(request.path, "/open/user-chats/private-chat-id/messages/file");
            assert.equal(request.query.key, "private-source-key");
            assert.deepEqual(request.headers, { "Channel-Version": "2026-06-01" });
            return { status: 200, body: { result: `https://files.example.test/backup.pdf?token=signed-private-${calls.requests}` } };
        },
        download: async (url, options) => {
            calls.downloads.push(url);
            assert.ok(options.signal);
            assert.ok(options.maxBytes <= MAX_FILE_BYTES);
            return Buffer.from(pdf);
        },
        save: async (bytes, metadata) => {
            calls.saves++;
            assert.equal(metadata.sha256, hash(bytes));
            assert.equal(metadata.size, bytes.length);
            const receipt = { path: `bytes/${metadata.sha256}.bin`, size: bytes.length, sha256: metadata.sha256 };
            storage.set(receipt.path, Buffer.from(bytes));
            return receipt;
        },
        verify: async receipt => {
            calls.verifies++;
            const bytes = storage.get(receipt.path);
            return !!bytes && bytes.length === receipt.size && hash(bytes) === receipt.sha256;
        },
        checkpoint: async manifest => { checkpoints.push(manifest); },
        sleep: async ms => { calls.sleeps.push(ms); },
        limits: { retryBaseMs: 0, maxRetryDelayMs: 0, operationTimeoutMs: 1000, requestTimeoutMs: 1000 },
        ...overrides,
    };
    return { options, calls, storage, checkpoints };
}
test("메타데이터와 검증저장 바이트 수를 분리하고 manifest에 key/URL/본문/파일명/locator 미포함", async () => {
    const f = fixture(), result = await backupChannelFiles(source(), f.options);
    assert.equal(result.status, "complete");
    assert.equal(result.counts.metadataFiles, 1);
    assert.equal(result.counts.saved, 1);
    assert.equal(result.counts.savedBytes, pdf.length);
    assert.equal(result.manifest.files[0].contentType, "application/pdf");
    assert.equal(result.manifest.files[0].visibility, "public");
    const persisted = JSON.stringify([result.manifest, f.checkpoints]);
    for (const value of ["private-source-key", "private-original-name.pdf", "private customer message", "private-message-id", "private-chat-id", "signed-private", "https://"])
        assert.ok(!persisted.includes(value), value);
    assert.ok(result.limitations.some(value => value.includes("별도")));
});
test("같은 원본ID 반복 occurrence를 분리하고 private note/public reply 구분", async () => {
    const bundle = source();
    bundle.messages[0].files.push({ ...bundle.messages[0].files[0] });
    bundle.messages.push({ ...bundle.messages[0], id: "private-note", personType: "manager", files: [{ ...bundle.messages[0].files[0] }], options: ["private"] } as typeof bundle.messages[number]);
    bundle.messages.push({ ...bundle.messages[0], id: "public-reply", personType: "bot", files: [{ ...bundle.messages[0].files[0] }] });
    const f = fixture(), result = await backupChannelFiles(bundle, f.options);
    assert.equal(result.status, "complete");
    assert.equal(new Set(result.manifest.files.map(row => row.id)).size, 4);
    assert.deepEqual(result.manifest.files.map(row => [row.kind,row.visibility]), [["customer","public"],["customer","public"],["note","private"],["reply","public"]]);
});
test("만료 다운로드 재시도는 매번 새 signedURL 조회, manifest에는 만료주소 미저장", async () => {
    const f = fixture();
    const download = f.options.download;
    let fail = true;
    f.options.download = async (url, options) => {
        if (fail) { fail = false; f.calls.downloads.push(url); throw { needsSource: true, message: "private expired URL" }; }
        return download(url, options);
    };
    const result = await backupChannelFiles(source(), f.options);
    assert.equal(result.status, "complete");
    assert.equal(f.calls.requests, 2);
    assert.notEqual(f.calls.downloads[0], f.calls.downloads[1]);
    assert.equal(result.manifest.files[0].attempts, 2);
    assert.ok(!JSON.stringify(result).includes("private expired URL"));
});
test("완료 receipt verify 성공 재개는 API·재다운로드·재저장0", async () => {
    const f = fixture(), bundle = source(), first = await backupChannelFiles(bundle, f.options);
    const before = structuredClone(f.calls);
    const resumed = await backupChannelFiles(bundle, { ...f.options, resume: first.manifest });
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.counts.verifiedFromResume, 1);
    assert.equal(resumed.counts.sourceRequests, 0);
    assert.equal(f.calls.requests, before.requests);
    assert.equal(f.calls.downloads.length, before.downloads.length);
    assert.equal(f.calls.saves, before.saves);
});
test("verify가 없거나 실패한 resume는 freshURL과 bytes를 다시 취득", async () => {
    for (const withVerify of [false,true]) {
        const f = fixture(), bundle = source(), first = await backupChannelFiles(bundle, f.options);
        if (withVerify) f.storage.clear();
        const resumed = await backupChannelFiles(bundle, { ...f.options, resume: first.manifest, verify: withVerify ? f.options.verify : undefined });
        assert.equal(resumed.status, "complete");
        assert.equal(resumed.counts.verifiedFromResume, 0);
        assert.equal(f.calls.requests, 2);
        assert.equal(f.calls.downloads.length, 2);
        assert.notEqual(f.calls.downloads[0], f.calls.downloads[1]);
    }
});
test("resume channel/source fingerprint/개별descriptor/receipt/중복 불일치는 조회 전 실패", async () => {
    const f = fixture(), bundle = source(), first = await backupChannelFiles(bundle, f.options);
    const mutations = [
        (m: ChannelFileManifest) => { m.channelId = "other-channel"; },
        (m: ChannelFileManifest) => { m.sourceFingerprint = "wrong"; },
        (m: ChannelFileManifest) => { m.files[0].descriptorHash = "wrong"; },
        (m: ChannelFileManifest) => { m.files[0].sourceKey = "wrong"; },
        (m: ChannelFileManifest) => { m.files[0].visibility = "private"; },
        (m: ChannelFileManifest) => { m.files[0].receipt!.path = "https://private.example.test/signed"; },
        (m: ChannelFileManifest) => { m.files[0].receipt!.size = 0; },
        (m: ChannelFileManifest) => { m.files.push(m.files[0]); },
    ];
    for (const mutate of mutations) {
        const resume = structuredClone(first.manifest); mutate(resume);
        const before = f.calls.requests;
        const result = await backupChannelFiles(bundle, { ...f.options, resume });
        assert.equal(result.status, "failed");
        assert.ok(result.manifest.issues.includes("invalid_resume"));
        assert.equal(f.calls.requests, before);
    }
    const changed = structuredClone(bundle); changed.messages[0].plainText = "changed raw message";
    const result = await backupChannelFiles(changed, { ...f.options, resume: first.manifest });
    assert.equal(result.status, "failed");
    assert.ok(result.manifest.issues.includes("invalid_resume"));
});
test("raw archive의 URL field 변경도 exact source fingerprint를 바꾸므로 재개 거절", async () => {
    const bundle = source(), f = fixture();
    Object.assign(bundle.messages[0].files[0], { url: "https://files.example.test/raw?token=one" });
    const first = await backupChannelFiles(bundle, f.options);
    Object.assign(bundle.messages[0].files[0], { url: "https://files.example.test/raw?token=two" });
    const result = await backupChannelFiles(bundle, { ...f.options, resume: first.manifest });
    assert.equal(result.status, "failed");
    assert.ok(result.manifest.issues.includes("invalid_resume"));
});
test("source incomplete/failed/aborted는 파일 저장 결과로 complete가 되지 않음", async () => {
    for (const state of ["incomplete","failed","aborted"] as const) {
        const f = fixture(), result = await backupChannelFiles(source(), { ...f.options, sourceStatus: state });
        assert.equal(result.status, state);
        assert.equal(result.manifest.sourceComplete, false);
        if (state === "aborted") assert.equal(f.calls.requests, 0);
    }
    const bundle = source(); bundle.hasNext = true;
    const result = await backupChannelFiles(bundle, fixture().options);
    assert.equal(result.status, "incomplete");
});
test("누락 key/원본ID·잘못된 metadata·20MiB 초과는 명시issue와 미완료", async () => {
    const cases = [
        { file: { id:"f",name:"x" }, issue:"missing_key" },
        { file: null, issue:"invalid_metadata" },
        { file: { key:"private-source-key",size:-1 }, issue:"invalid_metadata" },
        { file: { key:"private-source-key",sha256:"invalid" }, issue:"invalid_metadata" },
        { file: { key:"private-source-key",size:MAX_FILE_BYTES+1 }, issue:"file_too_large" },
    ];
    for (const value of cases) {
        const f = fixture(), result = await backupChannelFiles(source([value.file]), f.options);
        assert.equal(result.status, "incomplete");
        assert.equal(result.manifest.files[0].issue, value.issue);
        assert.equal(f.calls.requests, 0);
    }
    const bundle = source(); bundle.messages[0].id = "";
    const f = fixture(), result = await backupChannelFiles(bundle, f.options);
    assert.equal(result.manifest.files[0].issue, "missing_source_id");
    assert.equal(f.calls.requests,0);
});
test("잘못된 bundle/파일 배열/중복 source는 전체실패, 0개 완료와 구별", async () => {
    for (const bundle of [{hasNext:false},{hasNext:false,messages:[{files:{key:"private"}}]},null]) {
        const f=fixture(), result=await backupChannelFiles(bundle,f.options);
        assert.equal(result.status,"failed");
        assert.ok(result.manifest.issues.includes("invalid_bundle"));
        assert.equal(f.calls.requests,0);
    }
    const duplicate=source();duplicate.messages.push(duplicate.messages[0]);
    const result=await backupChannelFiles(duplicate,fixture().options);
    assert.equal(result.status,"failed");
    assert.ok(result.manifest.issues.includes("duplicate_source"));
    const empty=source([]), emptyResult=await backupChannelFiles(empty,fixture().options);
    assert.equal(emptyResult.status,"complete");
    assert.equal(emptyResult.counts.metadataFiles,0);
});
test("size/hash/known MIME 불일치는 저장하지 않고 manifest 실패", async () => {
    for (const patch of [{size:pdf.length+1},{sha256:"0".repeat(64)},{contentType:"image/png"}]) {
        const bundle=source();Object.assign(bundle.messages[0].files[0],patch);
        const f=fixture(), result=await backupChannelFiles(bundle,f.options);
        assert.equal(result.status,"incomplete");
        assert.equal(result.manifest.files[0].issue,"size" in patch?"size_mismatch":"sha256" in patch?"hash_mismatch":"mime_mismatch");
        assert.equal(f.calls.saves,0);
    }
});
test("알 수 없는 MIME는 opaque 바이트 보존과 명시경고, 확인된 PDF로 위장하지 않음", async () => {
    const bytes=Buffer.from("PK\u0003\u0004fictional zip bytes");
    const f=fixture({download:async()=>bytes}), bundle=source([{key:"private-source-key",contentType:"application/zip",size:bytes.length}]);
    const result=await backupChannelFiles(bundle,f.options);
    assert.equal(result.status,"complete");
    assert.equal(result.manifest.files[0].contentType,"application/octet-stream");
    assert.deepEqual(result.manifest.files[0].warnings,["mime_not_verified"]);
    const resumed=await backupChannelFiles(bundle,{...f.options,resume:result.manifest});
    assert.equal(resumed.counts.verifiedFromResume,1);
    assert.deepEqual(resumed.manifest.files[0].warnings,["mime_not_verified"]);
});
test("download가 제한을 무시한 bytes/빈 파일/Buffer 아닌 값은 완료 처리하지 않음", async () => {
    for (const bytes of [Buffer.alloc(0),pdf,new Uint8Array([1]) as unknown as Buffer]) {
        const bundle=source([{key:"private-source-key"}]), f=fixture({download:async()=>bytes,limits:{maxFileBytes:8}});
        const result=await backupChannelFiles(bundle,f.options);
        assert.equal(result.status,"incomplete");
        assert.equal(result.manifest.files[0].issue,bytes===pdf?"file_too_large":"invalid_bytes");
        assert.equal(f.calls.saves,0);
    }
});
test("maxFiles/totalBytes 초과는 숨겨서 완료하지 않고 더 이상 원본 조회하지 않음", async () => {
    const bundle=source();bundle.messages[0].files.push({...bundle.messages[0].files[0],id:"second"});
    const f=fixture({limits:{maxFiles:1}}), result=await backupChannelFiles(bundle,f.options);
    assert.equal(result.status,"failed");
    assert.ok(result.manifest.issues.includes("file_limit"));
    assert.equal(f.calls.requests,0);
    const g=fixture({limits:{maxTotalBytes:pdf.length+1}}), limited=await backupChannelFiles(bundle,g.options);
    assert.equal(limited.status,"incomplete");
    assert.equal(limited.counts.saved,1);
    assert.equal(limited.manifest.files[1].issue,"total_bytes_limit");
    assert.equal(g.calls.requests,1);
});
test("429/5xx의 허용된 Retry-After 최소대기를 지킨 뒤 bounded retry", async () => {
    for (const status of [429,503]) {
        const f=fixture({limits:{maxAttempts:2,maxRetryDelayMs:4}}), original=f.options.request;
        let first=true;
        f.options.request=async request=>{if(first){first=false;f.calls.requests++;return{status,headers:{"Retry-After":"0.004"},body:{message:"private upstream body"}}}return original(request)};
        const result=await backupChannelFiles(source(),f.options);
        assert.equal(result.status,"complete");
        assert.equal(f.calls.requests,2);
        assert.deepEqual(f.calls.sleeps,[4]);
        assert.ok(!JSON.stringify(result).includes("private upstream body"));
    }
});
test("너무 긴 Retry-After 숫자/date는 일찍 재시도하지 않고 같은채널 나머지 파일도 보류", async () => {
    for (const value of ["30", new Date(Date.now()+30000).toUTCString()]) {
        const bundle=source();bundle.messages[0].files.push({...bundle.messages[0].files[0],id:"second"});
        let calls=0;
        const f=fixture({limits:{maxRetryDelayMs:5000},request:async()=>{calls++;return{status:429,headers:{"Retry-After":value}}}});
        const result=await backupChannelFiles(bundle,f.options);
        assert.equal(result.status,"incomplete");
        assert.equal(result.manifest.files[0].issue,"retry_delay_limit");
        assert.equal(result.manifest.files[1].state,"pending");
        assert.equal(calls,1);
        assert.equal(f.calls.sleeps.length,0);
        assert.equal(f.calls.downloads.length,0);
    }
});
test("영구 API 오류/지원하지 않는 signedURL는 다운로드 없이 명시 실패", async () => {
    for (const [status,issue] of [[403,"source_denied"],[404,"source_missing"],[410,"source_missing"]] as const) {
        const f=fixture({request:async()=>({status,body:{message:"private server error"}})});
        const result=await backupChannelFiles(source(),f.options);
        assert.equal(result.manifest.files[0].issue,issue);
        assert.equal(f.calls.downloads.length,0);
        assert.ok(!JSON.stringify(result).includes("private server error"));
    }
    for(const url of ["http://127.0.0.1/private","https://10.0.0.1/private","https://user:secret@example.test/private","https://files.example.test/file#secret"]){
        const f=fixture({request:async()=>({status:200,body:{result:url}})}),result=await backupChannelFiles(source(),f.options);
        assert.equal(result.manifest.files[0].issue,"unsupported_url");
        assert.equal(f.calls.downloads.length,0);
        assert.ok(!JSON.stringify(result).includes(url));
    }
});
test("transport 계약/version 오류는 재시도하지 않고 timeout은 명시bounded 재시도", async () => {
    for(const kind of ["version","timeout"] as const){
        let calls=0;
        const f=fixture({request:async()=>{calls++;throw new ChannelSourceHttpError("private error details",kind)}});
        const result=await backupChannelFiles(source(),f.options);
        assert.equal(result.manifest.files[0].issue,kind==="version"?"source_contract_mismatch":"source_timeout");
        assert.equal(calls,kind==="version"?1:3);
        assert.ok(!JSON.stringify(result).includes("private error details"));
    }
});
test("반복 download 실패는 maxAttempts를 지키며 매번 signedURL 갱신", async () => {
    const f=fixture({download:async()=>{throw new Error("private failed signedURL")}}),result=await backupChannelFiles(source(),f.options);
    assert.equal(result.status,"incomplete");
    assert.equal(result.manifest.files[0].attempts,3);
    assert.equal(result.manifest.files[0].issue,"download_failed");
    assert.equal(f.calls.requests,3);
    assert.equal(f.calls.sleeps.length,2);
});
test("save 실패/틀린receipt/저장verify 실패는 완료로 표시하지 않음",async()=>{
    for(const kind of ["throw","receipt","verify"]){
        const f=fixture();
        if(kind==="throw")f.options.save=async()=>{throw new Error("private save path")};
        if(kind==="receipt")f.options.save=async()=>({path:"bytes/wrong.bin",sha256:"0".repeat(64),size:pdf.length});
        if(kind==="verify")f.options.verify=async()=>false;
        const result=await backupChannelFiles(source(),f.options);
        assert.equal(result.status,"incomplete");
        assert.equal(result.manifest.files[0].issue,kind==="throw"?"save_failed":kind==="receipt"?"receipt_invalid":"stored_verify_failed");
    }
});
test("중간 abort checkpoint는 완료 파일을 보존하고 resume에서 재다운로드0",async()=>{
    const bundle=source();bundle.messages[0].files.push({...bundle.messages[0].files[0],id:"second"});
    const controller=new AbortController(),f=fixture({signal:controller.signal}),download=f.options.download;
    let downloads=0;
    f.options.download=async(url,options)=>{if(++downloads===2){controller.abort("private reason");return new Promise<Buffer>(()=>{})}return download(url,options)};
    const result=await backupChannelFiles(bundle,f.options);
    assert.equal(result.status,"aborted");
    assert.equal(result.counts.saved,1);
    assert.equal(f.checkpoints.at(-1)?.files[0].state,"saved");
    assert.equal(f.checkpoints.at(-1)?.files[1].issue,"operation_aborted");
    const resumed=await backupChannelFiles(bundle,{...f.options,signal:undefined,resume:result.manifest,download});
    assert.equal(resumed.status,"complete");
    assert.equal(resumed.counts.verifiedFromResume,1);
    assert.equal(resumed.counts.downloaded,1);
    assert.ok(!JSON.stringify(result).includes("private reason"));
});
test("시작 전 abort와 파일0개 abort도 API 호출 없이 중단 표시",async()=>{
    const controller=new AbortController();controller.abort();
    for(const bundle of [source(),source([])]){
        const f=fixture({signal:controller.signal}),result=await backupChannelFiles(bundle,f.options);
        assert.equal(result.status,"aborted");
        assert.equal(f.calls.requests,0);
    }
});
test("checkpoint 실패는 더 이상 요청하지 않고 failed로 종료",async()=>{
    const f=fixture({checkpoint:async()=>{throw new Error("private filesystem path")}}),result=await backupChannelFiles(source(),f.options);
    assert.equal(result.status,"failed");
    assert.ok(result.manifest.issues.includes("checkpoint_failed"));
    assert.equal(f.calls.requests,0);
    assert.ok(!JSON.stringify(result).includes("private filesystem path"));
});
test("checkpoint가 받은 snapshot을 변조해도 진행중인 manifest와 원본bundle은 보존",async()=>{
    const bundle=source(),before=structuredClone(bundle),f=fixture({checkpoint:async manifest=>{if(manifest.files[0])manifest.files[0].descriptorHash="mutated"}});
    const result=await backupChannelFiles(bundle,f.options);
    assert.equal(result.status,"complete");
    assert.notEqual(result.manifest.files[0].descriptorHash,"mutated");
    assert.deepEqual(bundle,before);
});
test("멈춘request/download/save/checkpoint도 operation timeout 안에 끝남",async()=>{
    for(const kind of ["request","download","save","checkpoint"]){
        const f=fixture({limits:{maxAttempts:1,requestTimeoutMs:10,operationTimeoutMs:10}});
        if(kind==="request")f.options.request=()=>new Promise(()=>{});
        if(kind==="download")f.options.download=()=>new Promise(()=>{});
        if(kind==="save")f.options.save=()=>new Promise<ChannelFileReceipt>(()=>{});
        if(kind==="checkpoint")f.options.checkpoint=()=>new Promise<void>(()=>{});
        const result=await backupChannelFiles(source(),f.options);
        assert.equal(result.status,kind==="checkpoint"?"failed":"incomplete");
        if(kind!=="checkpoint")assert.equal(result.manifest.files[0].issue,kind==="request"?"source_timeout":kind==="download"?"download_timeout":"save_failed");
    }
});
