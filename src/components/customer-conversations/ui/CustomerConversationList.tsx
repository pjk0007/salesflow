"use client";
import { ArrowLeft, Plus } from "lucide-react";
import type { useCustomerConversations } from "../hooks/useCustomerConversations";

const status = { open: "진행 중", snoozed: "답변 대기", closed: "완료" };
function timestamp(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleString("ko-KR", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
          });
}
export function CustomerConversationList({
    history,
    busy,
    onOpen,
    onNew,
    onBack,
}: {
    history: ReturnType<typeof useCustomerConversations>;
    busy: boolean;
    onOpen: (id: string) => void;
    onNew: () => void;
    onBack: () => void;
}) {
    return (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="내 문의 목록">
            <div className="border-b p-3">
                <div className="flex items-center justify-between gap-2">
                    <button type="button" disabled={busy} onClick={onBack} className="flex items-center gap-1 text-sm disabled:opacity-50">
                        <ArrowLeft className="h-4 w-4" /> 현재 문의로 돌아가기
                    </button>
                    <button type="button" disabled={busy} onClick={onNew} className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-sm font-medium disabled:opacity-50">
                        <Plus className="h-4 w-4" /> 새 문의
                    </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">새 문의는 첫 메시지를 보낼 때 만들어집니다. 작성 중인 내용은 문의별로 보관합니다.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {history.error && (
                    <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
                        <p>{history.error.message}</p>
                        <button type="button" disabled={history.loading} onClick={() => void history.refresh()} className="mt-1 underline disabled:opacity-50">다시 불러오기</button>
                    </div>
                )}
                {!history.rows.length && !history.loading && !history.error && (
                    <p className="py-8 text-center text-sm text-gray-500">아직 남긴 문의가 없습니다. 새 문의로 이야기를 시작해 주세요.</p>
                )}
                <ul className="space-y-2">
                    {history.rows.map((row) => (
                        <li key={row.id}>
                            <button type="button" disabled={busy} onClick={() => onOpen(row.id)} className="w-full rounded-xl border p-3 text-left hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="line-clamp-2 break-words text-sm font-semibold">{row.title || "문의"}</span>
                                    {row.unread > 0 && <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white" aria-label={`안 읽은 답변 ${row.unread}개`}>{row.unread > 99 ? "99+" : row.unread}</span>}
                                </div>
                                <p className="mt-1 line-clamp-2 break-words text-sm text-gray-600">{row.preview || "파일 첨부"}</p>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-gray-500">
                                    <span>{status[row.status]}{row.isCurrent ? " · 현재 문의" : ""}</span>
                                    <time dateTime={row.lastMessageAt}>{timestamp(row.lastMessageAt)}</time>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
                {history.loading && !history.rows.length && <p role="status" className="py-3 text-center text-sm text-gray-500">문의를 불러오는 중…</p>}
                {history.hasMore && (
                    <button type="button" disabled={busy || history.loading} onClick={() => void history.loadMore()} className="mt-3 w-full rounded-lg border p-2 text-sm disabled:opacity-50">이전 문의 더 보기</button>
                )}
            </div>
        </section>
    );
}
