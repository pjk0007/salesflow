import { test } from "node:test";
import assert from "node:assert";
import {
    actionNoteLabel,
    autoPausedInPool,
    bannerText,
    eventLabel,
    formatKst,
    formatRateBp,
    healthTooltip,
    modeLabel,
    releaseNotice,
    sortPartitions,
    stateLabel,
    syncLine,
} from "./labels";
import type { PartitionHealthRow, SenderHealthRow } from "../types";

function sender(id: number, over: Partial<SenderHealthRow> = {}): SenderHealthRow {
    return {
        profileId: id,
        email: `cs${id}@a.test`,
        isDefault: false,
        isPaused: false,
        pausedSource: null,
        pausedReason: null,
        pausedAt: null,
        healthAction: "auto",
        state: "ok",
        final: 0,
        failed: 0,
        rateBp: null,
        outliers: 0,
        dsnOnly: 0,
        releasePreview: null,
        ...over,
    };
}

test("상태 글과 회복", () => {
    assert.equal(stateLabel("danger"), "위험");
    assert.equal(stateLabel("insufficient"), "판정 보류");
    assert.equal(stateLabel("ok", true), "회복");
    assert.equal(stateLabel(null), "판정 전");
});

test("비율·시각 표시", () => {
    assert.equal(formatRateBp(640), "6.4%");
    assert.equal(formatRateBp(null), "-");
    assert.equal(formatKst("2026-10-11T05:20:00Z"), "10/11 14:20");
    assert.equal(formatKst(null), "-");
});

test("툴팁에 확정·실패·기준·창이 있고 SST 코드 글자는 없다", () => {
    const t = healthTooltip({ final: 212, failed: 14, rateBp: 660, evalWindow: "30d", unknown: 3, dsnOnly: 4 });
    assert.ok(t.includes("최근 30일(느린 명단) 확정 212통 중 실패 14통 (6.6%)"));
    assert.ok(t.includes("200통 이상에서 5% 이상"));
    assert.ok(t.includes("반송 안내(실패율에 아직 안 넣음) 4통"));
    assert.ok(!t.includes("SST"));
});

test("띠 글: 보류·자동 멈춤이 없으면 null", () => {
    assert.equal(bannerText([], [sender(1)]), null);
    const text = bannerText(
        [{ id: 1, partitionId: 3, partitionName: "P", workspaceId: 1, workspaceName: "W", reasonText: "r", heldAt: null, queued: 5 }],
        [sender(1, { isPaused: true, pausedSource: "auto" }), sender(2, { isPaused: true, pausedSource: "manual" })]
    );
    assert.ok(text?.startsWith("명단 1개 보류 · 주소 1개 자동 멈춤"));
    assert.ok(text?.includes("폼·광고 문의 메일은 그대로 나갑니다"));
});

test("풀기 안내: 대기 수 / 웜업 한도", () => {
    assert.ok(releaseNotice({ kind: "hold", queued: 1240 }).includes("대기 1,240통"));
    assert.ok(releaseNotice({ kind: "sender", preview: { todayCap: 35, warmupDay: 6 } }).includes("오늘 한도 35통 (웜업 6일째)"));
    assert.ok(releaseNotice({ kind: "sender", preview: { todayCap: null, warmupDay: null } }).includes("제한 없음"));
});

test("동기화 줄: 관문 경고", () => {
    assert.equal(syncLine(null).warning, "자동 조치 미룸 — NHN 결과를 아직 받지 못함");
    const base = { lastOkAt: null, cursor: null, initialDoneAt: null, lastError: null, lastErrorCode: null, gate: null, unconfirmedOld: 2 };
    assert.equal(syncLine(base).warning, null);
    assert.equal(syncLine({ ...base, gate: "sync_stale" }).warning, "자동 조치 미룸 — NHN 결과 확인이 30분 넘게 멈춤");
    assert.equal(syncLine({ ...base, lastErrorCode: "auth", gate: "sync_stale" }).warning, "자동 조치 미룸 — NHN 키 확인 필요");
});

test("사건·모드·조치 메모 글", () => {
    assert.equal(eventLabel({ kind: "danger", action: "hold", entityType: "partition", mode: "enforce" }), "위험 명단 → 명단 보류");
    assert.equal(eventLabel({ kind: "danger", action: "none", entityType: "sender", mode: "dry_run" }), "위험 주소 (기록만)");
    assert.equal(modeLabel("enforce"), "멈춤 + 알림");
    assert.equal(actionNoteLabel("default_sender"), "조직 기본 주소라 자동으로 멈추지 않음");
    assert.equal(actionNoteLabel(null), null);
});

test("묶음의 자동 멈춘 주소 수·명단 정렬", () => {
    assert.equal(autoPausedInPool([1, 2, 3], [sender(1, { isPaused: true, pausedSource: "auto" }), sender(3, { isPaused: true, pausedSource: "manual" }), sender(4, { isPaused: true, pausedSource: "auto" })]), 1);
    const row = (name: string, state: string, rateBp: number | null): PartitionHealthRow => ({
        partitionId: name.length,
        name,
        workspaceId: 1,
        workspaceName: "W",
        state,
        evalWindow: "7d",
        final: 0,
        failed: 0,
        rateBp,
        unknown: 0,
        dsnOnly: 0,
        senderSide: 0,
        nhnUnsub: 0,
        held: false,
        recovered: false,
        unconfirmedBp: 0,
        windowStart: null,
        evaluatedAt: null,
    });
    assert.deepEqual(
        sortPartitions([row("a", "ok", 100), row("b", "danger", 600), row("c", "insufficient", null), row("d", "caution", 350)]).map((r) => r.name),
        ["b", "d", "a", "c"]
    );
});
