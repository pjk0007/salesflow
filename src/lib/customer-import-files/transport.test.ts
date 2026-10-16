import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { request } from "node:https";
import type { lookup } from "node:dns/promises";
import { resolveWebhookAddress } from "@/lib/customer-platform/webhook-transport";
import { createImportFileTransport, FileFetchError } from "./transport";
import { sourceFileUrl, fileDescriptors } from "./rules";
type Reply = {
    status?: number;
    headers?: Record<string, string>;
    chunks?: Buffer[];
    interrupted?: boolean;
};
function fakeWire(replies: Reply[]) {
    const observations: { host: string; headers: unknown; address: unknown }[] =
        [];
    const wire = ((
        _url: URL,
        options: Parameters<typeof request>[1],
        callback: (r: unknown) => void,
    ) => {
        const config = options as {
            headers: unknown;
            lookup: (
                host: string,
                opts: object,
                cb: (...args: unknown[]) => void,
            ) => void;
        };
        config.lookup(_url.hostname, {}, (_err, address) =>
            observations.push({
                host: _url.hostname,
                headers: config.headers,
                address,
            }),
        );
        const req = new EventEmitter() as EventEmitter & { end: () => void };
        req.end = () =>
            queueMicrotask(() => {
                const value = replies.shift();
                if (!value) throw new Error("unexpected request");
                const res = Readable.from(
                    value.chunks ?? [Buffer.from("qa")],
                ) as Readable & { statusCode: number; headers: object };
                res.statusCode = value.status ?? 200;
                res.headers = value.headers ?? {};
                callback(res);
                if (value.interrupted) res.emit("aborted");
            });
        return req;
    }) as typeof request;
    return {
        request: wire,
        observations,
        resolve: async () => ({ address: "8.8.8.8", family: 4 }),
    };
}
test("서명 쿼리는 보존하고 사설·계정·비 HTTPS 주소 거절", () => {
    assert.equal(
        sourceFileUrl("https://files.example.com/a?signature=qa"),
        "https://files.example.com/a?signature=qa",
    );
    for (const url of [
        "http://files.example.com/x",
        "https://127.0.0.1/x",
        "https://[::1]/",
        "https://service.internal/x",
        "https://localhost/x",
        "https://user:pass@example.com/x",
        "https://example.com:444/x",
        "https://example.com/x#hash",
    ])
        assert.throws(() => sourceFileUrl(url));
});
test("다운로드는 확인한 DNS 주소에 고정하고 자격정보 없이 바이트 수신", async () => {
    const wire = fakeWire([
        { chunks: [Buffer.from("one"), Buffer.from("two")] },
    ]);
    assert.equal(
        (
            await createImportFileTransport(wire)(
                "https://files.example.com/a?signature=fake",
            )
        ).toString(),
        "onetwo",
    );
    assert.equal(wire.observations[0].address, "8.8.8.8");
    assert.ok(
        !JSON.stringify(wire.observations[0].headers)
            .toLowerCase()
            .includes("authorization"),
    );
    assert.ok(
        !JSON.stringify(wire.observations[0].headers)
            .toLowerCase()
            .includes("cookie"),
    );
});
test("이동할 때마다 DNS 재확인, 상대 주소 지원, 최대 3회 이동", async () => {
    const wire = fakeWire([
        { status: 302, headers: { location: "/next" } },
        { status: 307, headers: { location: "https://cdn.example.com/final" } },
        {},
    ]);
    assert.equal(
        (
            await createImportFileTransport(wire)(
                "https://files.example.com/start",
            )
        ).toString(),
        "qa",
    );
    assert.deepEqual(
        wire.observations.map((o) => o.host),
        ["files.example.com", "files.example.com", "cdn.example.com"],
    );
    const endless = fakeWire(
        Array.from({ length: 4 }, () => ({
            status: 302,
            headers: { location: "/again" },
        })),
    );
    await assert.rejects(
        createImportFileTransport(endless)("https://files.example.com/start"),
        /이동 횟수/,
    );
});
test("이동 주소가 사설망이면 연결 전에 거절하고 혼합 DNS도 거절", async () => {
    const wire = fakeWire([
        { status: 302, headers: { location: "https://127.0.0.1/metadata" } },
    ]);
    await assert.rejects(
        createImportFileTransport(wire)("https://files.example.com/start"),
    );
    assert.equal(wire.observations.length, 1);
    const lookupFake = (async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
    ]) as unknown as typeof lookup;
    await assert.rejects(
        resolveWebhookAddress("files.example.com", lookupFake),
        /공개 네트워크/,
    );
});
test("원본의 401·403·404·410은 주소 재발급 상태로 구분", async () => {
    for (const status of [401, 403, 404, 410])
        await assert.rejects(
            createImportFileTransport(fakeWire([{ status }]))(
                "https://files.example.com/file",
            ),
            (e: unknown) => e instanceof FileFetchError && e.needsSource,
        );
    await assert.rejects(
        createImportFileTransport(fakeWire([{ status: 500 }]))(
            "https://files.example.com/file",
        ),
        (e: unknown) => e instanceof FileFetchError && !e.needsSource,
    );
});
test("헤더 또는 스트림이 20MiB 초과하면 저장할 바이트를 반환하지 않음", async () => {
    await assert.rejects(
        createImportFileTransport(
            fakeWire([{ headers: { "content-length": "20971521" } }]),
        )("https://files.example.com/file"),
        /크기/,
    );
    await assert.rejects(
        createImportFileTransport(
            fakeWire([{ chunks: [Buffer.alloc(20971520), Buffer.from("x")] }]),
        )("https://files.example.com/file"),
        /20MB|중단/,
    );
});
test("빈 파일·압축·잘린 전송은 완료로 취급하지 않음", async () => {
    for (const reply of [
        { chunks: [] },
        { headers: { "content-encoding": "gzip" } },
        { interrupted: true },
    ])
        await assert.rejects(
            createImportFileTransport(fakeWire([reply]))(
                "https://files.example.com/file",
            ),
        );
});
test("요청별 남은 바이트 예산은 헤더와 스트림에 적용하며 기본 상한을 늘릴 수 없음", async () => {
    for (const reply of [
        { headers: { "content-length": "4" } },
        { chunks: [Buffer.from("ab"), Buffer.from("cd")] },
    ])
        await assert.rejects(
            createImportFileTransport({ ...fakeWire([reply]), maxBytes: 3 })("https://files.example.com/file"),
            /크기|허용량|중단/,
        );
    assert.equal((await createImportFileTransport({ ...fakeWire([{ chunks: [Buffer.from("abc")] }]), maxBytes: 3 })("https://files.example.com/file")).toString(), "abc");
    for (const maxBytes of [0, -1, 1.5, 20971521])
        assert.throws(() => createImportFileTransport({ maxBytes }), /허용량/);
});
test("외부 중단은 연결 전과 멈춘 DNS 조회 중에도 종료", async () => {
    const before = new AbortController();
    before.abort();
    const wire = fakeWire([]);
    await assert.rejects(createImportFileTransport({ ...wire, signal: before.signal })("https://files.example.com/file"));
    assert.equal(wire.observations.length, 0);
    const during = new AbortController();
    const pending = createImportFileTransport({
        signal: during.signal,
        resolve: () => new Promise(() => {}),
    })("https://files.example.com/file");
    during.abort();
    await assert.rejects(pending, FileFetchError);
});
test("DNS 응답이 멈춰도 전체 제한 시간 뒤 실패", async () => {
    const keepAlive = setTimeout(() => {}, 500);
    try {
        await assert.rejects(
            createImportFileTransport({
                timeoutMs: 10,
                resolve: () => new Promise(() => {}),
            })("https://files.example.com/file"),
            /시간/,
        );
    } finally {
        clearTimeout(keepAlive);
    }
});
test("파일 식별은 주소 만료와 독립, 정보 변경은 새 버전, 같은 이름도 원본 ID로 구분", () => {
    const first = fileDescriptors([
            {
                id: "f",
                name: "원본.pdf",
                size: 12,
                url: "https://files.example.com/a?token=one",
            },
        ])[0],
        rotated = fileDescriptors([
            {
                id: "f",
                name: "원본.pdf",
                size: 12,
                url: "https://files.example.com/a?token=two",
            },
        ])[0],
        changed = fileDescriptors([{ id: "f", name: "수정.pdf", size: 12 }])[0];
    assert.equal(first.sourceKey, rotated.sourceKey);
    assert.equal(first.manifest, rotated.manifest);
    assert.notEqual(first.manifest, changed.manifest);
    const distinct = fileDescriptors([
        { id: "a", name: "같은 이름" },
        { id: "b", name: "같은 이름" },
    ]);
    assert.notEqual(distinct[0].sourceKey, distinct[1].sourceKey);
});
test("채널톡 키·인터컴 filesize·보관 JSON의 해시와 잘못된 메타데이터 보존", () => {
    const descriptors = fileDescriptors([
        { key: "pub-file/qa/image.png", name: "이미지.png", size: 1 },
        {
            name: "원본.pdf",
            filesize: 12,
            url: "https://files.example.com/pdf",
            content_type: "application/pdf",
        },
        { name: "나쁜 크기", size: -1 },
        { name: "나쁜 해시", sha256: "bad" },
    ]);
    assert.equal(descriptors[0].locator.key, "pub-file/qa/image.png");
    assert.equal(descriptors[0].url, null);
    assert.equal(descriptors[1].size, 12);
    assert.ok(descriptors[2].invalid);
    assert.ok(descriptors[3].invalid);
    const boolSize = fileDescriptors([{ name: "file", size: true }])[0];
    assert.ok(boolSize.invalid);
    assert.notEqual(
        boolSize.manifest,
        fileDescriptors([{ name: "file", size: 1 }])[0].manifest,
    );
    assert.ok(fileDescriptors([{ name: "file", sha256: 123 }])[0].invalid);
});
