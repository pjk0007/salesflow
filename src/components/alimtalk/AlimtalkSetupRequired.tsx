"use client";

import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

/** NHN Cloud 키가 없을 때 대시보드·발신프로필·템플릿 탭이 '목록 없음' 대신 함께 쓰는 안내 */
export default function AlimtalkSetupRequired({ onConfigure }: { onConfigure?: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center p-12">
            <Settings className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">알림톡 설정이 필요합니다</h3>
            <p className="text-sm text-muted-foreground mb-4">
                NHN Cloud API 키를 등록하여 알림톡 서비스를 시작하세요.
            </p>
            {onConfigure && <Button onClick={onConfigure}>설정으로 이동</Button>}
        </div>
    );
}
