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
