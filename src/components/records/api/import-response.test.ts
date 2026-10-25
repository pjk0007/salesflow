import test from "node:test";
import assert from "node:assert/strict";
import { readImportResponse, readScheduledUploadResponse } from "./import-response";

const success = { success: true, totalCount: 2, insertedCount: 1, skippedCount: 1, errors: [] };
function stream(parts: string[]) {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({ start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
    } }), { headers: { "content-type": "application/x-ndjson" } });
}

test("UX-068 정상·일부 중복·전부 중복과 마지막 개행 없는 완료 프레임을 읽는다", async () => {
    for (const result of [success, { ...success, insertedCount: 2, skippedCount: 0 }, { ...success, insertedCount: 0, skippedCount: 2 }]) {
        const progress: unknown[] = [];
        const data = `{"type":"progress","processed":1,"total":2}\n${JSON.stringify({ type: "done", result })}`;
        assert.deepEqual(await readImportResponse(stream([data.slice(0, 18), data.slice(18)]), (p) => progress.push(p)), result);
        assert.deepEqual(progress, [{ processed: 1, total: 2 }]);
    }
});

test("UX-068 HTTP 400/403·논리 실패·서버 롤백은 성공 결과가 되지 않는다", async () => {
    for (const status of [400, 403]) {
        await assert.rejects(readImportResponse(Response.json({ success: false, error: "등록 권한이 없습니다." }, { status })), /등록 권한/);
    }
    await assert.rejects(readImportResponse(stream(['{"type":"error","error":"서버 오류가 발생했습니다."}\n'])), /서버 오류/);
    await assert.rejects(readImportResponse(Response.json({ success: false, error: "가져오기 실패" })), /가져오기 실패/);
});

test("UX-068 응답 단절·잘린 JSON·완료 없이 끝남은 결과 미확인으로 실패한다", async () => {
    await assert.rejects(readImportResponse(stream(['{"type":"progress","processed":1,"total":2}\n'])), /반영 여부/);
    await assert.rejects(readImportResponse(stream(['{"type":"done","result":'])), SyntaxError);
    await assert.rejects(readImportResponse(new Response(new ReadableStream({ start(c) { c.error(new Error("가상 네트워크 단절")); } }), { headers: { "content-type": "application/x-ndjson" } })), /가상 네트워크 단절/);
    await assert.rejects(readImportResponse(stream(['{"type":"done","result":{"success":true}}\n'])), /반영 여부/);
});

test("UX-077 예약 대기열도 완료 프레임이 있어야 성공하고 중단·서버 오류는 보존 가능한 실패다", async () => {
    assert.equal(await readScheduledUploadResponse(stream(['{"type":"start","total":2}\n{"type":"done","inserted":2}'])), 2);
    await assert.rejects(readScheduledUploadResponse(stream(['{"type":"progress","processed":1000,"total":1001}\n'])), /반영 여부/);
    await assert.rejects(readScheduledUploadResponse(stream(['{"type":"error","error":"이번 업로드는 저장되지 않았습니다."}'])), /저장되지 않았습니다/);
});
