import type { EnvelopeState, EsignField, JobState } from "@/lib/esign/types";

export const fieldLabels: Record<EsignField["type"], string> = { signature: "서명", seal: "도장", name: "이름", date: "날짜", text: "텍스트" };
export const envelopeLabels: Record<EnvelopeState, string> = { draft: "작성 중", pending: "서명 진행 중", finalizing: "완료 문서 준비 중", completed: "완료", cancelled: "취소", rejected: "거절", expired: "만료" };
export const deliveryLabels: Record<JobState, string> = { blocked: "순서 대기", pending: "발송 대기", processing: "처리 중", accepted: "접수됨", failed: "실패", unknown: "확인 필요", cancelled: "취소됨" };
export const roleColors = ["#2563eb", "#9333ea", "#c2410c", "#15803d", "#be185d"];
export function displayDate(value: string) { return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }); }
export function localDateTimeValue(days: number) { const date = new Date(Date.now() + days * 86400000); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
export function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
