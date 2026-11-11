"use client";

import { useState } from "react";
import { CalendarClock, CircleDot, Maximize2, Minimize2, Route, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FieldDefinition } from "@/types";
import type { LeadRecord } from "../types";
import { extraFields, formatDate, formatDateTime, summarizeLead } from "../utils/lead-fields";
import { LeadCommentComposer, LeadCommentList } from "./LeadComments";
import { InflowBadge } from "./InflowBadge";
import { LeadActivitySection } from "./LeadActivitySection";
import { StatusBadge } from "./StatusBadge";

interface LeadDetailPanelProps {
    record: LeadRecord;
    fields: FieldDefinition[];
    statusOptions: string[];
    statusColors?: Record<string, string> | null;
    onClose: () => void;
    onStatusChange: (status: string) => void;
    onDelete: () => void;
    onCommentAdded: () => void;
}

function PropRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex w-24 shrink-0 items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
    return (
        <div className={wide ? "col-span-2" : undefined}>
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-1.5 whitespace-pre-wrap break-words text-sm">{value || "-"}</div>
        </div>
    );
}

/** 표에서 리드를 누르면 오른쪽에서 열리는 상세 (genius-hub-erp 사이드 피크 구조) */
export function LeadDetailPanel({
    record,
    fields,
    statusOptions,
    statusColors,
    onClose,
    onStatusChange,
    onDelete,
    onCommentAdded,
}: LeadDetailPanelProps) {
    const [full, setFull] = useState(false);
    const lead = summarizeLead(record, fields);
    const extras = extraFields(record, fields);

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
            <div
                className={
                    "fixed z-50 flex flex-col bg-background shadow-2xl " +
                    (full ? "inset-0" : "inset-y-0 right-0 w-[46%] min-w-[520px] max-w-[760px] border-l")
                }
            >
                <div className="flex h-14 shrink-0 items-center justify-between border-b px-2">
                    <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="닫기">
                        <X className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="삭제">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setFull((v) => !v)} aria-label="크게 보기">
                            {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="mx-auto max-w-3xl space-y-6 p-6">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h2 className="truncate text-xl font-semibold">{lead.company || "(기업명 없음)"}</h2>
                                <p className="mt-0.5 text-sm text-muted-foreground">{lead.contactName || "-"}</p>
                            </div>
                            <div className="shrink-0 text-right">
                                <div className="text-xs text-muted-foreground">등록일시</div>
                                <div className="text-sm">{formatDateTime(record.registeredAt)}</div>
                            </div>
                        </div>

                        {statusOptions.length > 0 && (
                            <PropRow icon={CircleDot} label="대응상태">
                                <div className="flex flex-wrap gap-1.5">
                                    {(lead.status && !statusOptions.includes(lead.status)
                                        ? [...statusOptions, lead.status]
                                        : statusOptions
                                    ).map((s) => (
                                        <StatusBadge
                                            key={s}
                                            status={s}
                                            colors={statusColors}
                                            active={lead.status === s}
                                            onClick={() => lead.status !== s && onStatusChange(s)}
                                        />
                                    ))}
                                </div>
                            </PropRow>
                        )}

                        <PropRow icon={CalendarClock} label="다음 연락일">
                            <div className="pt-0.5 text-sm">
                                {typeof record.data?.nextContactAt === "string" && record.data.nextContactAt
                                    ? formatDate(record.data.nextContactAt)
                                    : <span className="text-muted-foreground">없음 · 댓글에서 정할 수 있어요</span>}
                            </div>
                        </PropRow>

                        <PropRow icon={Route} label="유입경로">
                            <div className="pt-0.5">
                                <InflowBadge inflow={record.inflow} />
                            </div>
                        </PropRow>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
                            <Field label="연락처" value={lead.phone} />
                            <Field label="이메일" value={lead.email} />
                            <Field label="요청사항" value={lead.request} wide />
                        </div>

                        {extras.length > 0 && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
                                {extras.map((f) => (
                                    <Field key={f.key} label={f.label} value={f.value} wide={f.value.length > 40} />
                                ))}
                            </div>
                        )}

                        <LeadActivitySection recordId={record.id} />

                        <LeadCommentList recordId={record.id} />
                    </div>
                </ScrollArea>

                <div className="border-t p-3">
                    <div className="mx-auto max-w-3xl">
                        <LeadCommentComposer recordId={record.id} onAdded={onCommentAdded} />
                    </div>
                </div>
            </div>
        </>
    );
}
