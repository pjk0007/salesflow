import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getEmailConfig } from "@/lib/nhn-email";
import { loadOrgSenderProfiles } from "@/lib/email-sender-resolver";
import { normalizeSenderPool } from "@/lib/email-sender-limit-rules";
import { lookupDomainMx } from "@/lib/email-mx-lookup";
import { emailDomain, poolSenderEntries } from "@/lib/reply-to-rules";
import type { MxStatus, SenderMxEntry } from "@/lib/reply-to-rules";

/**
 * GET /api/email/reply-to[?senderProfileIds=3,4]
 *
 * AI 규칙 화면의 답장 안내 (DESIGN-3). 고객 답장은 메일을 보낸 주소(From)로 간다 — NHN이 Reply-To 헤더를 받지 않아
 * 답장 주소를 따로 정할 수 없다 (DESIGN-3 6절 "실제 발송 결과(2026-10-04)와 바뀐 결정"). 그래서 발신 주소의 도메인이 메일을 받는지(MX)만 알린다.
 * 보기만 하므로 조직 구성원이면 누구나 본다.
 * - senders: 조직의 발신 주소 전부와 도메인 MX (설정 발신자는 profileId null). 화면이 묶음을 고칠 때 다시 묻지 않게 다 준다
 * - pool: senderProfileIds 묶음이 실제로 쓸 주소 (발송과 같은 규칙 — 묶음이 비었거나 없는 주소뿐이면 기본 주소 → 설정 발신자)
 * - poolNoMxDomains: pool 중 메일을 받지 않는(MX 없음) 도메인 — 이 주소로 나간 메일의 답장은 되돌아간다
 * MX는 도메인마다 캐시하고(ok 하루, none·unknown 10분 — MX를 연결하면 10분 안에 안내가 걷힌다) 짧은 시간 제한을 둔다
 * (email-mx-lookup.ts). 조회 실패는 "unknown" (안내하지 않는다)
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const poolInput = parseIdList(req.nextUrl.searchParams.get("senderProfileIds"));
    const pool = normalizeSenderPool(poolInput);
    if (!pool.ok) {
        return NextResponse.json({ success: false, error: pool.error }, { status: 400 });
    }

    try {
        // 1. 조직의 발신 주소 (프로필 + 설정 발신자)
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

        // 2. 도메인마다 한 번 MX 조회 (캐시)
        const domains = [...new Set(rawSenders.map((s) => s.domain).filter((d): d is string => !!d))];
        const mxList = await Promise.all(domains.map((d) => lookupDomainMx(d)));
        const mxByDomain = new Map<string, MxStatus>(domains.map((d, i) => [d, mxList[i]]));
        const senders: SenderMxEntry[] = rawSenders.map((s) => ({ ...s, mx: s.domain ? mxByDomain.get(s.domain) ?? null : null }));

        const poolEntries = poolSenderEntries(pool.ids ?? [], senders);
        const poolNoMxDomains = [...new Set(poolEntries.filter((s) => s.mx === "none" && s.domain).map((s) => s.domain as string))];

        return NextResponse.json({
            success: true,
            data: { senders, pool: poolEntries, poolNoMxDomains },
        });
    } catch (error) {
        console.error("[reply-to] 조회 오류:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

/** "3,4,5" → [3,4,5]. 없거나 비었으면 null (묶음 없음 = 기본 주소). 숫자가 아닌 조각은 그대로 넘겨 검사에서 걸린다 */
function parseIdList(raw: string | null): unknown {
    if (raw === null || raw.trim() === "") return null;
    return raw.split(",").map((t) => (/^\s*\d+\s*$/.test(t) ? Number(t) : t));
}
