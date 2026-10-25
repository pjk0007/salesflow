import assert from "node:assert/strict";
import test from "node:test";
import { announceSessionChange, SESSION_CHANGE_STORAGE_KEY, sessionIdentityKey, watchSessionChanges } from "./session-sync";

function fakeWindow() {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    return {
        document: { visibilityState: "visible" },
        addEventListener(type: string, listener: (event: Event) => void) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(listener);
        },
        removeEventListener(type: string, listener: (event: Event) => void) { listeners.get(type)?.delete(listener); },
        emit(type: string, extra: Record<string, unknown> = {}) {
            for (const listener of listeners.get(type) ?? []) listener(Object.assign(new Event(type), extra));
        },
        count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
    };
}

test("조직·멤버십·권한 중 하나라도 바뀌면 다른 세션으로 본다", () => {
    const base = { orgId: "o1", userId: "u1", membershipId: "m1", tokenVersion: 1, role: "owner", isSuperAdmin: false };
    assert.equal(sessionIdentityKey(base), sessionIdentityKey({ ...base }));
    for (const change of [{ orgId: "o2" }, { membershipId: "m2" }, { tokenVersion: 2 }, { role: "member" }, { isSuperAdmin: true }]) {
        assert.notEqual(sessionIdentityKey({ ...base, ...change }), sessionIdentityKey(base));
    }
});

test("다른 탭의 세션 변경 알림은 즉시, 관계없는 저장소 키는 무시한다", () => {
    const win = fakeWindow();
    let checks = 0;
    const stop = watchSessionChanges(win, () => { checks++; });
    win.emit("storage", { key: "other" });
    assert.equal(checks, 0);
    win.emit("storage", { key: SESSION_CHANGE_STORAGE_KEY });
    win.emit("storage", { key: SESSION_CHANGE_STORAGE_KEY });
    assert.equal(checks, 2);
    stop();
    assert.equal(win.count(), 0);
    win.emit("storage", { key: SESSION_CHANGE_STORAGE_KEY });
    assert.equal(checks, 2);
});

test("탭 복귀 확인은 보이는 상태에서만, 짧은 간격의 focus·visibilitychange는 한 번으로 묶는다", () => {
    const win = fakeWindow();
    let clock = 10_000;
    let checks = 0;
    watchSessionChanges(win, () => { checks++; }, { minIntervalMs: 2_000, now: () => clock });
    win.document.visibilityState = "hidden";
    win.emit("visibilitychange");
    assert.equal(checks, 0);
    win.document.visibilityState = "visible";
    win.emit("visibilitychange");
    win.emit("focus");
    assert.equal(checks, 1);
    clock += 2_000;
    win.emit("focus");
    assert.equal(checks, 2);
});

test("알림 값에는 세션 정보가 없고 저장소 오류는 삼킨다", () => {
    const written: Array<[string, string]> = [];
    announceSessionChange({ setItem: (key, value) => { written.push([key, value]); } });
    assert.equal(written.length, 1);
    assert.equal(written[0][0], SESSION_CHANGE_STORAGE_KEY);
    assert.match(written[0][1], /^\d+:[a-z0-9]+$/);
    assert.doesNotThrow(() => announceSessionChange({ setItem: () => { throw new Error("QuotaExceededError"); } }));
});
