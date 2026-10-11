"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApiResult, ReleaseTarget } from "../types";
import { releaseNotice } from "../utils/labels";

/**
 * 풀기 확인 (DESIGN-SND 6-5·10절). 메모 칸, 대기 N통이 다시 나간다는 안내, 주소면 "풀린 뒤 오늘 한도 N통 (웜업 M일째)".
 * 관리자에게만 이 대화상자를 여는 버튼이 보인다 (서버도 관리자만 받는다).
 */
export default function ReleaseDialog({
    target,
    onClose,
    onConfirm,
}: {
    target: ReleaseTarget | null;
    onClose: () => void;
    onConfirm: (target: ReleaseTarget, note: string) => Promise<ApiResult<unknown>>;
}) {
    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">{target && <Body key={dialogKey(target)} target={target} onClose={onClose} onConfirm={onConfirm} />}</DialogContent>
        </Dialog>
    );
}

function dialogKey(t: ReleaseTarget): string {
    return t.kind === "hold" ? `hold-${t.holdId}` : `sender-${t.profileId}`;
}

function Body({
    target,
    onClose,
    onConfirm,
}: {
    target: ReleaseTarget;
    onClose: () => void;
    onConfirm: (target: ReleaseTarget, note: string) => Promise<ApiResult<unknown>>;
}) {
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);
    const title = target.kind === "hold" ? `명단 보류 풀기 — ${target.name}` : `자동 멈춤 풀기 — ${target.email}`;
    const notice = target.kind === "hold" ? releaseNotice({ kind: "hold", queued: target.queued }) : releaseNotice({ kind: "sender", preview: target.preview });

    const submit = async () => {
        setSaving(true);
        const r = await onConfirm(target, note);
        setSaving(false);
        if (r.success) {
            toast.success(target.kind === "hold" ? "명단 보류를 풀었습니다." : "자동 멈춤을 풀었습니다.");
            onClose();
        } else {
            toast.error(r.error || "풀지 못했습니다.");
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{notice}</DialogDescription>
            </DialogHeader>
            {target.kind === "sender" && target.reason && <p className="text-xs text-muted-foreground">멈춘 까닭: {target.reason}</p>}
            <div className="space-y-1.5">
                <Label htmlFor="send-health-release-note">메모 (선택)</Label>
                <Textarea
                    id="send-health-release-note"
                    value={note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="예: 반송 주소 정리함"
                    rows={3}
                />
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={onClose} disabled={saving}>
                    취소
                </Button>
                <Button onClick={submit} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    풀기
                </Button>
            </DialogFooter>
        </>
    );
}
