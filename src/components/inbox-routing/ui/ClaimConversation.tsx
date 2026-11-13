"use client";
import { Button } from "@/components/ui/button";

/** 담당자가 없는 상담방 하단에 띄우는 "나에게 배정" 안내. 배정해야 답변을 쓸 수 있다. */
export function ClaimConversation({
    busy,
    onClaim,
}: {
    busy: boolean;
    onClaim: () => void;
}) {
    return (
        <div className="m-4 shrink-0 rounded-lg border border-border/40 bg-muted/40 p-5">
            <p className="text-sm font-semibold">
                아무도 담당하지 않은 대화방이에요.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
                바로 담당자가 되려면 아래 버튼을 눌러주세요.
            </p>
            <Button className="mt-4" disabled={busy} onClick={onClaim}>
                {busy ? "배정하는 중…" : "나에게 배정"}
            </Button>
        </div>
    );
}
