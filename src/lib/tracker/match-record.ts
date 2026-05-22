import { db } from "@/lib/db";
import { trackerVisitors, trackerSites, emailClickLogs, emailSendLogs } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { linkVisitorRecord } from "@/lib/visitor-links";

/**
 * click_id로 emailSendLogs.recordId를 찾아 visitor에 연결.
 * 이미 recordId가 있으면 아무것도 안 함.
 */
export async function linkVisitorByClickId(
    visitorPk: number,
    clickId: string,
): Promise<{ recordId: number | null; email: string | null; name: string | null }> {
    const visitor = await db.query.trackerVisitors.findFirst({
        where: eq(trackerVisitors.id, visitorPk),
    });
    if (!visitor || visitor.recordId) {
        return {
            recordId: visitor?.recordId ?? null,
            email: visitor?.email ?? null,
            name: visitor?.name ?? null,
        };
    }

    // emailClickLogs join emailSendLogs
    const [match] = await db
        .select({
            recordId: emailSendLogs.recordId,
            recipientEmail: emailSendLogs.recipientEmail,
        })
        .from(emailClickLogs)
        .innerJoin(emailSendLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))
        .where(eq(emailClickLogs.clickId, clickId))
        .limit(1);

    if (!match || !match.recordId) {
        return { recordId: null, email: visitor.email ?? null, name: visitor.name ?? null };
    }

    await db
        .update(trackerVisitors)
        .set({
            recordId: match.recordId,
            email: visitor.email ?? match.recipientEmail,
        })
        .where(eq(trackerVisitors.id, visitorPk));

    return {
        recordId: match.recordId,
        email: visitor.email ?? match.recipientEmail,
        name: visitor.name,
    };
}

/**
 * 폼 제출 등으로 record가 생성된 후, 같은 워크스페이스의 트래커 사이트에서
 * 해당 visitor_id를 찾아 record_id를 채움.
 */
export async function linkVisitorByFormSubmit(input: {
    workspaceId: number;
    visitorId: string;
    recordId: number;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
}): Promise<void> {
    const { trackerSites } = await import("@/lib/db/schema");
    const site = await db.query.trackerSites.findFirst({
        where: and(
            eq(trackerSites.workspaceId, input.workspaceId),
            eq(trackerSites.isActive, 1),
        ),
    });
    if (!site) return;

    const visitor = await db.query.trackerVisitors.findFirst({
        where: and(
            eq(trackerVisitors.siteId, site.id),
            eq(trackerVisitors.visitorId, input.visitorId),
        ),
    });
    if (!visitor) return;

    await db
        .update(trackerVisitors)
        .set({
            recordId: input.recordId,
            email: input.email ?? visitor.email,
            name: input.name ?? visitor.name,
            phone: input.phone ?? visitor.phone,
            updatedAt: new Date(),
        })
        .where(eq(trackerVisitors.id, visitor.id));
}

/**
 * record 기준 역매칭. 같은 워크스페이스의 미연결(record_id IS NULL) visitor를
 * site.matchField 값(신뢰) 또는 email(기본)로 찾아 record에 연결한다.
 *
 * - visitorId 비의존 · 제품 무관 (site.matchField 메커니즘)
 * - matchField 있으면 그 값으로 (식별자 고유 → 충돌 없음)
 * - 없으면 email로 (단 같은 workspace에 그 email record가 2건 이상이면 모호 → 스킵)
 * - phone 미사용 · 멱등 (record_id IS NULL인 것만 갱신, 링크는 onConflictDoNothing)
 *
 * fire-after-commit로 호출 — 실패해도 record 생성/갱신엔 영향 없음.
 */
export async function rematchVisitorsByRecord(input: {
    orgId: string;
    workspaceId: number;
    recordId: number;
    data: Record<string, unknown>;
}): Promise<{ linked: number }> {
    const { orgId, workspaceId, recordId, data } = input;

    const sites = await db
        .select({ id: trackerSites.id, matchField: trackerSites.matchField })
        .from(trackerSites)
        .where(and(eq(trackerSites.workspaceId, workspaceId), eq(trackerSites.isActive, 1)));
    if (sites.length === 0) return { linked: 0 };

    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : null;

    let linked = 0;
    for (const site of sites) {
        const matchVal =
            site.matchField && typeof data[site.matchField] === "string"
                ? (data[site.matchField] as string)
                : null;

        let candidates: { id: number }[] = [];

        if (matchVal) {
            // (우선) matchField 값 매칭 — 식별자 고유, 충돌 없음
            candidates = await db
                .select({ id: trackerVisitors.id })
                .from(trackerVisitors)
                .where(
                    and(
                        eq(trackerVisitors.siteId, site.id),
                        isNull(trackerVisitors.recordId),
                        eq(trackerVisitors.matchValue, matchVal),
                    ),
                );
        } else if (email) {
            // (기본) email 매칭 — 단 같은 workspace에 그 email record가 1건일 때만 (모호 방지)
            const dup = (await db.execute(sql`
                SELECT COUNT(*)::int AS cnt FROM records
                WHERE workspace_id = ${workspaceId}
                  AND lower(data->>'email') = ${email}
            `)) as unknown as Array<{ cnt: number }>;
            if ((dup[0]?.cnt ?? 0) === 1) {
                candidates = await db
                    .select({ id: trackerVisitors.id })
                    .from(trackerVisitors)
                    .where(
                        and(
                            eq(trackerVisitors.siteId, site.id),
                            isNull(trackerVisitors.recordId),
                            sql`lower(${trackerVisitors.email}) = ${email}`,
                        ),
                    );
            }
        }

        for (const c of candidates) {
            await db
                .update(trackerVisitors)
                .set({
                    recordId,
                    matchValue: matchVal ?? sql`${trackerVisitors.matchValue}`,
                    updatedAt: new Date(),
                })
                .where(and(eq(trackerVisitors.id, c.id), isNull(trackerVisitors.recordId)));
            await linkVisitorRecord({ orgId, visitorId: c.id, recordId, source: "record_rematch" });
            linked++;
        }
    }

    return { linked };
}
