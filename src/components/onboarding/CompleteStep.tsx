import { Button } from "@/components/ui/button";
import { PartyPopper } from "lucide-react";

interface CompleteStepProps {
    workspaceName: string;
    fieldsCreated: number;
    invitesSent: number;
    onStart: () => void;
    isLoading: boolean;
}

export default function CompleteStep({
    workspaceName,
    fieldsCreated,
    invitesSent,
    onStart,
    isLoading,
}: CompleteStepProps) {
    return (
        <div className="space-y-6 text-center">
            <PartyPopper className="mx-auto h-16 w-16 text-primary" />

            <div>
                <h2 className="text-2xl font-bold">모든 설정이 완료되었습니다!</h2>
                <p className="mt-2 text-muted-foreground">
                    이제 SalesFlow를 시작해보세요.
                </p>
            </div>

            <div className="rounded-lg border p-4 text-left space-y-2">
                {workspaceName && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">워크스페이스</span>
                        <span className="font-medium">{workspaceName}</span>
                    </div>
                )}
                {fieldsCreated > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">필드</span>
                        <span className="font-medium">{fieldsCreated}개 설정됨</span>
                    </div>
                )}
                {invitesSent > 0 && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">초대</span>
                        <span className="font-medium">{invitesSent}명 초대됨</span>
                    </div>
                )}
                {!workspaceName && fieldsCreated === 0 && invitesSent === 0 && (
                    <p className="text-sm text-muted-foreground text-center">
                        설정을 건너뛰었습니다. 언제든 설정에서 변경할 수 있어요.
                    </p>
                )}
            </div>

            <Button size="lg" onClick={onStart} disabled={isLoading} className="w-full">
                {isLoading ? "처리 중..." : "시작하기"}
            </Button>
        </div>
    );
}
