"use client";
import { useState } from "react";
import { IdCard } from "lucide-react";
import { useToday } from "../hooks/useRelationship";
import { GreetingCardItem } from "./GreetingCardItem";
import { BusinessCardDialog } from "./BusinessCardDialog";
/** 오늘의 인사(작업카드 함). 기획서 4절 ①. */
export function RelationshipToday({
    workspaceId,
    canRespond,
    onOpenContact,
}: {
    workspaceId: number;
    canRespond: boolean;
    onOpenContact: (contactId: string) => void;
}) {
    const [scope, setScope] = useState<"mine" | "all">("mine");
    const [cardOpen, setCardOpen] = useState(false);
    const today = useToday(workspaceId, scope);
    const counts = today.data?.counts;
    return (
        <section className="px-5 pb-8" aria-label="오늘의 인사">
            <div className="flex flex-wrap items-center justify-between gap-3 py-5">
                <div>
                    <h2 className="font-semibold">오늘의 인사</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        명함을 주고받은 사람에게 점검 주기마다 가볍게 안부를 전합니다. 초안은 고쳐서 보내세요.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        aria-label="인맥 범위"
                        className="rounded-lg border bg-background p-2 text-sm"
                        value={scope}
                        onChange={(e) => setScope(e.target.value as "mine" | "all")}
                    >
                        <option value="mine">내 인맥</option>
                        <option value="all">사업 전체</option>
                    </select>
                    <button
                        className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                        disabled={!canRespond}
                        onClick={() => setCardOpen(true)}
                    >
                        <IdCard size={16} />
                        명함 등록
                    </button>
                </div>
            </div>
            {counts && (
                <ul className="mb-4 flex flex-wrap gap-2 text-xs" aria-label="인맥 현황">
                    <li className="rounded-full border px-3 py-1">관리 중 {counts.managed}명</li>
                    <li className="rounded-full bg-red-50 px-3 py-1 text-red-700">기한 초과 {counts.overdue}명</li>
                    <li className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">첫 인사 전 {counts.welcome}명</li>
                    {counts.carriedOver > 0 && (
                        <li className="rounded-full bg-muted px-3 py-1">대기 {counts.carriedOver}명 · 위 카드를 처리하면 올라옵니다</li>
                    )}
                    {counts.deferredByMarketing > 0 && (
                        <li className="rounded-full bg-muted px-3 py-1">
                            최근 마케팅 메일을 받아 미룸 {counts.deferredByMarketing}명
                        </li>
                    )}
                </ul>
            )}
            {today.error && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    {today.error.message}
                    <button className="ml-3 underline" onClick={() => void today.mutate()}>
                        다시 불러오기
                    </button>
                </p>
            )}
            {today.isLoading ? (
                <p className="p-8 text-sm text-muted-foreground">불러오는 중…</p>
            ) : today.data && !today.data.cards.length ? (
                <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
                    {counts?.managed
                        ? "오늘 인사할 사람이 없습니다. 점검 주기가 돌아오면 여기에 카드가 뜹니다."
                        : "아직 관계 관리 중인 인맥이 없습니다. 받은 명함을 등록하거나, 고객 상세에서 관계 관리를 시작하세요."}
                </div>
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    {today.data?.cards.map((card) => (
                        <div key={card.contactId}>
                            <GreetingCardItem
                                card={card}
                                workspaceId={workspaceId}
                                showOwner={scope === "all"}
                                canRespond={canRespond}
                                onDone={() => today.mutate()}
                            />
                            <button
                                className="mt-1 text-xs text-violet-700"
                                onClick={() => onOpenContact(card.contactId)}
                            >
                                고객 상세 열기
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <BusinessCardDialog
                open={cardOpen}
                workspaceId={workspaceId}
                onOpenChange={setCardOpen}
                onSaved={() => today.mutate()}
            />
        </section>
    );
}
