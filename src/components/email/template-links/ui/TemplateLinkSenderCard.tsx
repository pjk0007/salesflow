"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import SenderPoolField from "@/components/email/sender-profiles/ui/SenderPoolField";
import { isManualTrigger } from "../utils/templateLinkSender";

interface TemplateLinkSenderCardProps {
    triggerType: string;
    value: number[];
    onChange: (ids: number[]) => void;
}

export default function TemplateLinkSenderCard({ triggerType, value, onChange }: TemplateLinkSenderCardProps) {
    return (
        <Card id="section-sender">
            <CardHeader>
                <CardTitle>발신 설정</CardTitle>
                <CardDescription>자동 발송 메일을 보낼 발신 프로필 (고르지 않으면 기본 발신 프로필)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                {isManualTrigger(triggerType) ? (
                    <>
                        <p className="text-sm">수동 발송은 발송 창에서 고른 발신자로 나갑니다</p>
                        <p className="text-xs text-muted-foreground">발송 방식을 &apos;생성 시&apos;나 &apos;수정 시&apos;로 바꾸면 여기서 발신 프로필을 고릅니다.</p>
                    </>
                ) : (
                    <>
                        <Label>발신 프로필</Label>
                        <SenderPoolField value={value} onChange={onChange} showBulkScheduleNotice={false} />
                    </>
                )}
            </CardContent>
        </Card>
    );
}
