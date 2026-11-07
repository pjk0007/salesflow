import { phoneDigits } from "@/lib/relationship-care/rules";
/** 메일 앱 열기 링크. 본문은 사람이 확인한 초안 그대로 넣는다. */
export function mailtoLink(email: string, subject: string, body: string) {
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
/** 휴대폰 문자 앱 열기 링크(iOS·안드로이드 모두 ?body= 를 받는다) */
export function smsLink(phone: string, body: string) {
    return `sms:${phoneDigits(phone)}?body=${encodeURIComponent(body)}`;
}
export function lastTouchText(days: number | null) {
    if (days === null) return "아직 연락 기록 없음";
    if (days === 0) return "오늘 연락함";
    return `마지막 연락 ${days}일 전`;
}
/** 오늘(서울) YYYY-MM-DD */
export function seoulToday(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}
