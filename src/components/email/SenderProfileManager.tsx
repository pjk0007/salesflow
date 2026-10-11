"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Star } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/contexts/SessionContext";
import { hasMinRole } from "@/lib/auth-admin-rules";
import { toLimitSettings } from "@/lib/email-sender-limit-rules";
import type {
    ApiResult,
    SenderProfile,
    SenderProfileCreate,
    SenderProfileUpdate,
} from "./sender-profiles/types";
import { useSenderUsage } from "./sender-profiles/hooks/useSenderUsage";
import SenderLimitBadges from "./sender-profiles/ui/SenderLimitBadges";
import SenderProfileDialog, { type SenderProfileDialogTarget } from "./sender-profiles/ui/SenderProfileDialog";
import SenderProfileDeleteDialog from "./sender-profiles/ui/SenderProfileDeleteDialog";
import { useSendHealth } from "./send-health/hooks/useSendHealth";
import HealthStateBadge from "./send-health/ui/HealthStateBadge";
import HoldBadge from "./send-health/ui/HoldBadge";
import ReleaseDialog from "./send-health/ui/ReleaseDialog";
import type { ReleaseTarget } from "./send-health/types";
import { healthTooltip } from "./send-health/utils/labels";

interface SenderProfileManagerProps {
    profiles: SenderProfile[];
    createProfile: (data: SenderProfileCreate) => Promise<ApiResult<SenderProfile>>;
    updateProfile: (id: number, data: SenderProfileUpdate) => Promise<ApiResult<SenderProfile>>;
    deleteProfile: (id: number) => Promise<ApiResult<never>>;
}

export default function SenderProfileManager({
    profiles,
    createProfile,
    updateProfile,
    deleteProfile,
}: SenderProfileManagerProps) {
    const [dialogTarget, setDialogTarget] = useState<SenderProfileDialogTarget | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<SenderProfile | null>(null);

    const { user } = useSession();
    // 서버가 한도 칸 변경에 관리자 권한을 요구한다. 멤버에게는 보기만 하게 해 저장이 403으로 막히지 않게 한다
    const isAdmin = !!user && hasMinRole(user.role, "admin");
    const { usageById } = useSenderUsage(profiles.length > 0);
    // 발신 건강 배지·자동 멈춤 풀기 (DESIGN-SND 10절) — 못 읽으면 배지만 빠진다
    const { senderById, releaseSender } = useSendHealth(profiles.length > 0);
    const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget | null>(null);

    const handleDelete = async (profile: SenderProfile) => {
        setDeleteTarget(null);
        const result = await deleteProfile(profile.id);
        if (result.success) toast.success("프로필이 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    const handleSetDefault = async (id: number) => {
        const result = await updateProfile(id, { isDefault: true });
        if (result.success) toast.success("기본 프로필로 설정되었습니다.");
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>발신자 프로필</CardTitle>
                            <CardDescription>발신 이름과 이메일 쌍을 여러 개 관리합니다.</CardDescription>
                        </div>
                        <Button size="sm" onClick={() => setDialogTarget({ mode: "new" })}>
                            <Plus className="h-4 w-4 mr-1" />
                            추가
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {profiles.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                            발신자 프로필이 없습니다. 추가 버튼을 눌러 생성하세요.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {profiles.map((p) => {
                                const health = senderById.get(p.id);
                                const autoPaused = p.isPaused && p.pausedSource === "auto";
                                return (
                                <div key={p.id} className="flex items-center justify-between gap-3 p-3 border rounded-lg">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-sm">{p.name}</span>
                                            {p.isDefault && (
                                                <Badge
                                                    variant="secondary"
                                                    className="text-xs"
                                                    title="자동 멈춤 안 함(기본 주소) — 기본 주소가 멈추면 이 조직의 템플릿 메일(폼 문의 첫 메일 포함)이 모두 멈추므로 발신 건강이 자동으로 멈추지 않고 알림만 합니다."
                                                >
                                                    기본
                                                </Badge>
                                            )}
                                            <SenderLimitBadges settings={toLimitSettings(p)} usage={usageById.get(p.id)} />
                                            {health && health.state !== "ok" && (
                                                <HealthStateBadge
                                                    state={health.state}
                                                    prefix="발송 "
                                                    tooltip={healthTooltip({ final: health.final, failed: health.failed, rateBp: health.rateBp, dsnOnly: health.dsnOnly })}
                                                />
                                            )}
                                            {autoPaused && <HoldBadge kind="auto_pause" reason={p.pausedReason} since={p.pausedAt} />}
                                            {isAdmin && autoPaused && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 px-2 text-xs"
                                                    onClick={() =>
                                                        setReleaseTarget({
                                                            kind: "sender",
                                                            profileId: p.id,
                                                            email: p.fromEmail,
                                                            reason: p.pausedReason ?? null,
                                                            preview: health?.releasePreview ?? null,
                                                        })
                                                    }
                                                >
                                                    풀기
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                            {p.fromName} &lt;{p.fromEmail}&gt;
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {!p.isDefault && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSetDefault(p.id)} title="기본으로 설정" aria-label="기본으로 설정">
                                                <Star className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDialogTarget({ mode: "edit", profile: p })} title="수정" aria-label="수정">
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(p)} title="삭제" aria-label="삭제">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <SenderProfileDialog
                target={dialogTarget}
                onClose={() => setDialogTarget(null)}
                usage={dialogTarget?.mode === "edit" ? usageById.get(dialogTarget.profile.id) : undefined}
                canEditLimits={isAdmin}
                createProfile={createProfile}
                updateProfile={updateProfile}
            />

            <SenderProfileDeleteDialog
                profile={deleteTarget}
                isAdmin={isAdmin}
                onCancel={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
            />

            <ReleaseDialog
                target={releaseTarget}
                onClose={() => setReleaseTarget(null)}
                onConfirm={(t, note) => releaseSender(t.kind === "sender" ? t.profileId : 0, note)}
            />
        </>
    );
}
