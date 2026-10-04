import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, partitions, workspaces } from "@/lib/db";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailConfig } from "@/lib/nhn-email";
import { loadOrgSenderProfiles } from "@/lib/email-sender-resolver";
import { normalizeSenderPool } from "@/lib/email-sender-limit-rules";
import { lookupDomainMx, lookupEmailMx } from "@/lib/email-mx-lookup";
import { emailDomain, poolSenderEntries, replyToHeaderValue } from "@/lib/reply-to-rules";
import type { MxStatus, SenderMxEntry } from "@/lib/reply-to-rules";

/**
 * GET /api/email/reply-to?partitionId=12[&senderProfileIds=3,4]   (또는 workspaceId=5)
 *
 * AI 규칙 수정 화면의 답장 안내 (DESIGN-3 3절). 보기만 하므로 조직 구성원이면 누구나 본다 (바꾸기는 워크스페이스 설정 — 관리자만).
 * - workspace: 규칙 파티션의 워크스페이스와 그 답장 받을 주소·MX. 파티션·워크스페이스를 안 넘기면 null
 * - senders: 조직의 발신 주소 전부와 도메인 MX (설정 발신자는 profileId null). 화면이 묶음을 고칠 때 다시 묻지 않게 다 준다
 * - pool: senderProfileIds 묶음이 실제로 쓸 주소 (발송과 같은 규칙 — 묶음이 비었거나 없는 주소뿐이면 기본 주소 → 설정 발신자)
 * - poolNoMxDomains: 답장 주소가 비어 있을 때, pool 중 메일을 받지 않는(MX 없음) 도메인. 답장 주소가 있으면 빈 목록
 * MX는 도메인마다 하루 캐시하고 짧은 시간 제한을 둔다 (email-mx-lookup.ts). 조회 실패는 "unknown"
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const partitionId = parseId(sp.get("partitionId"));
    const workspaceIdParam = parseId(sp.get("workspaceId"));
    if (partitionId === "invalid" || workspaceIdParam === "invalid") {
        return NextResponse.json({ success: false, error: "파티션 또는 워크스페이스 id가 올바르지 않습니다." }, { status: 400 });
    }
    const poolInput = parseIdList(sp.get("senderProfileIds"));
    const pool = normalizeSenderPool(poolInput);
    if (!pool.ok) {
        return NextResponse.json({ success: false, error: pool.error }, { status: 400 });
    }

    try {
        // 1. 워크스페이스 (이 조직 것만)
        let workspace: { id: number; name: string; replyToEmail: string | null } | null = null;
        if (partitionId !== null || workspaceIdParam !== null) {
            const [row] = partitionId !== null
                ? await db
                    .select({ id: workspaces.id, name: workspaces.name, replyToEmail: workspaces.replyToEmail })
                    .from(partitions)
                    .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
                    .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
                    .limit(1)
                : await db
                    .select({ id: workspaces.id, name: workspaces.name, replyToEmail: workspaces.replyToEmail })
                    .from(workspaces)
                    .where(and(eq(workspaces.id, workspaceIdParam as number), eq(workspaces.orgId, user.orgId)))
                    .limit(1);
            if (!row) {
                return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
            }
            workspace = row;
        }

        // 2. 조직의 발신 주소 (프로필 + 설정 발신자)
        const [profiles, config] = await Promise.all([loadOrgSenderProfiles(user.orgId), getEmailConfig(user.orgId)]);
        const rawSenders: Array<Omit<SenderMxEntry, "mx">> = profiles.map((p) => ({
            profileId: p.id,
            fromEmail: p.fromEmail,
            domain: emailDomain(p.fromEmail),
            isDefault: p.isDefault,
        }));
        if (config?.fromEmail) {
            rawSenders.push({ profileId: null, fromEmail: config.fromEmail, domain: emailDomain(config.fromEmail), isDefault: false });
        }

        // 3. 도메인마다 한 번 MX 조회 (캐시) + 답장 주소 MX
        const domains = [...new Set(rawSenders.map((s) => s.domain).filter((d): d is string => !!d))];
        const replyTo = replyToHeaderValue(workspace?.replyToEmail);
        const [mxList, replyToMx] = await Promise.all([
            Promise.all(domains.map((d) => lookupDomainMx(d))),
            workspace ? lookupEmailMx(replyTo) : Promise.resolve(null),
        ]);
        const mxByDomain = new Map<string, MxStatus>(domains.map((d, i) => [d, mxList[i]]));
        const senders: SenderMxEntry[] = rawSenders.map((s) => ({ ...s, mx: s.domain ? mxByDomain.get(s.domain) ?? null : null }));

        const poolEntries = poolSenderEntries(pool.ids ?? [], senders);
        const poolNoMxDomains = replyTo
            ? []
            : [...new Set(poolEntries.filter((s) => s.mx === "none" && s.domain).map((s) => s.domain as string))];

        return NextResponse.json({
            success: true,
            data: {
                workspace: workspace ? { ...workspace, replyToEmail: replyTo, replyToMx } : null,
                senders,
                pool: poolEntries,
                poolNoMxDomains,
            },
        });
    } catch (error) {
        console.error("[reply-to] 조회 오류:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

/** 양의 정수 id. 없으면 null, 형식이 틀리면 "invalid" */
function parseId(raw: string | null): number | null | "invalid" {
    if (raw === null || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : "invalid";
}

/** "3,4,5" → [3,4,5]. 없거나 비었으면 null (묶음 없음 = 기본 주소). 숫자가 아닌 조각은 그대로 넘겨 검사에서 걸린다 */
function parseIdList(raw: string | null): unknown {
    if (raw === null || raw.trim() === "") return null;
    return raw.split(",").map((t) => (/^\s*\d+\s*$/.test(t) ? Number(t) : t));
}
