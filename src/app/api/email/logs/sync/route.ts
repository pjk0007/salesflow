import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { syncOrgStatuses } from "@/lib/email-status-sync";
import { syncWarning } from "@/lib/email-status-sync-rules";

/**
 * 발송 이력 화면의 "동기화" 버튼 (DESIGN-SND 3-7).
 * 10분 cron(POST /api/email/status-sync/process)과 같은 함수를 부른다 — 그 조직이 든 appKey 묶음의 커서 따라잡기 + 늦은 기록 보조 질문.
 * 결과 기록 규칙이 두 벌이면 한쪽만 고쳐진다. 예전 "30일 sent 전부 다시 보기" 단계는 없앴다 (대량에서 끝까지 못 돌았다).
 * 응답 이름(synced·updated)은 화면이 읽던 그대로 둔다.
 */
export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const stats = await syncOrgStatuses(user.orgId, { maxCalls: 100, trigger: "manual" });
        if (!stats) {
            return NextResponse.json({ success: false, error: "이메일 설정이 필요합니다." }, { status: 400 });
        }
        if (stats.skippedAsLocked) {
            return NextResponse.json({
                success: true,
                data: { synced: 0, updated: 0, statusCorrected: 0, busy: true, message: "다른 동기화가 도는 중입니다. 잠시 뒤 다시 눌러 주세요." },
            });
        }
        return NextResponse.json({
            success: true,
            data: {
                synced: stats.finalized,
                updated: stats.updated,
                statusCorrected: stats.failedNew,
                calls: stats.calls,
                windows: stats.windows,
                unpaired: stats.unpaired,
                errors: stats.errors,
                // 조회가 실패했으면 성공 토스트 대신 경고를 보이게 한다 (UX-260). failureKind=auth면 키 확인
                ...(syncWarning(stats) ? { warning: syncWarning(stats), failureKind: stats.lastFailure?.kind ?? "transient" } : {}),
            },
        });
    } catch (error) {
        // 오류 객체를 통째로 찍지 않는다 — 쿼리 매개변수에 받는 주소가 섞일 수 있다
        console.error("Email sync error:", error instanceof Error ? error.message.slice(0, 200) : "unknown");
        return NextResponse.json({ success: false, error: "동기화에 실패했습니다." }, { status: 500 });
    }
}
