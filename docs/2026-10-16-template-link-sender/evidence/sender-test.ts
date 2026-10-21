// 실행: STATE_FILE=<경로> DATABASE_URL=postgresql://jaehun@localhost:5432/salesflow pnpm exec tsx --env-file=.env.local --tsconfig tsconfig.json <이 파일> setup|send A a1|queue|requeue|pause on/off|logs
// 로컬 DB + 실제 NHN 발송. 수신은 ghty6323+sendb-*@gmail.com(사용자 본인 메일 별칭)만 쓴다. 끝나면 시험 행을 지운다.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { and, eq, inArray, desc } from "drizzle-orm";
import { db, queryClient, partitions, emailTemplates, emailTemplateLinks, records, emailSendLogs, emailAutomationQueue, emailSenderProfiles } from "../../../src/lib/db";
import { processEmailAutoTrigger, processEmailRepeatQueue } from "../../../src/lib/email-automation";

const ORG = "d3adb8d3-db1d-4fab-aac0-61c7f8644f13", WS = 3;
const STATE = process.env.STATE_FILE!;
type St = { p: Record<string, number>; l: Record<string, number>; t: number; r: number[]; q: number[] };
const load = (): St => JSON.parse(readFileSync(STATE, "utf8"));
const save = (s: St) => writeFileSync(STATE, JSON.stringify(s));
const to = (tag: string) => `ghty6323+sendb-${tag}@gmail.com`;

async function newRecord(s: St, key: string, tag: string) {
    const [r] = await db.insert(records).values({ orgId: ORG, workspaceId: WS, partitionId: s.p[key], data: { email: to(tag), companyname: "샌드비 발신 테스트" } }).returning();
    s.r.push(r.id); save(s); return r;
}
async function lastLogs(s: St) {
    return db.select({ id: emailSendLogs.id, link: emailSendLogs.templateLinkId, to: emailSendLogs.recipientEmail, profile: emailSendLogs.senderProfileId, from: emailSendLogs.senderEmail, status: emailSendLogs.status, msg: emailSendLogs.resultMessage })
        .from(emailSendLogs).where(inArray(emailSendLogs.recordId, s.r.length ? s.r : [-1])).orderBy(emailSendLogs.id);
}
async function main() {
const step = process.argv[2];
if (step === "setup") {
    if (existsSync(STATE)) throw new Error("state exists");
    const s: St = { p: {}, l: {}, t: 0, r: [], q: [] };
    const [t] = await db.insert(emailTemplates).values({ orgId: ORG, name: "[테스트] 발신 프로필 검증", subject: "[샌드비 테스트] 템플릿 연결 발신 프로필 검증", htmlBody: "<p>샌드비 템플릿 연결 발신 프로필 검증 메일입니다. 무시하셔도 됩니다.</p>" }).returning();
    s.t = t.id;
    const pools: Record<string, number[] | null> = { A: [6], B: null, C: [6, 7] };
    for (const k of ["A", "B", "C"]) {
        const [p] = await db.insert(partitions).values({ workspaceId: WS, name: `[테스트] 발신 ${k}` }).returning();
        s.p[k] = p.id;
        const pool = pools[k];
        const [l] = await db.insert(emailTemplateLinks).values({ partitionId: p.id, name: `[테스트] 발신 ${k}`, emailTemplateId: t.id, recipientField: "email", triggerType: "on_create", isActive: 1, senderProfileId: pool?.[0] ?? null, senderProfileIds: pool }).returning();
        s.l[k] = l.id;
    }
    save(s); console.log(s);
} else if (step === "send") {
    const s = load(); const key = process.argv[3], tag = process.argv[4];
    const r = await newRecord(s, key, tag);
    await processEmailAutoTrigger({ record: r, partitionId: s.p[key], triggerType: "on_create", orgId: ORG });
    console.table(await lastLogs(s));
} else if (step === "queue") {
    // 기한 된 first 줄: A 2줄 → B 1줄 순서
    const s = load();
    for (const [key, tag] of [["A", "q1"], ["A", "q2"], ["B", "q3"]] as const) {
        const r = await newRecord(s, key, tag);
        const [q] = await db.insert(emailAutomationQueue).values({ templateLinkId: s.l[key], recordId: r.id, orgId: ORG, nextRunAt: new Date(Date.now() - 1000), kind: "first" }).returning();
        s.q.push(q.id); save(s);
    }
    console.log(await processEmailRepeatQueue());
    console.table(await db.select({ id: emailAutomationQueue.id, link: emailAutomationQueue.templateLinkId, status: emailAutomationQueue.status, next: emailAutomationQueue.nextRunAt }).from(emailAutomationQueue).where(inArray(emailAutomationQueue.id, s.q)));
    console.table(await lastLogs(s));
} else if (step === "requeue") {
    const s = load();
    await db.update(emailTemplateLinks).set({ senderProfileId: 7, senderProfileIds: [7] }).where(eq(emailTemplateLinks.id, s.l.A));
    await db.update(emailAutomationQueue).set({ nextRunAt: new Date(Date.now() - 1000) }).where(and(inArray(emailAutomationQueue.id, s.q), eq(emailAutomationQueue.status, "pending")));
    console.log(await processEmailRepeatQueue());
    console.table(await db.select({ id: emailAutomationQueue.id, link: emailAutomationQueue.templateLinkId, status: emailAutomationQueue.status }).from(emailAutomationQueue).where(inArray(emailAutomationQueue.id, s.q)));
    console.table(await lastLogs(s));
} else if (step === "pause") {
    await db.update(emailSenderProfiles).set({ isPaused: process.argv[3] === "on" }).where(eq(emailSenderProfiles.id, 6));
    console.log((await db.select({ id: emailSenderProfiles.id, paused: emailSenderProfiles.isPaused }).from(emailSenderProfiles).where(eq(emailSenderProfiles.id, 6)))[0]);
} else if (step === "logs") {
    console.table(await lastLogs(load()));
}
await queryClient.end();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
