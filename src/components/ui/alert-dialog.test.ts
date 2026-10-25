// F2 확인창 계약 보강(A2 요청) — 취소 시 onConfirm 0회, 연타 1회, 진행 중 닫기 차단, 실패 시 열린 채 오류 유지.
// DOM 시험 도구가 없어 AsyncAlertDialog가 쓰는 닫기·확인 흐름(changeConfirmOpen·runConfirm)을 직접 시험한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { changeConfirmOpen, runConfirm } from "./alert-dialog";

function setup(onConfirm: () => Promise<unknown>) {
    const log = { confirm: 0, openChanges: [] as boolean[], pending: [] as boolean[], errors: [] as (string | null)[] };
    const busy = { current: false };
    const handlers = {
        onConfirm: () => { log.confirm++; return onConfirm(); },
        onOpenChange: (open: boolean) => { log.openChanges.push(open); },
        setPending: (pending: boolean) => { log.pending.push(pending); },
        setError: (error: string | null) => { log.errors.push(error); },
    };
    const flow = { changeOpen: (next: boolean) => changeConfirmOpen(busy, handlers, next), confirm: () => runConfirm(busy, handlers) };
    return { flow, log, busy };
}

test("진행 전 취소·ESC는 닫기만 하고 onConfirm을 부르지 않는다", () => {
    const { flow, log } = setup(async () => undefined);
    flow.changeOpen(false);
    assert.equal(log.confirm, 0);
    assert.deepEqual(log.openChanges, [false]);
});

test("성공하면 한 번만 실행하고 닫으며, 연타는 같은 틱에서 막힌다", async () => {
    let resolve!: () => void;
    const { flow, log } = setup(() => new Promise<void>((r) => { resolve = r; }));
    const first = flow.confirm();
    void flow.confirm();
    flow.changeOpen(false); // 진행 중 취소·ESC는 무시
    assert.equal(log.confirm, 1);
    assert.deepEqual(log.openChanges, []);
    resolve();
    await first;
    assert.deepEqual(log.openChanges, [false]);
    assert.deepEqual(log.pending, [true, false]);
});

test("실패는 열린 채 한국어 오류를 보이고, 영어 오류는 고정 문구로 바꾸며, 다시 시도할 수 있다", async () => {
    const outcomes: Array<() => unknown> = [
        () => { throw new Error("상담 기록이 남아 있어 삭제할 수 없습니다."); },
        () => { throw new Error("Failed query: delete from x"); },
        () => ({ success: false, error: "권한이 없습니다." }),
        () => ({ success: true }),
    ];
    const { flow, log, busy } = setup(async () => outcomes[log.confirm - 1]());
    for (let i = 0; i < 3; i++) await flow.confirm();
    assert.deepEqual(log.errors.filter((e) => e !== null), [
        "상담 기록이 남아 있어 삭제할 수 없습니다.",
        "요청을 처리하지 못했습니다. 다시 시도해주세요.",
        "권한이 없습니다.",
    ]);
    assert.deepEqual(log.openChanges, []);
    assert.equal(busy.current, false);
    await flow.confirm();
    assert.equal(log.confirm, 4);
    assert.deepEqual(log.openChanges, [false]);
});
