"use client";

import { ArrowRight, ChevronRight, MessageCircle } from "lucide-react";
import { WelcomeProcess } from "./WelcomeProcess";
import type { PublicMessengerSettings } from "../types";

export type MessengerBusinessHours = {
    open: boolean;
    nextOpenAt: string | null;
    timezone: string;
    awayMessage: string;
};

export function MessengerHome({
    name,
    greeting,
    settings,
    customerName,
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
    settings?: PublicMessengerSettings;
    customerName?: string;
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
        <div className="flex min-h-0 flex-1 flex-col">
            <section
                aria-label="상담 홈"
                className="min-h-0 flex-1 overflow-y-auto bg-[#f7f7f9] px-5 pb-5 pt-5"
            >
                <header className="mb-4 px-1">
                    <div
                        className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl text-white shadow-sm"
                        style={{ backgroundColor: color }}
                    >
                        <MessageCircle size={26} aria-hidden="true" />
                    </div>
                    <h1 className="break-words text-2xl font-bold tracking-tight">
                        {name}
                    </h1>
                    <p className="mt-2 text-sm text-gray-500">
                        {settings?.tagline || "궁금한 점을 편하게 물어보세요."}
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
                            <WelcomeProcess
                                settings={settings}
                                customerName={customerName}
                                greeting={greeting}
                            />
                        </div>
                    </div>
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
                            {!businessHours.open &&
                                businessHours.nextOpenAt && (
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
            <div className="shrink-0 border-t border-gray-100 bg-white px-5 py-3">
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
                    {settings?.enabled && settings.consultationUrl ? (
                        <a
                            href={settings.consultationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-violet-700"
                        >
                            처음이시라면 1:1 도입 상담 신청하기 ↗
                        </a>
                    ) : (
                        "메시지를 남기면 이곳에서 답변을 확인할 수 있어요."
                    )}
                </p>
            </div>
        </div>
    );
}
