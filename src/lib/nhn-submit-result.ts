import { EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT } from "./email-send-guard";

// API resultCode는 HTTP 상태가 아니다. -9999(시스템 오류), -1005(알림톡 중복 키),
// 새 코드·HTTP/네트워크 오류는 접수 불명으로 남긴다. 문서상 입력/인증 거절만 확정한다.
// https://docs.nhncloud.com/ko/Notification/KakaoTalk%20Bizmessage/ko/error-code/
const ALIMTALK_REJECTIONS = new Set([4, -1000, -1001, -1002, -1003, -1006, -1019, -1020, -1027, -1028,
    -2000, -2001, -2002, -2003, -2004, -2005, -2017, -2018, -2033, -2034, -2036,
    -2502, -2504, -3000, -3002, -3003, -3004, -3005, -3006, -3007, -3008, -3009,
    -9993, -9994, -9996, -9997, -9998]);
// https://docs.nhncloud.com/ko/Notification/Email/ko/error-code/
const EMAIL_REJECTIONS = new Set([-1000, -1001, -1002, -1003, -1004, -1005, -1007,
    -2000, -2001, -2010, -2011, -2012, -2013, -2014, -2015, -2016, -2017,
    -5000, -5002, -5003, -9993, -9995, -9996, -9997, -9998,
    EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT]);
export const isKnownAlimtalkRejection = (code: unknown): boolean => typeof code === "number" && ALIMTALK_REJECTIONS.has(code);
/** 알림톡 1건 발송 요청 응답 판정. 개별 접수 성공은 pending(수신 결과는 logs/sync가 확정)이다. */
export function classifyAlimtalkSubmission(result: {
    header?: { isSuccessful?: boolean; resultCode?: number } | null;
    message?: { requestId?: unknown; sendResults?: Array<{ resultCode?: unknown }> | null } | null;
} | null | undefined): "pending" | "failed" | "unknown" {
    if (!result?.header) return "unknown";
    if (result.header.isSuccessful === false) return isKnownAlimtalkRejection(result.header.resultCode) ? "failed" : "unknown";
    const item = Array.isArray(result.message?.sendResults) ? result.message.sendResults[0] : undefined;
    if (!item || typeof item.resultCode !== "number") return "unknown";
    if (item.resultCode === 0) return typeof result.message?.requestId === "string" && result.message.requestId ? "pending" : "unknown";
    return isKnownAlimtalkRejection(item.resultCode) ? "failed" : "unknown";
}
export const isKnownEmailRejection = (code: unknown): boolean => typeof code === "number" && EMAIL_REJECTIONS.has(code);

export function classifyEmailSubmission(result: {
    header: { isSuccessful: boolean; resultCode: number };
    data?: { requestId?: string; results?: { resultCode: number }[] } | null;
}): "sent" | "failed" | "unknown" {
    const results = result.data?.results;
    if (result.header.isSuccessful && result.data?.requestId && results?.length && results.every(r => r.resultCode === 0)) return "sent";
    if ((!result.header.isSuccessful && isKnownEmailRejection(result.header.resultCode)) ||
        (result.header.isSuccessful && results?.length && results.every(r => isKnownEmailRejection(r.resultCode)))) return "failed";
    return "unknown";
}

type EmailResultLike = {
    header: { isSuccessful: boolean; resultCode: number; resultMessage?: string | null };
    /** 발송 응답이면 { results }, 조회·카테고리 응답이면 다른 모양 — results만 읽는다 */
    data?: unknown;
};
type RecipientResult = { resultCode: number; resultMessage?: string | null };

/**
 * NHN 메일 API 실패를 사용자 안내 문구로 (UX-160). 'HTTP 401: Unauthorized' 같은 영문 내부 문구를 그대로 보내지 않는다.
 * - HTTP 오류(nhn-email.ts request가 resultCode에 HTTP 상태를 담는다): 키·일시 장애를 구분해 안내
 * - 수신 거부·확인 실패(email-send-guard, 음수 -71xx): 이미 한국어 문구라 그대로
 * - NHN API 결과 코드: 수동 발송과 같은 "NHN이 … 받지 않았습니다" 형식에 코드와 NHN 원문을 괄호로 덧붙인다
 * action: "발송" | "연결 확인" | "카테고리 조회" 등 — 문장의 대상
 */
export function nhnEmailFailureMessage(result: EmailResultLike, action = "발송"): string {
    const results = (result.data as { results?: RecipientResult[] } | null | undefined)?.results;
    const recipient = result.header.isSuccessful && Array.isArray(results) ? results.find((r) => r.resultCode !== 0) : undefined;
    const code = recipient ? recipient.resultCode : result.header.resultCode;
    const original = (recipient ? recipient.resultMessage : result.header.resultMessage)?.trim() ?? "";
    if (!recipient && /^HTTP \d{3}/.test(original)) {
        if (code === 401 || code === 403) return `NHN 인증에 실패해 ${action}하지 못했습니다. 이메일 설정의 App Key와 Secret Key를 확인해주세요.`;
        if (code === 404) return `NHN에서 이 App Key의 서비스를 찾지 못해 ${action}하지 못했습니다. App Key를 확인해주세요.`;
        if (code === 429) return `요청이 많아 NHN이 잠시 거절했습니다. 잠시 후 다시 ${action}해주세요.`;
        if (code >= 500) return `NHN 서버에 일시적인 문제가 있어 ${action}하지 못했습니다. 잠시 후 다시 시도해주세요.`;
        return `NHN이 요청을 받지 않아 ${action}하지 못했습니다 (HTTP ${code}).`;
    }
    if (code === EMAIL_SEND_BLOCKED || code === EMAIL_SEND_CHECK_FAILED || code === EMAIL_SEND_INVALID_CONTEXT) return original;
    return `NHN이 ${action} 요청을 받지 않았습니다 (코드 ${code}${original ? `: ${original}` : ""}). 발신 주소가 NHN에 등록됐는지와 키 설정을 확인해주세요.`;
}
