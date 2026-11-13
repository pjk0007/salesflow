import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, crmContacts } from "@/lib/db";
import { activeCustomerActor } from "@/lib/customer-access/access";
import { handleInbox, inboxActor } from "@/lib/inbox/http";

/** 고객 연락처가 한 명이라도 있는 사업부 id — 고객 연락처 화면의 기본 사업부 탭 */
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const actor = inboxActor(req);
        await activeCustomerActor(actor);
        const rows = await db
            .selectDistinct({ workspaceId: crmContacts.workspaceId })
            .from(crmContacts)
            .where(and(eq(crmContacts.orgId, actor.orgId), isNull(crmContacts.archivedAt)));
        return rows.map((r) => r.workspaceId);
    });
}
