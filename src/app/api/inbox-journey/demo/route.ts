import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { db, workspaces, partitions, records, inboxChannels, trackerSites, emailSendLogs, emailClickLogs, alimtalkSendLogs, crmContacts } from "@/lib/db";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import { isDevelopmentPreviewRuntime } from "@/lib/development-runtime";
import { connectVerifiedLead } from "@/lib/inbox-journey/repository";
import { issueCustomerIdentity } from "@/lib/customer-platform/identity";

export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        if (!isDevelopmentPreviewRuntime(process.env)) throw new InboxError("체험 자료는 개발 서버에서만 준비할 수 있습니다.", 404);
        const actor = inboxActor(req);
        if (!["owner", "admin"].includes(actor.role)) throw new InboxError("관리자 계정으로 체험해주세요.", 403);
        const input = await jsonBody(req);
        const origin = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;
        const prepared = await db.transaction(async tx => {
            // 기존 실제 고객 자료를 수정하지 않고 이름이 고정된 가상 사업만 사용한다.
            const [workspace] = await tx.select().from(workspaces).where(and(eq(workspaces.orgId, actor.orgId), eq(workspaces.name, "샌드비 상담 체험 2026-10-15"))).for("update");
            if (!workspace) throw new InboxError("먼저 샌드비 상담 체험 2026-10-15 사업을 준비해주세요.", 404);
            const [channel] = await tx.select().from(inboxChannels).where(and(eq(inboxChannels.orgId, actor.orgId), eq(inboxChannels.workspaceId, workspace.id), eq(inboxChannels.enabled, true)));
            if (!channel) throw new InboxError("체험 사업의 상담창을 먼저 켜주세요.", 404);
            let [partition] = await tx.select().from(partitions).where(and(eq(partitions.workspaceId, workspace.id), eq(partitions.name, "경로 연결 가상자료")));
            if (!partition) [partition] = await tx.insert(partitions).values({ workspaceId: workspace.id, name: "경로 연결 가상자료" }).returning();
            let [record] = await tx.select().from(records).where(and(eq(records.orgId, actor.orgId), eq(records.workspaceId, workspace.id), eq(records.integratedCode, "DEV-JOURNEY-20261015")));
            if (!record) [record] = await tx.insert(records).values({ orgId: actor.orgId, workspaceId: workspace.id, partitionId: partition.id, integratedCode: "DEV-JOURNEY-20261015", data: { name: "[가상] 경로 체험 고객", company: "[가상] 경로 체험 회사", email: "journey-demo@example.test", sendbDemoMemberId: "sendb-journey-demo-member", demoOnly: true } }).returning();
            if (record.data?.demoOnly !== true || record.partitionId !== partition.id) throw new InboxError("동일한 번호의 다른 자료가 있어 체험 자료를 만들지 않았습니다.", 409);
            let [site] = await tx.select().from(trackerSites).where(and(eq(trackerSites.orgId, actor.orgId), eq(trackerSites.workspaceId, workspace.id)));
            if (!site) [site] = await tx.insert(trackerSites).values({ orgId: actor.orgId, workspaceId: workspace.id, name: "[가상] 경로 체험 사이트", apiKey: randomBytes(24).toString("hex"), domains: [new URL(origin).hostname], matchField: "sendbDemoMemberId" }).returning();
            if (site.name !== "[가상] 경로 체험 사이트" || site.matchField !== "sendbDemoMemberId") throw new InboxError("이 사업에 다른 사이트 설정이 있어 체험 자료를 만들지 않았습니다.", 409);
            let [send] = await tx.select().from(emailSendLogs).where(and(eq(emailSendLogs.orgId, actor.orgId), eq(emailSendLogs.recordId, record.id), eq(emailSendLogs.triggerType, "journey_demo")));
            if (!send) {
                [send] = await tx.insert(emailSendLogs).values({ orgId: actor.orgId, recordId: record.id, recipientEmail: "journey-demo@example.test", subject: "[가상 기록 · 실제 발송 없음] 서비스 도입 안내", status: "demo", triggerType: "journey_demo", sentAt: new Date(Date.now() - 86400000) }).returning();
                await tx.insert(alimtalkSendLogs).values({ orgId: actor.orgId, recordId: record.id, senderKey: "fictional-demo", templateCode: "fictional-demo", templateName: "[가상] 상담 안내", recipientNo: "01000000000", status: "demo", triggerType: "journey_demo", sentAt: new Date(Date.now() - 3600000) });
            }
            let [click] = await tx.select().from(emailClickLogs).where(eq(emailClickLogs.sendLogId, send.id));
            if (!click) [click] = await tx.insert(emailClickLogs).values({ orgId: actor.orgId, sendLogId: send.id, url: `${origin}/dev-start/journey-demo.html`, clickId: randomUUID(), isBot: false }).returning();
            let [contact] = await tx.select().from(crmContacts).where(and(eq(crmContacts.orgId, actor.orgId), eq(crmContacts.workspaceId, workspace.id), eq(crmContacts.externalId, "sendb-journey-demo-member")));
            if (!contact) [contact] = await tx.insert(crmContacts).values({ orgId: actor.orgId, workspaceId: workspace.id, externalId: "sendb-journey-demo-member", name: "[가상] 경로 체험 고객", email: "journey-demo@example.test" }).returning();
            if (contact.email !== "journey-demo@example.test") throw new InboxError("다른 고객과 구분되지 않아 체험을 중단했습니다.", 409);
            return { workspaceId: workspace.id, channelId: channel.id, channelKey: channel.publicKey, trackerKey: site.apiKey, recordId: record.id, clickId: click.clickId, contactId: contact.id };
        });
        if (input?.mode === "member") {
            await connectVerifiedLead(actor.orgId, prepared.workspaceId, prepared.contactId);
            return { ...prepared, ...issueCustomerIdentity(prepared.contactId, prepared.channelKey) };
        }
        return prepared;
    });
}
