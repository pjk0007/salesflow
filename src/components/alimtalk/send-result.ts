/** 발송 요청 결과 머리의 표시. 접수 0건이거나 실패·확인 필요가 섞이면 초록 체크 대신 경고로 보인다(UI확인-V6). */
export function sendResultHeading(result: { successCount: number; failCount: number; unknownCount?: number }): { tone: "success" | "warning"; title: string } {
    if (result.successCount === 0) return { tone: "warning", title: (result.unknownCount ?? 0) > 0 ? "접수 여부를 확인해야 합니다" : "접수된 발송이 없습니다" };
    if (result.failCount > 0 || (result.unknownCount ?? 0) > 0) return { tone: "warning", title: "일부만 접수되었습니다" };
    return { tone: "success", title: "발송 요청 결과" };
}
