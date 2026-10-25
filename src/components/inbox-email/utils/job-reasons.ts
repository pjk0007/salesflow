/** 가져오기 실패 사유 문구. 영구 사유는 다시 가져와도 같은 결과라 재시도 대상이 아니다. */
const labels: Record<string, { text: string; permanent: boolean }> = {
    invalid_source: {
        text: "메일 형식을 읽지 못함(발신자가 여럿이거나 큰 본문 등) — 원본 메일함에서 직접 확인해주세요",
        permanent: true,
    },
    intake_rejected: {
        text: "상담함에 넣을 수 없는 메일(다른 사업 주소 등) — 원본 메일함에서 확인해주세요",
        permanent: true,
    },
    transient: { text: "일시적인 연결 오류", permanent: false },
    rate_limited: { text: "Google 요청 한도 초과", permanent: false },
    auth: { text: "Google 권한 만료", permanent: false },
    scope: { text: "Google 메일 권한 부족", permanent: false },
    config: { text: "메일 연결 설정 변경", permanent: false },
    history_expired: { text: "Gmail 변경 기록 만료", permanent: false },
};
export function jobReasonLabel(code: string | null) {
    return (
        labels[code ?? ""] ?? { text: "기타 오류", permanent: false }
    );
}
export function retryableFailures(
    reasons: { reasonCode: string | null; count: number }[] | undefined,
) {
    return (reasons ?? [])
        .filter((r) => !jobReasonLabel(r.reasonCode).permanent)
        .reduce((sum, r) => sum + r.count, 0);
}
