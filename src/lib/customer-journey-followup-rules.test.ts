import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFollowupPatch, shouldRemindLead } from "./customer-journey-followup-rules";
import { emptyFollowup } from "./customer-journey-leads";
import { fromKstInput, toKstInput } from "../components/lead-followup/utils/labels";
import { isFunnelRecordEvent } from "./deep-visitor-alert-rules";

const first = "2026-10-12T05:00:00Z"; // 월요일 14시 KST
const due = new Date("2026-10-13T05:00:00Z");
const target = () => ({ urgent: true, firstUrgentAt: first, followup: { ...emptyFollowup(), updatedAt: first } });

test("미확인은 24시간이 지나야 재알림하며 일반·관심 높음은 재태그하지 않는다", () => {
    assert.equal(shouldRemindLead(target(), new Date(due.getTime() - 1)), false);
    assert.equal(shouldRemindLead(target(), due), true);
    assert.equal(shouldRemindLead({ ...target(), urgent: false }, due), false);
});
test("연락 예정은 기한을 따르고 연락 완료·상담 진행은 재알림에서 제외한다", () => {
    const t = target();
    t.followup.status = "planned"; t.followup.dueAt = new Date(due.getTime() + 1).toISOString();
    assert.equal(shouldRemindLead(t, due), false);
    t.followup.dueAt = due.toISOString(); assert.equal(shouldRemindLead(t, due), true);
    t.followup.status = "contacted"; assert.equal(shouldRemindLead(t, due), false);
    t.followup.status = "consulting"; assert.equal(shouldRemindLead(t, due), false);
});
test("근무시간·주말·최근 최초 태그·재알림·최대 3회 제한을 함께 적용한다", () => {
    assert.equal(shouldRemindLead(target(), new Date("2026-10-13T09:00:00Z")), false); // KST18
    assert.equal(shouldRemindLead(target(), new Date("2026-10-17T05:00:00Z")), false);
    assert.equal(shouldRemindLead({ ...target(), lastMentionedAt: new Date(due.getTime() - 1000).toISOString() }, due), false);
    const t = target(); t.followup.lastRemindedAt = new Date(due.getTime() - 1000).toISOString();
    assert.equal(shouldRemindLead(t, due), false);
    t.followup.lastRemindedAt = null; t.followup.reminderCount = 3;
    assert.equal(shouldRemindLead(t, due), false);
});
test("입력 검증: 예정 시각·상태·버전·메모 길이, 완료 시 불필요한 예정 제거", () => {
    const input = { status: "planned", dueAt: "2026-10-13T14:30:00+09:00", note: " 다음 연락 ", revision: 1 };
    assert.equal(parseFollowupPatch(input).dueAt, "2026-10-13T05:30:00.000Z");
    assert.equal(parseFollowupPatch(input).note, "다음 연락");
    for (const invalid of [{ ...input, status: "__proto__" }, { ...input, dueAt: null }, { ...input, dueAt: "2026-10-13T14:30" },
        { ...input, revision: -1 }, { ...input, note: "a".repeat(2001) }]) assert.throws(() => parseFollowupPatch(invalid));
    assert.equal(parseFollowupPatch({ ...input, status: "contacted" }).dueAt, null);
});
test("한국 시간 입력은 브라우저·서버 시간대와 관계없이 왕복한다", () => {
    assert.equal(fromKstInput("2026-10-13T14:30"), "2026-10-13T05:30:00.000Z");
    assert.equal(toKstInput("2026-10-13T05:30:00.000Z"), "2026-10-13T14:30");
    assert.equal(fromKstInput(""), null);
});

test("담당자 후속 대응 이력은 이름이 같은 CRM 퍼널 단계의 실제 전환으로 집계하지 않는다", () => {
    assert.equal(isFunnelRecordEvent({ type: "lead_followup", label: "상담 진행" }, ["상담 진행"]), false);
    assert.equal(isFunnelRecordEvent({ type: "match_stage", label: "상담 진행" }, ["상담 진행"]), true);
});
