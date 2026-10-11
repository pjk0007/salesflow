"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";
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
import SenderProfileList from "./ui/sender-profile-list";

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
                    <SenderProfileList
                        profiles={profiles}
                        onEdit={(profile) => setDialogTarget({ mode: "edit", profile })}
                        onDelete={setDeleteTarget}
                        onSetDefault={handleSetDefault}
                        renderBadges={(p) => {
                            const health = senderById.get(p.id);
                            const autoPaused = p.isPaused && p.pausedSource === "auto";
                            return (
                                <>
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
                                            onClick={() => setReleaseTarget({
                                                kind: "sender", profileId: p.id, email: p.fromEmail,
                                                reason: p.pausedReason ?? null, preview: health?.releasePreview ?? null,
                                            })}
                                        >
                                            풀기
                                        </Button>
                                    )}
                                </>
                            );
                        }}
                    />
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
