"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DEFAULT_LIMIT_SETTINGS, toLimitSettings, type SenderLimitSettings } from "@/lib/email-sender-limit-rules";
import type {
    ApiResult,
    SenderLimitForm,
    SenderLimitPatch,
    SenderProfile,
    SenderProfileCreate,
    SenderProfileUpdate,
    SenderUsageView,
} from "../types";
import { verifySenderEmail } from "../api/senderProfiles";
import { changedLimitFields, inspectLimitForm, limitFormFromSettings, todayKstYmd } from "../utils/limitForm";
import SenderLimitSection from "./SenderLimitSection";

/** 대화상자를 여는 대상. 새 프로필이면 profile 없음 */
export type SenderProfileDialogTarget = { mode: "new" } | { mode: "edit"; profile: SenderProfile };

interface SenderProfileDialogProps {
    target: SenderProfileDialogTarget | null;
    onClose: () => void;
    /** 고치는 프로필의 오늘 사용량 (미리보기의 "오늘") */
    usage?: SenderUsageView;
    /** 서버가 한도 칸 변경에 관리자 권한을 요구한다. 멤버에게는 보기만 하게 해 저장이 403으로 막히지 않게 한다 */
    canEditLimits: boolean;
    createProfile: (data: SenderProfileCreate) => Promise<ApiResult<SenderProfile>>;
    updateProfile: (id: number, data: SenderProfileUpdate) => Promise<ApiResult<SenderProfile>>;
}

type IdentityField = "name" | "fromName" | "fromEmail";
const IDENTITY_FIELDS: ReadonlyArray<{ key: IdentityField; label: string; placeholder: string }> = [
    { key: "name", label: "프로필 이름", placeholder: "예: 마케팅팀" },
    { key: "fromName", label: "발신 이름", placeholder: "예: Sendb 마케팅" },
    { key: "fromEmail", label: "발신 이메일", placeholder: "예: marketing@company.com" },
];

/**
 * 발신자 프로필 추가·수정 대화상자.
 * 저장·취소는 아래에 늘 붙어 있고(스크롤해도 따라온다), 1440×900 화면에서는 스크롤 없이 전부 보인다.
 * 한도 입력이 잘못되면 그 칸 바로 아래와 저장 버튼 옆에 이유를 보이고, 저장을 눌러도 보내지 않고 그 칸으로 옮긴다.
 */
export default function SenderProfileDialog(props: SenderProfileDialogProps) {
    const { target, onClose } = props;
    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-5xl max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 flex flex-col">
                {/* 열 때마다 입력을 새로 채운다 — 대상이 바뀌면 다시 그린다 */}
                {target && <DialogBody key={target.mode === "edit" ? `edit-${target.profile.id}` : "new"} {...props} target={target} />}
            </DialogContent>
        </Dialog>
    );
}

function DialogBody({
    target,
    onClose,
    usage,
    canEditLimits,
    createProfile,
    updateProfile,
}: SenderProfileDialogProps & { target: SenderProfileDialogTarget }) {
    const editing = target.mode === "edit" ? target.profile : null;
    const bodyRef = useRef<HTMLDivElement>(null);
    const uid = useId();
    const [form, setForm] = useState(() => ({
        name: editing?.name ?? "",
        fromName: editing?.fromName ?? "",
        fromEmail: editing?.fromEmail ?? "",
    }));
    // 한도는 "열 때 저장돼 있던 값"과 입력을 따로 든다 — 저장할 때 달라진 칸만 보내려고
    const [storedLimits] = useState<SenderLimitSettings>(() => (editing ? toLimitSettings(editing) : DEFAULT_LIMIT_SETTINGS));
    const [limits, setLimits] = useState<SenderLimitForm>(() => limitFormFromSettings(storedLimits));
    const [saving, setSaving] = useState(false);
    const [verifying, setVerifying] = useState(false);
    // 기존 프로필은 이미 검증됨
    const [verified, setVerified] = useState(!!editing);
    // 저장을 한 번 눌렀으면 빈 칸을 칸 아래에 표시한다 (처음부터 빨갛게 보이지 않게)
    const [attempted, setAttempted] = useState(false);

    const today = todayKstYmd();
    const check = useMemo(() => inspectLimitForm(limits, storedLimits, today), [limits, storedLimits, today]);
    const missing = IDENTITY_FIELDS.filter((f) => !form[f.key].trim()).map((f) => f.key);
    // 관리자가 아니면 한도 칸을 보내지 않으므로 막지 않는다
    const limitBlocked = canEditLimits && !check.ok;
    const needsVerify = !editing && !verified;

    const footerNote: { tone: "error" | "muted"; text: string } | null = limitBlocked && !check.ok
        ? { tone: "error", text: `저장 전에 고쳐 주세요: ${check.error}` }
        : attempted && missing.length > 0
            ? { tone: "error", text: "프로필 이름·발신 이름·발신 이메일을 모두 입력해 주세요." }
            : needsVerify
                ? { tone: "muted", text: "발신 이메일 옆 [테스트]로 NHN에 등록된 주소인지 먼저 확인해 주세요." }
                : null;

    const focusFirst = (selector: string) => {
        const el = bodyRef.current?.querySelector<HTMLElement>(selector);
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus();
    };

    const handleVerify = async () => {
        if (!form.fromEmail || !form.fromEmail.includes("@")) {
            toast.error("유효한 발신 이메일을 입력해주세요.");
            return;
        }
        setVerifying(true);
        const result = await verifySenderEmail({ fromEmail: form.fromEmail, fromName: form.fromName });
        setVerifying(false);
        if (result.success) {
            setVerified(true);
            toast.success("발신 이메일이 확인되었습니다. 확인 메일이 발송되었습니다.");
        } else {
            toast.error(result.error || "발신 이메일 확인에 실패했습니다.");
        }
    };

    const handleSave = async () => {
        setAttempted(true);
        if (missing.length > 0) {
            focusFirst(`[data-identity-field="${missing[0]}"]`);
            return;
        }
        // 서버와 같은 검증을 이미 돌려 칸 아래에 보이고 있다. 보내지 않고 고칠 칸으로 옮긴다
        let limitPatch: SenderLimitPatch = {};
        if (canEditLimits) {
            if (!check.ok) {
                focusFirst(`[data-limit-field="${check.field}"]`);
                return;
            }
            limitPatch = changedLimitFields(storedLimits, check.value);
        }
        setSaving(true);
        const result = editing
            ? await updateProfile(editing.id, { ...form, ...limitPatch })
            : await createProfile({ ...form, ...limitPatch });
        setSaving(false);
        if (result.success) {
            toast.success(editing ? "프로필이 수정되었습니다." : "프로필이 추가되었습니다.");
            onClose();
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    return (
        <>
            <DialogHeader className="px-6 pt-6 pb-3">
                <DialogTitle>{editing ? "발신자 프로필 수정" : "발신자 프로필 추가"}</DialogTitle>
                <DialogDescription className="sr-only">발신 이름·주소와 이 주소의 하루 발송 한도·웜업·발송 시간대를 정합니다.</DialogDescription>
            </DialogHeader>

            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
                <div className="grid gap-3 md:grid-cols-3">
                    {IDENTITY_FIELDS.map((f) => {
                        const empty = attempted && missing.includes(f.key);
                        const input = (
                            <Input
                                id={`${uid}-${f.key}`}
                                data-identity-field={f.key}
                                type={f.key === "fromEmail" ? "email" : "text"}
                                value={form[f.key]}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setForm((p) => ({ ...p, [f.key]: v }));
                                    if (f.key === "fromEmail" && !editing) setVerified(false);
                                }}
                                placeholder={f.placeholder}
                                aria-invalid={empty || undefined}
                                className={cn(f.key === "fromEmail" && "flex-1")}
                            />
                        );
                        return (
                            <div key={f.key} className="space-y-1.5 min-w-0">
                                <Label htmlFor={`${uid}-${f.key}`}>{f.label}</Label>
                                {f.key === "fromEmail" && !editing ? (
                                    <div className="flex gap-2">
                                        {input}
                                        <Button
                                            type="button"
                                            variant={verified ? "outline" : "secondary"}
                                            size="sm"
                                            className="h-9 shrink-0"
                                            onClick={handleVerify}
                                            disabled={verifying || verified || !form.fromEmail.includes("@")}
                                        >
                                            {verifying ? (
                                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                            ) : verified ? (
                                                <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
                                            ) : (
                                                <Send className="h-4 w-4 mr-1" />
                                            )}
                                            {verified ? "확인됨" : "테스트"}
                                        </Button>
                                    </div>
                                ) : (
                                    input
                                )}
                                {empty && <p className="text-xs text-destructive">입력해 주세요.</p>}
                                {f.key === "fromEmail" && !editing && !verified && (
                                    <p className="text-xs text-muted-foreground">NHN에 등록된 발신 주소인지 테스트 발송으로 확인합니다.</p>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="mt-4">
                    <SenderLimitSection
                        value={limits}
                        onChange={setLimits}
                        stored={storedLimits}
                        check={check}
                        sentToday={editing ? usage?.sentToday ?? null : 0}
                        readOnly={!canEditLimits}
                    />
                </div>
            </div>

            <DialogFooter className="border-t px-6 py-3 sm:items-center sm:justify-between">
                <p
                    className={cn("text-xs sm:mr-auto", footerNote?.tone === "error" ? "text-destructive" : "text-muted-foreground")}
                    aria-live="polite"
                >
                    {footerNote?.text}
                </p>
                <div className="flex shrink-0 justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>취소</Button>
                    <Button onClick={handleSave} disabled={saving || needsVerify}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {editing ? "수정" : "추가"}
                    </Button>
                </div>
            </DialogFooter>
        </>
    );
}
