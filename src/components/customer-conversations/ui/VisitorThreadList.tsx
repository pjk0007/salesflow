"use client";
import { ChevronRight, MessageCircle } from "lucide-react";
import type { VisitorThread } from "../hooks/useVisitorThreads";

const time = (v: string | null) =>
    v ? new Date(v).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/** 고객 상담창 › 대화 — 진행 중인 대화 목록 (비회원) */
export function VisitorThreadList({
    rows,
    loading,
    color,
    current,
    onOpen,
    onNew,
}: {
    rows: VisitorThread[];
    loading: boolean;
    color: string;
    current: string;
    onOpen: (token: string) => void;
    onNew: () => void;
}) {
    return (
        <div className="flex min-h-0 flex-1 flex-col bg-[#f7f7f9]">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {loading && !rows.length && <p className="py-10 text-center text-sm text-gray-400">대화를 불러오고 있어요…</p>}
                {!loading && !rows.length && <p className="py-10 text-center text-sm text-gray-400">진행 중인 대화가 없어요.</p>}
                {rows.map((r) => (
                    <button
                        key={r.token}
                        type="button"
                        onClick={() => onOpen(r.token)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left"
                    >
                        <MessageCircle size={20} style={{ color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-gray-900">{r.lastBody}</span>
                            <span className="mt-1 block text-xs text-gray-400">
                                {r.lastKind === "reply" ? "답변 도착" : "답변 기다리는 중"} · {time(r.lastAt)}
                                {r.token === current ? " · 지금 대화" : ""}
                            </span>
                        </span>
                        <ChevronRight size={16} className="text-gray-400" aria-hidden="true" />
                    </button>
                ))}
            </div>
            <div className="shrink-0 px-4 pb-4">
                <button
                    type="button"
                    onClick={onNew}
                    className="w-full rounded-lg py-3.5 text-sm font-semibold text-white"
                    style={{ backgroundColor: color }}
                >
                    상담 새로 열기
                </button>
            </div>
        </div>
    );
}
