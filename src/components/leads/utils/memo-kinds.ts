import { Calendar, Mail, MessageSquareText, MoreHorizontal, Phone, Users } from "lucide-react";

/** 리드 댓글 종류 — 서버 MEMO_KINDS(src/lib/leads/memo-input.ts)와 같은 값 */
export const MEMO_KIND_OPTIONS = [
    { value: "call", label: "통화", icon: Phone, className: "bg-blue-100 text-blue-700" },
    { value: "mail", label: "메일", icon: Mail, className: "bg-amber-100 text-amber-800" },
    { value: "meeting", label: "미팅", icon: Users, className: "bg-purple-100 text-purple-700" },
    { value: "sms", label: "문자", icon: MessageSquareText, className: "bg-emerald-100 text-emerald-700" },
    { value: "etc", label: "기타", icon: MoreHorizontal, className: "bg-slate-100 text-slate-700" },
] as const;

export type MemoKindValue = (typeof MEMO_KIND_OPTIONS)[number]["value"];

export function memoKindOf(value: string | null | undefined) {
    return MEMO_KIND_OPTIONS.find((k) => k.value === value) ?? null;
}

export const NextContactIcon = Calendar;
