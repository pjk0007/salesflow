"use client";

import { ArrowRight, ChevronRight, MessageCircle } from "lucide-react";

export type MessengerBusinessHours = {
    open: boolean;
    nextOpenAt: string | null;
    timezone: string;
    awayMessage: string;
};

export function MessengerHome({
    name,
    greeting,
    color,
    businessHours,
    busy,
    loading,
    returning,
    unread,
    hasConversations,
    onStart,
    onConversations,
}: {
    name: string;
    greeting: string;
    color: string;
    businessHours?: MessengerBusinessHours | null;
    busy: boolean;
    loading: boolean;
    returning: boolean;
    unread: number;
    hasConversations: boolean;
    onStart: () => void;
    onConversations: () => void;
}) {
    return (
        <section
            aria-label="상담 홈"
            className="min-h-0 flex-1 overflow-y-auto bg-[#f7f7f9] px-5 pb-6 pt-8"
        >
            <header className="mb-7 px-1">
                <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm"
                    style={{ backgroundColor: color }}
                >
                    <MessageCircle size={26} aria-hidden="true" />
                </div>
                <h1 className="break-words text-2xl font-bold tracking-tight">
                    {name}
                </h1>
                <p className="mt-2 text-sm text-gray-500">
                    궁금한 점을 편하게 물어보세요.
                </p>
            </header>

            <article className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-start gap-3">
                    <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                        style={{ backgroundColor: `${color}12`, color }}
                        aria-hidden="true"
                    >
                        {name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold">{name}</h2>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                            {greeting ||
                                "방문해주셔서 감사합니다.\n어떻게 도와드릴까요?"}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    disabled={busy || loading}
                    onClick={onStart}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: color }}
                >
                    {loading
                        ? "상담을 준비하고 있어요…"
                        : returning
                          ? "상담 이어가기"
                          : "문의하기"}
                    <ArrowRight size={17} aria-hidden="true" />
                </button>
                <p className="mt-3 text-center text-xs leading-5 text-gray-400">
                    메시지를 남기면 이곳에서 답변을 확인할 수 있어요.
                </p>
                {businessHours && (
                    <details className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
                        <summary className="cursor-pointer">
                            상담 운영 안내
                        </summary>
                        <p className="mt-2 leading-5">
                            {businessHours.open
                                ? "지금은 담당자 상담 업무시간입니다."
                                : businessHours.awayMessage}
                        </p>
                        {!businessHours.open && businessHours.nextOpenAt && (
                            <p className="mt-1 leading-5">
                                다음 업무 시작:{" "}
                                {new Date(
                                    businessHours.nextOpenAt,
                                ).toLocaleString("ko-KR", {
                                    timeZone: businessHours.timezone,
                                })}
                            </p>
                        )}
                    </details>
                )}
            </article>

            {hasConversations && (
                <button
                    type="button"
                    disabled={busy || loading}
                    onClick={onConversations}
                    className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm disabled:opacity-50"
                >
                    <MessageCircle
                        size={20}
                        style={{ color }}
                        aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                            이전 대화 이어보기
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">
                            {unread
                                ? `확인하지 않은 답변 ${unread}개`
                                : "남긴 문의와 답변을 확인하세요"}
                        </span>
                    </span>
                    {unread > 0 && (
                        <span
                            className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                            style={{ backgroundColor: color }}
                        >
                            {unread > 99 ? "99+" : unread}
                        </span>
                    )}
                    <ChevronRight
                        size={16}
                        className="text-gray-400"
                        aria-hidden="true"
                    />
                </button>
            )}
            <p className="mt-6 text-center text-[10px] text-gray-400">
                Sendb 고객 상담
            </p>
        </section>
    );
}
