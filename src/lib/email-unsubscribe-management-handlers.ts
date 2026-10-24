import { NextRequest, NextResponse } from "next/server";
import type { UnsubscribeEntry, UnsubscribeLookupResult, UnsubscribeTarget } from "@/components/email/unsubscribes/types";
import { manualUnsubscribeInput, parseUnsubscribePagination, parseUnsubscribeTarget, unsubscribeLookupInput } from "./email-unsubscribe-management-rules";

interface Identity { orgId: string; role: string }
interface Dependencies {
    authenticate: (request: NextRequest) => Identity | null | Promise<Identity | null>;
    list: (orgId: string, options: { page: number; pageSize: number; q: string }) => Promise<{ items: UnsubscribeEntry[]; totalCount: number }>;
    register: (orgId: string, input: { email: string; reason?: string }) => Promise<void>;
    lookup: (orgId: string, targets: UnsubscribeTarget[]) => Promise<UnsubscribeLookupResult[]>;
}

function failure(error: string, status: number) {
    return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

function success(data: unknown) {
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
}

/** Keep identity outside request bodies: all reads and writes take the authenticated organization. */
export function createUnsubscribeManagementHandlers(deps: Dependencies) {
    function identityError(request: NextRequest, user: Identity) {
        const expectedOrgId = request.headers.get("x-sendb-org-id");
        return expectedOrgId && expectedOrgId !== user.orgId
            ? failure("조직이 변경되었습니다. 페이지를 새로고침해주세요.", 409)
            : null;
    }
    return {
        async GET(request: NextRequest) {
            const user = await deps.authenticate(request);
            if (!user) return failure("인증이 필요합니다.", 401);
            const mismatch = identityError(request, user);
            if (mismatch) return mismatch;
            const options = parseUnsubscribePagination(request.nextUrl.searchParams);
            if (!options) return failure("검색어나 페이지 범위를 확인해주세요.", 400);
            try {
                return success({ ...await deps.list(user.orgId, options), page: options.page, pageSize: options.pageSize, canManage: user.role === "owner" || user.role === "admin" });
            } catch {
                return failure("수신거부 목록을 불러오지 못했습니다.", 500);
            }
        },
        async POST(request: NextRequest) {
            const user = await deps.authenticate(request);
            if (!user) return failure("인증이 필요합니다.", 401);
            const mismatch = identityError(request, user);
            if (mismatch) return mismatch;
            if (user.role !== "owner" && user.role !== "admin") return failure("수동 등록은 관리자만 할 수 있습니다.", 403);
            const parsed = manualUnsubscribeInput.safeParse(await request.json().catch(() => null));
            if (!parsed.success) return failure("정확한 이메일 주소와 1,000자 이내의 사유를 입력해주세요. 도메인 전체 등록은 지원하지 않습니다.", 400);
            try {
                await deps.register(user.orgId, parsed.data);
                return success({ email: parsed.data.email });
            } catch {
                return failure("수신거부 등록에 실패했습니다.", 500);
            }
        },
        async lookup(request: NextRequest) {
            const user = await deps.authenticate(request);
            if (!user) return failure("인증이 필요합니다.", 401);
            const mismatch = identityError(request, user);
            if (mismatch) return mismatch;
            const parsed = unsubscribeLookupInput.safeParse(await request.json().catch(() => null));
            if (!parsed.success) return failure("이메일 또는 도메인을 1~50개 입력해주세요.", 400);
            const targets = parsed.data.targets.map(parseUnsubscribeTarget);
            if (targets.some((target) => !target)) return failure("이메일 또는 도메인 형식을 확인해주세요. URL과 와일드카드는 사용할 수 없습니다.", 400);
            const uniqueTargets = [...new Map((targets as UnsubscribeTarget[]).map((target) => [target.query, target])).values()];
            try {
                return success(await deps.lookup(user.orgId, uniqueTargets));
            } catch {
                return failure("수신거부 여부를 확인하지 못했습니다.", 500);
            }
        },
    };
}
