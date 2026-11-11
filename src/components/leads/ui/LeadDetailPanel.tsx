"use client";

import { useState } from "react";
import { CalendarClock, CircleDot, Maximize2, Minimize2, Route, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FieldDefinition } from "@/types";
import type { LeadRecord } from "../types";
import { AUTO_FILLED_KEYS, extraFields, formatDate, formatDateTime, summarizeLead } from "../utils/lead-fields";
import { LeadCommentComposer, LeadCommentList } from "./LeadComments";
import { InflowBadge } from "./InflowBadge";
import { LeadActivitySection } from "./LeadActivitySection";
import { StatusBadge } from "./StatusBadge";
import { EditableField, Field, PropRow } from "./DetailParts";
import { SalesLeadBody } from "@/components/sales/ui/SalesLeadBody";

interface LeadDetailPanelProps {
    record: LeadRecord;
    fields: FieldDefinition[];
    statusOptions: string[];
    statusColors?: Record<string, string> | null;
    onClose: () => void;
    onStatusChange: (status: string) => void;
    /** 칸 하나 바로 저장 (우리 담당자 등) */
    onFieldChange?: (key: string, value: unknown) => void;
    mode?: "lead" | "sales";
    onDelete: () => void;
    onCommentAdded: () => void;
    /** 영업관리: 연관 리드를 누르면 오른쪽에 나란히 여는 두 번째 리드 */
    secondary?: LeadRecord | null;
    onOpenRelated?: (record: LeadRecord) => void;
    onCloseRelated?: () => void;
    onSecondaryFieldChange?: (key: string, value: unknown) => void;
    /** 서버가 돌려준 리드로 열린 리드를 바꾼다 (사업부 변경 등) */
    onRecordUpdate?: (r: Partial<LeadRecord> & { id: number }) => void;
}

/** 표에서 리드를 누르면 오른쪽에서 열리는 상세 (genius-hub-erp 사이드 피크 구조) */
export function LeadDetailPanel({
    record,
    fields,
    statusOptions,
    statusColors,
    onClose,
    onStatusChange,
    onFieldChange,
    mode = "lead",
    onDelete,
    onCommentAdded,
    secondary,
    onOpenRelated,
    onCloseRelated,
    onSecondaryFieldChange,
    onRecordUpdate,
}: LeadDetailPanelProps) {
    const split = mode === "sales" && !!secondary;
    const [full, setFull] = useState(false);
    const sales = mode === "sales";
    const lead = summarizeLead(record, fields);
    // 연락처는 사업부마다 칸 이름이 달라(phone/contact) 이미 쓰는 칸에 저장
    const recData = (record.data ?? {}) as Record<string, unknown>;
    const phoneKey = recData.phone === undefined && recData.contact !== undefined ? "contact" : "phone";
    const extras = extraFields(record, fields);
    // 웹폼 유입 추적·메타 광고가 남긴 캠페인·광고 소재
    const attribution = [...AUTO_FILLED_KEYS]
        .map((key) => ({
            label: fields.find((f) => f.key === key)?.label ?? (key === "campaignName" ? "캠페인" : "광고 소재"),
            value: String((record.data as Record<string, unknown>)?.[key] ?? "").trim(),
        }))
        .filter((a) => a.value);

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
            <div
                className={
                    "fixed z-50 flex bg-background shadow-2xl " +
                    (full
                        ? "inset-0"
                        : split
                          ? // 같은 기업 담당자를 열면 화면 전체 — 왼쪽 절반 지금 리드, 오른쪽 절반 같은 기업 담당자
                            "inset-0"
                          : "inset-y-0 right-0 w-[46%] min-w-[520px] max-w-[760px] border-l")
                }
            >
                {/* 왼쪽(또는 혼자): 지금 고른 리드 */}
                <div className={"flex min-w-0 flex-1 flex-col" + (split ? " border-r" : "")}>
                    <div className="flex h-14 shrink-0 items-center justify-between border-b px-2">
                        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="닫기">
                            <X className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground hover:text-destructive"
                                onClick={onDelete}
                                aria-label="삭제"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => setFull((v) => !v)}
                                aria-label="크게 보기"
                            >
                                {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>

                    <ScrollArea className="min-h-0 flex-1">
                        <div className="mx-auto max-w-3xl space-y-6 p-6">
                            {sales ? (
                                <SalesLeadBody
                                    record={record}
                                    fields={fields}
                                    onFieldChange={(k, v) => onFieldChange?.(k, v)}
                                    onChanged={onCommentAdded}
                                    onOpenRelated={onOpenRelated}
                                    activeRelatedId={secondary?.id ?? null}
                                    onWorkspacesChanged={(r) => onRecordUpdate?.(r as Partial<LeadRecord> & { id: number })}
                                />
                            ) : (
                                <>
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

                                    {/* 대응상태·다음 연락일·유입경로는 한 묶음으로 촘촘하게 */}
                                    <div className="space-y-2.5">
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
                                            {typeof record.data?.nextContactAt === "string" && record.data.nextContactAt ? (
                                                formatDate(record.data.nextContactAt)
                                            ) : (
                                                <span className="text-muted-foreground">없음 · 댓글에서 정할 수 있어요</span>
                                            )}
                                        </div>
                                    </PropRow>

                                    <PropRow icon={Route} label="유입경로">
                                        <div className="space-y-1 pt-0.5">
                                            <InflowBadge inflow={record.inflow} />
                                            {attribution.length > 0 && (
                                                <div className="text-xs text-muted-foreground">
                                                    {attribution.map((a) => `${a.label} ${a.value}`).join(" · ")}
                                                </div>
                                            )}
                                        </div>
                                    </PropRow>
                                    </div>

                                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
                                        <EditableField
                                            label="연락처"
                                            value={lead.phone}
                                            onSave={(v) => onFieldChange?.(phoneKey, v)}
                                        />
                                        <EditableField label="이메일" value={lead.email} onSave={(v) => onFieldChange?.("email", v)} />
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
                                </>
                            )}
                        </div>
                    </ScrollArea>

                    {!sales && (
                        <div className="border-t p-3">
                            <div className="mx-auto max-w-3xl">
                                <LeadCommentComposer recordId={record.id} onAdded={onCommentAdded} />
                            </div>
                        </div>
                    )}
                </div>

                {/* 오른쪽: 연관 리드 (genius-hub-erp 과거 리드 상세처럼 나란히) */}
                {split && secondary && (
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex h-14 shrink-0 items-center justify-between border-b px-2">
                            <span className="px-2 text-xs font-semibold text-muted-foreground">같은 기업 담당자</span>
                            <Button variant="ghost" size="icon" className="size-8" onClick={onCloseRelated} aria-label="같은 기업 담당자 닫기">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        <ScrollArea className="min-h-0 flex-1">
                            <div className="mx-auto max-w-3xl p-6">
                                <SalesLeadBody
                                    key={secondary.id}
                                    record={secondary}
                                    fields={fields}
                                    onFieldChange={(k, v) => onSecondaryFieldChange?.(k, v)}
                                    onChanged={onCommentAdded}
                                    onOpenRelated={onOpenRelated}
                                    activeRelatedId={secondary.id}
                                    onWorkspacesChanged={(r) => onRecordUpdate?.(r as Partial<LeadRecord> & { id: number })}
                                />
                            </div>
                        </ScrollArea>
                    </div>
                )}
            </div>
        </>
    );
}
