import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { ambiguousCandidates, isAdminRole, isReplyScopeOrg, listReplies, type ReplyListFilters } from "@/lib/email-reply-list";
import { loadReplySyncStatus } from "@/lib/email-reply-sync";
import { describeReplyError } from "@/lib/email-reply-rules";

function positiveInt(value: string | null): number | undefined {
    if (!value || !/^\d+$/.test(value)) return undefined;
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * 회신 목록 (DESIGN-RPL 10-3·11절). 로그인 필요.
 * 사용자가 볼 수 있는 파티션의 발송에 이어진 회신만, 미분류·애매함은 관리자만.
 * meta.sync = 연결 상태 (모드·알림 모드·가린 메일함 주소·마지막 성공·오류 한국어·거슬러 읽기 끝남·뺀 주소·경고).
 * 회신 읽기 대상 조직(REPLY_WORKSPACE_IDS의 조직)이 아니면 meta.enabled=false·meta.sync=null — 대표 메일함 상태를
 * 다른 조직에 내려주지 않는다 (RH-SEC-5·OPS-6)
 */
export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const q = req.nextUrl.searchParams;
        const handled = q.get("handled");
        const filters: ReplyListFilters = {
            page: positiveInt(q.get("page")) ?? 1,
            pageSize: Math.min(positiveInt(q.get("pageSize")) ?? 50, 100),
            kind: q.get("kind") || undefined,
            matchStatus: q.get("matchStatus") || undefined,
            workspaceId: positiveInt(q.get("workspaceId")),
            recordId: positiveInt(q.get("recordId")),
            sendLogId: positiveInt(q.get("sendLogId")),
            handled: handled === "1" ? true : handled === "0" ? false : undefined,
            id: positiveInt(q.get("id")),
        };
        const admin = isAdminRole(user.role);
        // 미분류·애매함은 관리자만 — 멤버가 그 상태로 거르면 빈 목록
        if (!admin && filters.matchStatus && filters.matchStatus !== "matched") {
            filters.matchStatus = "__none__";
        }

        const enabled = await isReplyScopeOrg(user.orgId);
        const [{ items, totalCount }, sync] = await Promise.all([
            listReplies(user, filters),
            enabled ? loadReplySyncStatus() : Promise.resolve(null),
        ]);

        // 하나만 열 때(id) 애매함 줄이면 후보 발송을 붙인다 (관리자 옆 창)
        let candidates = undefined;
        if (filters.id && admin && items[0]?.matchStatus === "ambiguous") {
            candidates = await ambiguousCandidates(user.orgId, items[0]);
        }

        return NextResponse.json({
            success: true,
            data: items,
            totalCount,
            meta: {
                enabled,
                sync: sync === null ? null : admin ? sync : { ...sync, excluded: [] },
                isAdmin: admin,
                ...(candidates ? { candidates } : {}),
            },
        });
    } catch (error) {
        console.error("[replies] list error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
