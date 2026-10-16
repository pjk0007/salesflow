import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPresence, sendPresence, saveAvailability } from "./index";
test("접속 조회/갱신/상태 변경 시간 초과는 한국어 복구 안내를 반환", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
        throw Object.assign(new Error("raw timeout"), { name: "TimeoutError" });
    });
    await assert.rejects(
        () => loadPresence("/api/inbox-presence?channelId=1"),
        /접속 상태 확인이 지연/,
    );
    await assert.rejects(
        () =>
            sendPresence({
                channelId: 1,
                sessionId: "00000000-0000-4000-8000-000000000001",
                sequence: 1,
                conversationId: null,
                activity: "viewing",
                leave: false,
            }),
        /접속 상태 확인이 지연/,
    );
    await assert.rejects(
        () => saveAvailability({ channelId: 1, version: 0, state: "away" }),
        /접속 상태 확인이 지연/,
    );
});
test("접속 API의 권한 오류는 시간 초과로 덮지 않고 원래 상태/안내 보존", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
        Response.json(
            { success: false, error: "이 사업의 접근 권한이 없습니다." },
            { status: 403 },
        ),
    );
    await assert.rejects(
        () => loadPresence("/api/inbox-presence?channelId=1"),
        (error: Error & { status?: number }) =>
            error.status === 403 &&
            error.message === "이 사업의 접근 권한이 없습니다.",
    );
});
