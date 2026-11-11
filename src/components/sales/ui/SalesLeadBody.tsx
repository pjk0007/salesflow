"use client";

import { Building2, ChevronRight, Link2Off, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FieldDefinition } from "@/types";
import type { LeadRecord } from "@/components/leads/types";
import { Field, PropRow } from "@/components/leads/ui/DetailParts";
import { formatDateTime, summarizeLead } from "@/components/leads/utils/lead-fields";
import { unlinkLead } from "../api";
import { useRelatedLeads } from "../hooks/useRelatedLeads";
import { OwnerSelect } from "./OwnerSelect";
import { ProfileMemo } from "./ProfileMemo";
import { SalesMeetings } from "./SalesMeetings";
import { WorkspaceChips } from "./WorkspaceChips";

const d = (r: LeadRecord) => (r.data ?? {}) as Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").trim();

interface SalesLeadBodyProps {
    record: LeadRecord;
    fields: FieldDefinition[];
    onFieldChange: (key: string, value: unknown) => void;
    onChanged: () => void;
    /** 연관 리드를 누르면 오른쪽에 그 리드 패널을 연다 */
    onOpenRelated?: (record: LeadRecord) => void;
    activeRelatedId?: number | null;
}

/** 영업관리 상세 — 기업·이름/직책, 담당자, 연락처, 메모, 연관 리드, 미팅 히스토리 */
export function SalesLeadBody({ record, fields, onFieldChange, onChanged, onOpenRelated, activeRelatedId }: SalesLeadBodyProps) {
    const lead = summarizeLead(record, fields);
    const data = d(record);
    const ownerId = typeof data.owner === "string" ? data.owner : null;
    const { related, mutate } = useRelatedLeads(record.id);
    const linked = typeof data.leadGroupId === "string" && data.leadGroupId;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="truncate text-xl font-semibold">{lead.company || "(기업명 없음)"}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{[lead.contactName, text(data.contactTitle)].filter(Boolean).join(" / ") || "-"}</p>
                </div>
                <div className="shrink-0 text-right">
                    <div className="text-xs text-muted-foreground">등록일시</div>
                    <div className="text-sm">{formatDateTime(record.registeredAt)}</div>
                </div>
            </div>

            <PropRow icon={UserRound} label="담당자">
                <OwnerSelect value={ownerId} onChange={(id) => onFieldChange("owner", id)} className="-ml-2 text-sm" block />
            </PropRow>

            <PropRow icon={Building2} label="사업부">
                <div className="pt-0.5">
                    <WorkspaceChips
                        value={Array.isArray(data.workspaceIds) ? (data.workspaceIds as number[]) : [record.workspaceId]}
                        locked={record.workspaceId}
                        onChange={(ids) => onFieldChange("workspaceIds", [record.workspaceId, ...ids.filter((id) => id !== record.workspaceId)])}
                    />
                </div>
            </PropRow>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
                <Field label="연락처" value={lead.phone} />
                <Field label="이메일" value={lead.email} />
                <Field label="회사 주소" value={text(data.address)} wide />
            </div>

            <div className="border-t pt-4">
                <ProfileMemo key={record.id} value={text(data.profileNote)} onSave={(v) => onFieldChange("profileNote", v)} />
            </div>

            <section className="space-y-2 border-t pt-4">
                <div className="flex h-6 items-center justify-between">
                    <h3 className="text-xs font-semibold text-muted-foreground">
                        같은 기업 담당자 <span className="font-normal">{related.length}</span>
                    </h3>
                    {linked && (
                        <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={async () => {
                                const r = await unlinkLead(record.id);
                                if (!r.success) toast.error(r.error || "빼지 못했습니다.");
                                else toast.success("묶음에서 뺐어요. 기업명도 원래대로 돌렸어요.");
                                mutate();
                                onChanged();
                            }}
                        >
                            <Link2Off className="h-3.5 w-3.5" /> 이 묶음에서 빼기
                        </button>
                    )}
                </div>
                {related.length === 0 ? (
                    <p className="text-sm text-muted-foreground">같은 기업 담당자가 없어요. 표에서 여러 명을 골라 &apos;같은 기업으로 묶기&apos;를 할 수 있어요.</p>
                ) : (
                    <ul className="divide-y divide-border/40 rounded-lg border border-border/40">
                        {related.map((r) => {
                            const rd = d(r);
                            return (
                                <li key={r.id}>
                                    <button
                                        type="button"
                                        onClick={() => onOpenRelated?.(r)}
                                        className={cn(
                                            "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50",
                                            activeRelatedId === r.id && "bg-accent",
                                        )}
                                    >
                                        <span className="min-w-0 flex-1 truncate">
                                            <span className="font-medium">{text(rd.name ?? rd.contactName) || "(이름 없음)"}</span>
                                            {text(rd.contactTitle) && <span className="text-muted-foreground"> / {text(rd.contactTitle)}</span>}
                                            <span className="ml-2 text-xs text-muted-foreground">{text(rd.companyName ?? rd.companyname)}</span>
                                        </span>
                                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <div className="border-t pt-4">
                <SalesMeetings recordId={record.id} onChanged={onChanged} />
            </div>
        </div>
    );
}
