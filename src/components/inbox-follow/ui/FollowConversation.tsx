"use client";
import { Button } from "@/components/ui/button";

/** 내가 담당자도 팔로워도 아닌 대화방 하단 안내. 팔로우해야 답장을 쓸 수 있다 */
export function FollowConversation({ busy, onFollow }: { busy: boolean; onFollow: () => void }) {
    return (
        <div className="m-4 shrink-0 rounded-lg border border-border/40 bg-muted/40 p-5">
            <p className="text-sm font-semibold">팔로우하지 않은 대화방이에요.</p>
            <p className="mt-1 text-sm text-muted-foreground">대화방을 팔로우하시려면 버튼을 눌러주세요.</p>
            <Button variant="secondary" className="mt-4" disabled={busy} onClick={onFollow}>
                {busy ? "팔로우하는 중…" : "팔로우"}
            </Button>
        </div>
    );
}
