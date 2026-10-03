"use client";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { hasAnyLimit, toLimitSettings } from "@/lib/email-sender-limit-rules";
import { senderProfileDeleteNeedsAdmin } from "@/lib/email-sender-limit-paths";
import type { SenderProfile } from "../types";
import { todayKstYmd, warmupDayNumber } from "../utils/limitForm";

interface SenderProfileDeleteDialogProps {
    profile: SenderProfile | null;
    /** 관리자 이상인가. 한도가 걸린 주소는 서버가 관리자만 지우게 한다 */
    isAdmin: boolean;
    onCancel: () => void;
    onConfirm: (profile: SenderProfile) => void;
}

/**
 * 발신자 프로필 삭제 확인. 지우면 무엇이 바뀌는지 화면이 이미 가진 값으로만 알린다 (새 조회 없음).
 * 서버가 막을 삭제(한도가 걸린 주소를 멤버가 지우기)는 같은 규칙으로 미리 알리고 삭제 버튼을 끈다.
 */
export default function SenderProfileDeleteDialog({ profile, isAdmin, onCancel, onConfirm }: SenderProfileDeleteDialogProps) {
    const limits = profile ? toLimitSettings(profile) : null;
    const blockedReason = limits && !isAdmin ? senderProfileDeleteNeedsAdmin(limits) : null;
    const warmupDay = limits ? warmupDayNumber(limits, todayKstYmd()) : null;

    return (
        <AlertDialog open={profile !== null} onOpenChange={(open) => !open && onCancel()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>발신자 프로필 삭제</AlertDialogTitle>
                    <AlertDialogDescription>
                        {profile && (
                            <>
                                <span className="font-medium text-foreground">{profile.name}</span> ({profile.fromEmail}) 프로필을 삭제합니다. 되돌릴 수 없습니다.
                            </>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {profile && limits && (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        <li>
                            이 프로필을 묶어 둔 AI 자동 발송 규칙과 이 주소로 보낸 메일의 후속 메일은 묶음의 다른 프로필로,
                            남은 프로필이 없으면 기본 발신 프로필로 나갑니다.
                        </li>
                        {hasAnyLimit(limits) && (
                            <li>
                                이 프로필의 발송 한도·웜업 설정{warmupDay !== null ? `(웜업 ${warmupDay}일째)` : ""}과 오늘 사용량 기록도 함께 지워집니다.
                            </li>
                        )}
                        {profile.isDefault && <li>기본 프로필이라, 지우면 남은 프로필 가운데 가장 먼저 만든 것이 기본이 됩니다.</li>}
                    </ul>
                )}
                {blockedReason && <p className="text-sm text-amber-600">{blockedReason}</p>}
                <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={!!blockedReason}
                        onClick={() => profile && onConfirm(profile)}
                    >
                        삭제
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
