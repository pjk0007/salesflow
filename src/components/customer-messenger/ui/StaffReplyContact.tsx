"use client";
import useSWR from "swr";
import { inboxRequest } from "@/components/inbox/api";
export function StaffReplyContact({ id }: { id: string }) {
    const { data, error } = useSWR<{
        name: string;
        phone: string;
        email: string;
        notifyEmail: boolean;
    } | null>(`/api/inbox/conversations/${id}/reply-contact`, inboxRequest, {
        refreshInterval: 10000,
    });
    if (error)
        return (
            <p className="rounded-xl border p-3 text-xs text-red-600">
                고객이 남긴 연락처를 불러오지 못했습니다.
            </p>
        );
    if (!data) return null;
    return (
        <section
            aria-label="고객이 남긴 상담 연락처"
            className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/40 p-4 text-xs"
        >
            <h3 className="font-semibold">고객이 남긴 상담 연락처</h3>
            {data.name && <p>{data.name}</p>}
            {data.phone && (
                <a
                    className="block underline"
                    href={`tel:${data.phone.replace(/[^+\d]/g, "")}`}
                >
                    {data.phone}
                </a>
            )}
            {data.email && (
                <a
                    className="block break-all underline"
                    href={`mailto:${data.email}`}
                >
                    {data.email}
                </a>
            )}
            <p className="text-gray-500">
                {data.notifyEmail
                    ? "이메일 답변 알림 수신 동의·인증 완료"
                    : "이메일 답변 알림 꺼짐 또는 인증 대기"}
            </p>
            <p className="text-gray-400">
                현재 문의에 남긴 정보 · 회원 본인 확인과 별개
            </p>
        </section>
    );
}
