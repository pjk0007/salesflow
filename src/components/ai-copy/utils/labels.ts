// 생성 기록의 내부 코드를 사용자 문구로 바꾸는 순수 함수(UX-241). 화면 여러 곳이 같은 규칙을 쓴다.

const REASONS: Record<string, string> = {
    token_quota: "AI 사용량 한도",
    preparation_deadline: "30분 준비 기한 경과",
    provider_not_configured: "AI 연결 확인 필요",
    provider_timeout: "생성 시간 초과",
    blocked_version: "차단된 버전",
    provider_network: "AI 연결 오류",
    worker_lease_expired: "작업 처리 중단(결과 미확인)",
    automation_call_failed: "자동 준비 AI 호출 실패",
    automation_lease_expired: "자동 준비 호출 결과 미확인",
};

/** 사유 코드 → 한국어. 이미 한국어로 적힌 사유는 그대로, 등록되지 않은 영문 코드는 '기타 사유'. */
export function reasonLabel(value: string | null): string {
    if (!value) return "—";
    if (REASONS[value]) return REASONS[value];
    if (value.startsWith("blocked_version:"))
        return `차단된 버전: ${value.slice("blocked_version:".length).trim()}`;
    const http = /^provider_http_(\d{3})$/.exec(value);
    if (http) return `AI 공급자 오류(HTTP ${http[1]})`;
    return /[가-힣]/.test(value) ? value : "기타 사유";
}

const RESULTS: Record<string, string> = {
    running: "진행 중",
    valid: "통과",
    validation_failed: "형식·검증 실패",
    provider_failed: "AI 호출 실패",
    timeout: "시간 초과",
    late: "늦은 응답",
};

/** 생성 시도 결과 코드 → 한국어. */
export const resultLabel = (value: string) => RESULTS[value] ?? "기타 결과";

/** 메일 HTML 본문을 읽기 쉬운 줄글로(태그 → 줄바꿈, 흔한 엔티티 복원). */
export const plainTextFromHtml = (html: string) =>
    html
        .replace(/<[^>]*>/g, "\n")
        .replace(/\n+/g, "\n")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .trim();
