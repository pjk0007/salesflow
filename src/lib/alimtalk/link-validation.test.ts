import { test } from "node:test";
import assert from "node:assert/strict";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";

// link-validation은 기본 조회용으로 db 모듈을 불러온다 — 닫힌 포트 주소만 넣고 실제 연결은 하지 않는다.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
const load = () => import("./link-validation");

// 공급자 조회는 가상 lookup으로 바꾼다(실제 NHN 호출 없음).
const tpl = (content: string, status = "TSC03") => ({ templateContent: content, status } as unknown as NhnTemplate);
const base = { orgId: "fake-org", triggerType: "on_create", senderKey: "A", templateCode: "MAIN", variableMappings: null, repeatConfig: null, followupConfig: null };
function lookupFrom(table: Record<string, NhnTemplate | null | "unavailable">) {
    const calls: string[] = [];
    const lookup = async (senderKey: string, code: string) => { calls.push(`${senderKey}/${code}`); return table[`${senderKey}/${code}`] ?? null; };
    return { calls, lookup };
}

test("UX-188·177: 수동 후속·반복, 반복+후속, 잘못된 반복 설정은 저장 거부", async () => {
    const { validateLinkShape } = await load();
    const repeat = { intervalHours: 24, maxRepeat: 3, stopCondition: { field: "", operator: "eq", value: "" } };
    assert.match(validateLinkShape({ triggerType: "manual", repeatConfig: null, followupConfig: [{ templateCode: "F" }] })!, /수동 연결에는 후속/);
    assert.match(validateLinkShape({ triggerType: "manual", repeatConfig: repeat, followupConfig: null })!, /수동 연결에는 반복/);
    assert.match(validateLinkShape({ triggerType: "on_create", repeatConfig: repeat, followupConfig: [{ templateCode: "F" }] })!, /함께 사용할 수 없/);
    assert.match(validateLinkShape({ triggerType: "on_create", repeatConfig: { ...repeat, intervalHours: 0 }, followupConfig: null })!, /반복 간격/);
    assert.match(validateLinkShape({ triggerType: "on_create", repeatConfig: { ...repeat, maxRepeat: 11 }, followupConfig: null })!, /최대 횟수/);
    assert.match(validateLinkShape({ triggerType: "on_create", repeatConfig: { ...repeat, stopCondition: { field: "stage", operator: "", value: "x" } }, followupConfig: null })!, /비교 방식/);
    // 빈 중단 조건 필드는 "조건 없이 최대 횟수까지"로 허용한다
    assert.equal(validateLinkShape({ triggerType: "on_create", repeatConfig: repeat, followupConfig: null }), null);
    assert.equal(validateLinkShape({ triggerType: "manual", repeatConfig: null, followupConfig: null }), null);
});

test("UX-253: 템플릿 모든 위치의 미매핑 변수는 저장 거부, 변수 없음·전부 매핑은 저장", async () => {
    const { validateLinkConfig } = await load();
    const { lookup } = lookupFrom({ "A/MAIN": tpl("#{이름}님 #{금액}원") });
    const missing = await validateLinkConfig({ ...base, variableMappings: { "#{이름}": "name" } }, { lookup });
    assert.equal(missing.ok, false);
    assert.match(!missing.ok ? missing.error : "", /변수 1개가 매핑되지 않았습니다: #\{금액\}/);
    assert.deepEqual(await validateLinkConfig({ ...base, variableMappings: { "#{이름}": "name", "#{금액}": "amount" } }, { lookup }), { ok: true });
    const none = lookupFrom({ "A/MAIN": tpl("변수 없음") });
    assert.deepEqual(await validateLinkConfig(base, { lookup: none.lookup }), { ok: true });
});

test("UX-176: 후속 단계는 단계 발신 프로필(B)의 템플릿 조합을 확인하고 없으면 거부", async () => {
    const { validateLinkConfig } = await load();
    const { calls, lookup } = lookupFrom({ "A/MAIN": tpl("본문"), "B/F1": tpl("후속 #{이름}") });
    const ok = await validateLinkConfig({ ...base, followupConfig: [{ senderKey: "B", templateCode: "F1", delayHours: 3, variableMappings: { "#{이름}": "name" } }] }, { lookup });
    assert.deepEqual(ok, { ok: true });
    assert.ok(calls.includes("B/F1"));
    // 같은 코드가 기본 채널(A)에만 있고 B에는 없으면 거부
    const wrong = await validateLinkConfig({ ...base, followupConfig: [{ senderKey: "B", templateCode: "MAIN", delayHours: 3 }] }, { lookup });
    assert.equal(wrong.ok, false);
    assert.match(!wrong.ok ? wrong.error : "", /후속 1단계: 선택한 발신 프로필에서 템플릿을 찾을 수 없습니다/);
    // 단계 senderKey가 없으면 기본 채널, 단계 매핑이 없으면 기본 매핑 — 실행 규칙과 같다
    const fallback = lookupFrom({ "A/MAIN": tpl("#{이름}"), "A/F2": tpl("#{이름}") });
    assert.deepEqual(await validateLinkConfig({ ...base, variableMappings: { "#{이름}": "name" }, followupConfig: [{ templateCode: "F2", delayDays: 1 }] }, { lookup: fallback.lookup }), { ok: true });
    assert.ok(fallback.calls.includes("A/F2"));
});

test("공급자 조회 실패·미승인 템플릿은 저장을 막지 않고 경고", async () => {
    const { validateLinkConfig } = await load();
    const down = lookupFrom({ "A/MAIN": "unavailable" });
    const r1 = await validateLinkConfig(base, { lookup: down.lookup });
    assert.equal(r1.ok, true);
    assert.match(r1.ok && r1.warning ? r1.warning : "", /확인하지 못해/);
    const pending = lookupFrom({ "A/MAIN": tpl("본문", "TSC02") });
    const r2 = await validateLinkConfig(base, { lookup: pending.lookup });
    assert.equal(r2.ok, true);
    assert.match(r2.ok && r2.warning ? r2.warning : "", /승인되지 않아/);
});

test("수정: 바뀌지 않은 매핑·단계는 다시 조회하지 않고, 이름·활성만 바꾸면 예전 설정으로 막지 않는다", async () => {
    const { validateLinkConfig } = await load();
    const previous = { variableMappings: { "#{이름}": "name" }, followupConfig: [{ senderKey: "B", templateCode: "GONE", delayHours: 1 }] };
    const { calls, lookup } = lookupFrom({});
    // 시간만 바꾼 단계(채널·템플릿·매핑 동일)
    const r = await validateLinkConfig({ ...base, variableMappings: previous.variableMappings, followupConfig: [{ senderKey: "B", templateCode: "GONE", delayHours: 5 }] }, { previous, lookup });
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 0);
    // 예전 수동+후속 데이터라도 발송 방식·후속을 바꾸지 않는 저장(skipShape)은 허용
    const legacy = await validateLinkConfig({ ...base, triggerType: "manual", followupConfig: [{ templateCode: "GONE" }] }, { previous: { variableMappings: null, followupConfig: [{ templateCode: "GONE" }] }, skipShape: true, lookup });
    assert.deepEqual(legacy, { ok: true });
});
