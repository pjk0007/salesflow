import type { EnvelopeState, EsignField, JobState, EsignChannel } from "@/lib/esign/types";

export const fieldLabels: Record<EsignField["type"], string> = { signature: "서명", seal: "도장", name: "이름", date: "날짜", text: "텍스트" };
export const envelopeLabels: Record<EnvelopeState, string> = { draft: "작성 중", pending: "서명 진행 중", finalizing: "완료 문서 준비 중", completed: "완료", cancelled: "취소", rejected: "거절", expired: "만료" };
export const deliveryLabels: Record<JobState, string> = { blocked: "순서 대기", pending: "발송 대기", processing: "처리 중", accepted: "접수됨", failed: "실패", unknown: "확인 필요", cancelled: "취소됨" };
export const roleColors = ["#2563eb", "#9333ea", "#c2410c", "#15803d", "#be185d"];
export function displayDate(value: string) { return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }); }
export function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

export const channelLabels: Record<EsignChannel, string> = { email: "이메일", alimtalk: "알림톡", sms: "SMS" };

/** 공개 서명자 화면은 외부인이 본다 — 서버 설정 문구(암호화 키·DB·저장소 등)는 고객용 안내로 바꾼다. */
export const SIGNER_UNAVAILABLE_MESSAGE = "전자서명 서비스를 잠시 사용할 수 없습니다. 잠시 후 다시 확인하거나 요청자에게 문의해 주세요.";
export function signerErrorMessage(cause: unknown, fallback: string) {
    if ((cause as { code?: unknown } | null)?.code === "configuration") return SIGNER_UNAVAILABLE_MESSAGE;
    return cause instanceof Error && cause.message ? cause.message : fallback;
}
