import { test } from "node:test";
import assert from "node:assert/strict";
import { apiRequest, defaultFetcher, RequestError } from "./swr-fetcher";

test("성공 응답 전체와 빈 목록·페이지 정보의 계약을 유지한다", async () => {
    const original = global.fetch;
    try {
        for (const body of [
            { success: true, data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 },
            { success: true, data: [{ id: 1 }], total: 4, page: 2, pageSize: 1, totalPages: 4 },
            { data: { enabled: false } },
        ]) {
            global.fetch = async () => Response.json(body);
            assert.deepEqual(await defaultFetcher("/fixture"), body);
        }
    } finally { global.fetch = original; }
});

test("HTTP 오류와 HTTP 200 논리 오류를 상태가 있는 한국어 예외로 전달한다", async () => {
    const original = global.fetch;
    try {
        for (const status of [200, 401, 403, 409, 500]) {
            global.fetch = async () => Response.json({ success: false, error: "접근 권한이 없습니다." }, { status });
            await assert.rejects(defaultFetcher("/fixture"), cause =>
                cause instanceof RequestError && cause.status === status && cause.message === "접근 권한이 없습니다.");
        }
        global.fetch = async () => Response.json({ success: true, data: [] }, { status: 500 });
        await assert.rejects(defaultFetcher("/fixture"), cause => cause instanceof RequestError && cause.status === 500);
    } finally { global.fetch = original; }
});

test("HTML·잘린 JSON·영어·SQL 원문을 사용자에게 노출하지 않는다", async () => {
    const original = global.fetch;
    try {
        for (const status of [200, 502, 504]) {
            for (const body of ["<html>gateway error</html>", "{\"success\":"]) {
                global.fetch = async () => new Response(body, { status });
                await assert.rejects(defaultFetcher("/fixture"), cause => cause instanceof RequestError && cause.message === "서버 응답을 읽지 못했습니다." && cause.status === status);
            }
        }
        for (const error of ["Not found", "Failed query: update users (오류)", null]) {
            global.fetch = async () => Response.json({ success: false, error });
            await assert.rejects(defaultFetcher("/fixture"), { message: "요청을 처리하지 못했습니다." });
        }
    } finally { global.fetch = original; }
});

test("네트워크 오류는 한국어이며 변경 요청은 자동 재전송하지 않는다", async () => {
    const original = global.fetch;
    let calls = 0;
    global.fetch = async () => { calls++; throw new TypeError("Failed to fetch"); };
    try {
        await assert.rejects(apiRequest("/fixture", { method: "POST" }), cause =>
            cause instanceof RequestError && cause.status === 0 && cause.message.includes("변경 여부"));
        assert.equal(calls, 1);
    } finally { global.fetch = original; }
});

test("헤더·본문 지연 모두 시간 제한을 지키고 요청을 중단한다", async () => {
    const original = global.fetch;
    try {
        for (const phase of ["headers", "body"]) {
            let signal: AbortSignal | undefined;
            global.fetch = async (_url, options) => {
                signal = options?.signal as AbortSignal;
                if (phase === "headers") return new Promise<Response>(() => {});
                return { ok: true, status: 200, json: () => new Promise(() => {}) } as Response;
            };
            await assert.rejects(apiRequest("/fixture", undefined, 10), cause => cause instanceof RequestError && cause.status === 408);
            assert.equal(signal?.aborted, true);
        }
    } finally { global.fetch = original; }
});

test("사용자 중단의 AbortError와 업로드·사용자 헤더를 보존한다", async () => {
    const original = global.fetch;
    try {
        const controller = new AbortController();
        global.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
        const pending = apiRequest("/fixture", { signal: controller.signal });
        controller.abort(new DOMException("취소되었습니다.", "AbortError"));
        await assert.rejects(pending, { name: "AbortError" });
        const body = new FormData();
        body.set("file", new File(["fixture"], "sample.txt"));
        global.fetch = async (_url, options) => {
            assert.equal(options?.body, body);
            assert.equal(new Headers(options?.headers).get("X-Test"), "preserved");
            assert.equal(new Headers(options?.headers).has("Content-Type"), false);
            return Response.json({ success: true, data: 1 });
        };
        await apiRequest("/fixture", { method: "POST", body, headers: { "X-Test": "preserved" } });
    } finally { global.fetch = original; }
});
