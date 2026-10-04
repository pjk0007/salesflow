"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { REPLY_TO_MAX_LENGTH } from "@/lib/reply-to-rules";
import { REPLY_TO_HELP, replyToFieldValue, replyToMxNotice, type MxStatus } from "../utils/replyTo";
import ReplyToWarning from "./ReplyToWarning";

interface ReplyToEmailFieldProps {
    value: string;
    onChange: (value: string) => void;
    /** 마지막 저장 응답의 MX 결과와 그때 저장한 주소. 칸을 고치면(저장한 주소와 다르면) 안내를 감춘다 */
    lastCheck: { email: string | null; mx: MxStatus | null } | null;
    /** 저장하려다 막힌 형식 오류. 칸을 고치면 부르는 쪽이 지운다 */
    error?: string | null;
    /** 관리자(owner·admin)만 바꿀 수 있다. 멤버면 읽기만 */
    disabled?: boolean;
}

/**
 * 워크스페이스 설정의 "답장 받을 주소" 칸 (DESIGN-3 3절). 저장은 설정 폼의 저장 버튼이 다른 칸과 함께 한다.
 * 비우면 Reply-To 헤더를 넣지 않는다 (지금과 같음). 저장할 때 서버가 도메인의 MX를 조회해 없으면 노란 경고를 보인다 —
 * 저장은 막지 않는다 (DNS 일시 오류일 수 있다).
 */
export default function ReplyToEmailField({ value, onChange, lastCheck, error, disabled }: ReplyToEmailFieldProps) {
    const parsed = replyToFieldValue(value);
    const current = parsed.ok ? parsed.value : null;
    const notice =
        lastCheck && lastCheck.email !== null && lastCheck.email === current
            ? replyToMxNotice(lastCheck.mx, lastCheck.email)
            : null;

    return (
        <div className="space-y-1.5">
            <Label htmlFor="workspace-reply-to">답장 받을 주소</Label>
            <Input
                id="workspace-reply-to"
                type="email"
                inputMode="email"
                autoComplete="off"
                maxLength={REPLY_TO_MAX_LENGTH}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="예: ceo@matchesplan.com"
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                className={cn(error && "border-destructive")}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">{REPLY_TO_HELP}</p>
            {parsed.ok && parsed.value === null && (
                <p className="text-xs text-muted-foreground">비워 두면 답장이 메일을 보낸 발신 주소로 갑니다.</p>
            )}
            {disabled && <p className="text-xs text-muted-foreground">관리자만 바꿀 수 있습니다.</p>}
            {notice?.tone === "warning" && <ReplyToWarning>{notice.text}</ReplyToWarning>}
            {notice?.tone === "muted" && <p className="text-xs text-muted-foreground">{notice.text}</p>}
        </div>
    );
}
