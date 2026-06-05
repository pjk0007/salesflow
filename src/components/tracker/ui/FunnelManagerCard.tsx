"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, Plus, Star, Pencil, Trash2, Copy, Check, Code, Activity } from "lucide-react";
import { toast } from "sonner";
import { FunnelEditorDialog } from "./FunnelEditorDialog";
import { useTrackerFunnels, deleteFunnel, updateFunnel } from "../hooks/useTrackerFunnels";
import type { FunnelDefinition, FunnelKind } from "../types/funnel";

interface Props {
    siteId: number;
}

function CopyBtn({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            size="sm" variant="ghost" className="h-6 px-1.5"
            onClick={() => {
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
        >
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        </Button>
    );
}

interface RowProps {
    funnel: FunnelDefinition;
    onEdit: (f: FunnelDefinition) => void;
    onDelete: (f: FunnelDefinition) => void;
    onSetDefault: (f: FunnelDefinition) => void;
}

function FunnelRow({ funnel: f, onEdit, onDelete, onSetDefault }: RowProps) {
    const isEvent = f.kind === "event";
    return (
        <li className="rounded-md border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        {/* 메인 표시(별)는 마케팅 퍼널만 */}
                        {!isEvent && (f.isDefault ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" /> : <span className="w-3.5" />)}
                        <span className="text-sm font-medium">{f.name}</span>
                        {!isEvent && f.isDefault === 1 && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                메인
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {isEvent ? "" : "방문 → 리드 → "}
                        {f.stages.map((s) => s.label).join(" → ") || "(단계 미정의)"}
                    </p>
                </div>
                <div className="flex shrink-0 gap-1">
                    {!isEvent && !f.isDefault && (
                        <Button size="sm" variant="ghost" onClick={() => onSetDefault(f)} title="메인으로">
                            <Star className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => onEdit(f)}>
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(f)} className="text-rose-600 hover:text-rose-700">
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
        </li>
    );
}

/**
 * 트래커 설정 탭 — 사이트의 사용자정의 퍼널 관리.
 * 마케팅 퍼널(방문/리드 자동 + 상태 단계)과 행동 퍼널(CUSTOM 이벤트 단계)을
 * 한 카드 안에서 두 섹션으로 분리해, 각각 추가/관리한다.
 */
export function FunnelManagerCard({ siteId }: Props) {
    const { funnels, isLoading, mutate } = useTrackerFunnels(siteId);
    const [editing, setEditing] = useState<FunnelDefinition | null>(null);
    const [newKind, setNewKind] = useState<FunnelKind>("marketing");
    const [open, setOpen] = useState(false);

    const marketingFunnels = useMemo(() => funnels.filter((f) => f.kind !== "event"), [funnels]);
    const eventFunnels = useMemo(() => funnels.filter((f) => f.kind === "event"), [funnels]);

    // 행동 퍼널 단계로 정의된 CUSTOM 이벤트 코드 — 사이트에 심어야 데이터가 쌓인다.
    const customEventCodes = useMemo(() => {
        const seen = new Map<string, string>(); // eventName → label
        for (const f of eventFunnels) {
            for (const s of f.stages) {
                if (s.match.type === "custom_event" && s.match.eventName) {
                    if (!seen.has(s.match.eventName)) seen.set(s.match.eventName, s.label);
                }
            }
        }
        return [...seen.entries()].map(([eventName, label]) => ({ eventName, label }));
    }, [eventFunnels]);

    const handleAdd = (kind: FunnelKind) => {
        setEditing(null);
        setNewKind(kind);
        setOpen(true);
    };
    const handleEdit = (f: FunnelDefinition) => {
        setEditing(f);
        setOpen(true);
    };
    const handleDelete = async (f: FunnelDefinition) => {
        if (!confirm(`"${f.name}" 퍼널을 삭제하시겠습니까?`)) return;
        try {
            await deleteFunnel(f.id);
            toast.success("삭제되었습니다.");
            mutate();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "삭제 실패");
        }
    };
    const setAsDefault = async (f: FunnelDefinition) => {
        try {
            await updateFunnel(f.id, { isDefault: true });
            toast.success(`"${f.name}"이(가) 메인 퍼널로 설정되었습니다.`);
            mutate();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "변경 실패");
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="inline-flex items-center gap-2 text-base">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    퍼널 관리
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* ── 마케팅 퍼널 섹션 ── */}
                <section className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Target className="h-3.5 w-3.5 text-sky-500" />
                            <span className="text-sm font-semibold">마케팅 퍼널</span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleAdd("marketing")}>
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            추가
                        </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        방문 → 리드까지 자동 단계. 그 다음 상태 단계를 정의하면 됩니다. 메인 퍼널은 개요 탭에 표시됩니다.
                    </p>
                    {isLoading ? (
                        <p className="text-sm text-muted-foreground">불러오는 중...</p>
                    ) : marketingFunnels.length === 0 ? (
                        <p className="rounded-md border border-dashed bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                            마케팅 퍼널이 없습니다. &quot;추가&quot;로 시작하세요.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {marketingFunnels.map((f) => (
                                <FunnelRow key={f.id} funnel={f} onEdit={handleEdit} onDelete={handleDelete} onSetDefault={setAsDefault} />
                            ))}
                        </ul>
                    )}
                </section>

                {/* ── 행동(이벤트) 퍼널 섹션 ── */}
                <section className="space-y-2 border-t pt-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <Activity className="h-3.5 w-3.5 text-violet-500" />
                            <span className="text-sm font-semibold">행동 퍼널</span>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleAdd("event")}>
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            추가
                        </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        CUSTOM 이벤트 단계로 폼/행동 흐름의 단계별 이탈을 봅니다. 행동 탭에 표시됩니다.
                    </p>
                    {isLoading ? (
                        <p className="text-sm text-muted-foreground">불러오는 중...</p>
                    ) : eventFunnels.length === 0 ? (
                        <p className="rounded-md border border-dashed bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                            행동 퍼널이 없습니다. &quot;추가&quot;로 만드세요.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {eventFunnels.map((f) => (
                                <FunnelRow key={f.id} funnel={f} onEdit={handleEdit} onDelete={handleDelete} onSetDefault={setAsDefault} />
                            ))}
                        </ul>
                    )}

                    {customEventCodes.length > 0 && (
                        <div className="rounded-md border bg-muted/30 p-3">
                            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                                <Code className="h-3.5 w-3.5" />
                                이벤트 단계 — 사이트에 심을 코드
                            </p>
                            <p className="mb-2 text-[11px] text-muted-foreground">
                                아래 이벤트 코드를 사이트의 해당 동작 시점에 호출해야 단계 데이터가 쌓입니다.
                                (예: 구독신청 단계에서 다음 버튼 클릭 시)
                            </p>
                            <ul className="space-y-1.5">
                                {customEventCodes.map(({ eventName, label }) => (
                                    <li key={eventName} className="flex items-center gap-2 rounded bg-card px-2 py-1.5">
                                        <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
                                        <code className="flex-1 truncate font-mono text-[11px]">
                                            sendb.track(&apos;{eventName}&apos;)
                                        </code>
                                        <CopyBtn text={`sendb.track('${eventName}')`} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            </CardContent>
            <FunnelEditorDialog
                open={open}
                onOpenChange={setOpen}
                siteId={siteId}
                funnel={editing}
                initialKind={newKind}
                onSaved={() => mutate()}
            />
        </Card>
    );
}
