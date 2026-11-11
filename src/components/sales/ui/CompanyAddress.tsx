"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PropRow } from "@/components/leads/ui/DetailParts";
import { saveCompanyAddress } from "../api";
import { INLINE_TRIGGER } from "./inline-styles";

/**
 * 회사 주소 — 평소엔 이름·직책 칸처럼 테두리 없이 보이고, 누르면 입력창 + 저장 버튼(Enter도 저장, Esc 취소).
 * 저장하면 같은 기업 담당자 모두의 주소가 바뀐다.
 */
export function CompanyAddress({ recordId, value, onSaved }: { recordId: number; value: string; onSaved: () => void }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const [saving, setSaving] = useState(false);
    const dirty = draft.trim() !== value.trim();

    const cancel = () => {
        setDraft(value);
        setEditing(false);
    };
    const save = async () => {
        if (saving) return;
        if (!dirty) return cancel();
        setSaving(true);
        try {
            const r = await saveCompanyAddress(recordId, draft.trim());
            if (!r.success) {
                toast.error(r.error || "저장하지 못했습니다.");
                return;
            }
            toast.success((r.data?.count ?? 1) > 1 ? `같은 기업 담당자 ${r.data!.count}명의 주소를 바꿨어요.` : "주소를 저장했어요.");
            setEditing(false);
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-1">
            <PropRow icon={MapPin} label="주소" center>
                {editing ? (
                    <div className="-ml-2 flex items-center gap-1.5">
                        <Input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    save();
                                }
                                if (e.key === "Escape") cancel();
                            }}
                            placeholder="회사 주소"
                            className="h-8"
                        />
                        <Button size="sm" className="h-8 shrink-0" disabled={saving} onClick={save}>
                            저장
                        </Button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => {
                            setDraft(value);
                            setEditing(true);
                        }}
                        className={cn(INLINE_TRIGGER, "-ml-2", !value && "text-muted-foreground")}
                    >
                        {value || "비어있음"}
                    </button>
                )}
            </PropRow>
            {editing && <p className="pl-[6.75rem] text-xs text-muted-foreground">저장하면 같은 기업 담당자 모두의 주소가 같이 바뀌어요.</p>}
        </div>
    );
}
