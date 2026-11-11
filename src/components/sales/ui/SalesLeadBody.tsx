"use client";

import { useState } from "react";
import { BadgeCheck, Building2, ChevronRight, Link2Off, Mail, Phone, UserCog, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FieldDefinition } from "@/types";
import type { LeadRecord } from "@/components/leads/types";
import { PropRow } from "@/components/leads/ui/DetailParts";
import { formatDateTime, summarizeLead } from "@/components/leads/utils/lead-fields";
import { useRelatedLeads } from "../hooks/useRelatedLeads";
import { OwnerSelect } from "./OwnerSelect";
import { ProfileMemo } from "./ProfileMemo";
import { SalesMeetings } from "./SalesMeetings";
import { WorkspaceChips } from "./WorkspaceChips";
import { InlineEdit } from "./InlineEdit";
import { CompanyAddress } from "./CompanyAddress";
import { setLeadWorkspaces } from "../api";
import { toast } from "sonner";
import { UnlinkCompanyDialog } from "./UnlinkCompanyDialog";

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
    /** 사업부를 바꾼 뒤 서버가 돌려준 리드 (등록 사업부가 바뀌면 workspaceId도 바뀐다) */
    onWorkspacesChanged?: (r: { id: number; workspaceId: number; partitionId: number; data: Record<string, unknown> }) => void;
    /** 미팅 상세 보기 — 오른쪽 절반에 연다 */
    onOpenMeeting?: (recordId: number, meetingId: number) => void;
}

/** 영업관리 상세 — 기업·이름/직책, 담당자, 연락처, 메모, 연관 리드, 미팅 히스토리 */
export function SalesLeadBody({ record, fields, onFieldChange, onChanged, onOpenRelated, activeRelatedId, onWorkspacesChanged, onOpenMeeting }: SalesLeadBodyProps) {
    const lead = summarizeLead(record, fields);
    const data = d(record);
    const ownerId = typeof data.owner === "string" ? data.owner : null;
    const { related, mutate } = useRelatedLeads(record.id);
    const linked = typeof data.leadGroupId === "string" && data.leadGroupId;
    const [unlinkOpen, setUnlinkOpen] = useState(false);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="truncate text-sm text-muted-foreground">{lead.company || "(기업명 없음)"}</p>
                    <h2 className="mt-0.5 truncate text-2xl font-semibold">
                        {[lead.contactName, text(data.contactTitle)].filter(Boolean).join(" · ") || "(이름 없음)"}
                    </h2>
                </div>
                <div className="shrink-0 text-right">
                    <div className="text-xs text-muted-foreground">등록일시</div>
                    <div className="text-sm">{formatDateTime(record.registeredAt)}</div>
                </div>
            </div>

            {/* 사람 정보 — 한 묶음으로 촘촘하게, 모두 눌러서 바로 고친다 */}
            <div className="space-y-0.5">
                <PropRow icon={UserRound} label="이름" center>
                    <InlineEdit value={text(data.name ?? data.contactName)} onSave={(v) => onFieldChange(data.contactName !== undefined ? "contactName" : "name", v)} className="-ml-2" />
                </PropRow>
                <PropRow icon={BadgeCheck} label="직책" center>
                    <InlineEdit value={text(data.contactTitle)} onSave={(v) => onFieldChange("contactTitle", v)} className="-ml-2" />
                </PropRow>
                <PropRow icon={Phone} label="연락처" center>
                    <InlineEdit value={lead.phone} onSave={(v) => onFieldChange(data.phone !== undefined || !data.contact ? "phone" : "contact", v)} className="-ml-2" />
                </PropRow>
                <PropRow icon={Mail} label="이메일" center>
                    <InlineEdit value={lead.email} onSave={(v) => onFieldChange("email", v)} className="-ml-2" />
                </PropRow>
                <PropRow icon={UserCog} label="담당자" center>
                    <OwnerSelect value={ownerId} onChange={(id) => onFieldChange("owner", id)} className="-ml-2" block />
                </PropRow>
                <PropRow icon={Building2} label="사업부" center>
                    <WorkspaceChips
                        inline
                        className="-ml-2"
                        value={Array.isArray(data.workspaceIds) ? (data.workspaceIds as number[]) : [record.workspaceId]}
                        onChange={async (ids) => {
                            const r = await setLeadWorkspaces(record.id, ids);
                            if (!r.success) {
                                toast.error(r.error || "사업부를 바꾸지 못했습니다.");
                                return;
                            }
                            onWorkspacesChanged?.(r.data!);
                            onChanged();
                        }}
                    />
                </PropRow>
            </div>

            {/* 회사 정보 — 주소는 같은 기업 담당자 공통 */}
            <section className="space-y-1 border-t pt-4">
                <h3 className="text-xs font-semibold text-muted-foreground">회사 정보</h3>
                <CompanyAddress
                    key={`${record.id}:${text(data.address)}`}
                    recordId={record.id}
                    value={text(data.address)}
                    onSaved={() => {
                        onChanged();
                        mutate();
                    }}
                />
            </section>

            <div className="border-t pt-4">
                <ProfileMemo key={record.id} value={text(data.profileNote)} onSave={(v) => onFieldChange("profileNote", v)} />
            </div>

            <section className="space-y-2 border-t pt-4">
                <div className="flex h-6 items-center justify-between">
                    <h3 className="text-xs font-semibold text-muted-foreground">
                        같은 기업 담당자 <span className="font-normal">{related.length}</span>
                    </h3>
                    {(related.length > 0 || linked) && (
                        <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setUnlinkOpen(true)}
                        >
                            <Link2Off className="h-3.5 w-3.5" /> 묶인 기업에서 빼기
                        </button>
                    )}
                </div>
                {related.length > 0 && (
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
                                            {text(rd.contactTitle) && <span className="text-muted-foreground"> · {text(rd.contactTitle)}</span>}
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
                <SalesMeetings recordId={record.id} onChanged={onChanged} leadData={data} onOpenDetail={(id) => onOpenMeeting?.(record.id, id)} />
            </div>

            {unlinkOpen && (
                <UnlinkCompanyDialog
                    recordIds={[record.id]}
                    currentName={text(data.companyName ?? data.companyname)}
                    originalName={typeof data.originalCompanyName === "string" ? data.originalCompanyName : null}
                    onOpenChange={setUnlinkOpen}
                    onDone={() => {
                        mutate();
                        onChanged();
                    }}
                />
            )}
        </div>
    );
}
