"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { deleteLeads, fetchLead, updateLead } from "@/components/leads/api";
import type { LeadRecord } from "@/components/leads/types";
import { LeadDetailPanel } from "@/components/leads/ui/LeadDetailPanel";
import DeleteConfirmDialog from "@/components/records/DeleteConfirmDialog";

/** 리드 번호만으로 영업리드 상세 패널을 연다 (영업ToDo 등에서) */
export function SalesLeadPanel({ recordId, onClose, onChanged }: { recordId: number; onClose: () => void; onChanged: () => void }) {
    const [record, setRecord] = useState<LeadRecord | null>(null);
    const [secondary, setSecondary] = useState<LeadRecord | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchLead(recordId).then((r) => {
            if (!alive) return;
            if (r.success && r.data) setRecord(r.data);
            else {
                toast.error(r.error || "리드를 불러오지 못했습니다.");
                onClose();
            }
        });
        return () => {
            alive = false;
        };
    }, [recordId, onClose]);

    const change = (target: LeadRecord | null, set: (r: LeadRecord) => void) => async (key: string, value: unknown) => {
        if (!target) return;
        set({ ...target, data: { ...(target.data as Record<string, unknown>), [key]: value } });
        const r = await updateLead(target.id, { [key]: value });
        if (!r.success) {
            set(target);
            toast.error(r.error || "저장하지 못했습니다.");
            return;
        }
        onChanged();
    };

    if (!record) return null;
    return (
        <>
            <LeadDetailPanel
                key={record.id}
                record={record}
                fields={[]}
                statusOptions={[]}
                mode="sales"
                onClose={onClose}
                onStatusChange={() => undefined}
                onFieldChange={change(record, setRecord)}
                onDelete={() => setDeleteOpen(true)}
                onCommentAdded={onChanged}
                secondary={secondary}
                onOpenRelated={setSecondary}
                onCloseRelated={() => setSecondary(null)}
                onSecondaryFieldChange={change(secondary, (r) => setSecondary(r))}
                onRecordUpdate={(r) => {
                    setRecord((prev) => (prev && prev.id === r.id ? { ...prev, ...r } : prev));
                    setSecondary((prev) => (prev && prev.id === r.id ? { ...prev, ...r } : prev));
                }}
            />
            <DeleteConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                count={1}
                onConfirm={async () => {
                    const r = await deleteLeads([record.id]);
                    if (!r.success) {
                        toast.error(r.error || "삭제하지 못했습니다.");
                        return;
                    }
                    setDeleteOpen(false);
                    onClose();
                    onChanged();
                }}
            />
        </>
    );
}
