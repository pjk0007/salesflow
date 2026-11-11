import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, emailSendLogs, partitions } from "@/lib/db";

/** 리드 유입경로 — 콜드메일이면 어느 파티션 발송에서 왔는지까지 */
export type LeadInflow =
    | { type: "cold_mail"; partitionId: number; partitionName: string }
    | { type: "homepage" }
    | { type: "other"; label: string };

const LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;
const HOMEPAGE_WORDS = ["웹사이트", "홈페이지", "website", "web"];

function normalizeEmail(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const e = v.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * 판정 규칙 (추정):
 * 1. 같은 워크스페이스(사업부)에서 리드 등록 전 180일 안에 같은 이메일로 레코드(콜드) 파티션 메일을 보낸 기록이 있으면 → 콜드메일 + 그 파티션
 * 2. 아니면 출처(source) 칸이 비었거나 웹사이트/홈페이지면 → 홈페이지
 * 3. 그 밖의 출처 값(설비지원몰, 메타 광고 등)은 그대로 보여준다
 */
export async function resolveLeadInflows(
    orgId: string,
    workspaceId: number,
    leads: Array<{ id: number; data: Record<string, unknown>; registeredAt: Date }>,
): Promise<Map<number, LeadInflow>> {
    const result = new Map<number, LeadInflow>();
    const emails = [...new Set(leads.map((l) => normalizeEmail(l.data.email)).filter((e): e is string => !!e))];

    const sends = new Map<string, Array<{ sentAt: Date; partitionId: number; partitionName: string }>>();
    if (emails.length > 0) {
        const latest = new Date(Math.max(...leads.map((l) => new Date(l.registeredAt).getTime())));
        const earliest = new Date(Math.min(...leads.map((l) => new Date(l.registeredAt).getTime())) - LOOKBACK_MS);
        const rows = await db
            .select({
                email: sql<string>`lower(${emailSendLogs.recipientEmail})`,
                sentAt: emailSendLogs.sentAt,
                partitionId: partitions.id,
                partitionName: partitions.name,
            })
            .from(emailSendLogs)
            .innerJoin(partitions, eq(partitions.id, emailSendLogs.partitionId))
            .where(
                and(
                    eq(emailSendLogs.orgId, orgId),
                    inArray(sql`lower(${emailSendLogs.recipientEmail})`, emails),
                    eq(emailSendLogs.status, "sent"),
                    eq(partitions.category, "cold"),
                    eq(partitions.workspaceId, workspaceId),
                    gte(emailSendLogs.sentAt, earliest),
                    lte(emailSendLogs.sentAt, latest),
                ),
            )
            .orderBy(desc(emailSendLogs.sentAt))
            .limit(2000);
        for (const r of rows) {
            if (!r.sentAt) continue;
            const list = sends.get(r.email) ?? [];
            list.push({ sentAt: r.sentAt, partitionId: r.partitionId, partitionName: r.partitionName });
            sends.set(r.email, list);
        }
    }

    for (const lead of leads) {
        const email = normalizeEmail(lead.data.email);
        const at = new Date(lead.registeredAt).getTime();
        // 최신순이라 등록 시각 이전의 첫 발송이 가장 가까운 발송
        const send = email
            ? sends.get(email)?.find((s) => s.sentAt.getTime() <= at && s.sentAt.getTime() >= at - LOOKBACK_MS)
            : undefined;
        if (send) {
            result.set(lead.id, { type: "cold_mail", partitionId: send.partitionId, partitionName: send.partitionName });
            continue;
        }
        const source = typeof lead.data.source === "string" ? lead.data.source.trim() : "";
        if (!source || HOMEPAGE_WORDS.some((w) => source.toLowerCase().includes(w))) {
            result.set(lead.id, { type: "homepage" });
        } else {
            result.set(lead.id, { type: "other", label: source });
        }
    }
    return result;
}
