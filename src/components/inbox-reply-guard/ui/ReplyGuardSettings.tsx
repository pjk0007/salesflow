"use client";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { InboxAudit } from "@/components/inbox/ui/InboxAudit";
import { loadReplyGuard, saveReplyGuard } from "../api";
export function ReplyGuardSettings({
    channelId,
    name,
    onClose,
    onSaved,
}: {
    channelId: number;
    name: string;
    onClose: () => void;
    onSaved: () => Promise<unknown>;
}) {
    const query = useSWR(
        `/api/inbox-reply-guard?channelId=${channelId}`,
        loadReplyGuard,
        { refreshInterval: 15000 },
    );
    const [draft, setDraft] = useState<{
            enabled: boolean;
            version: number;
        } | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{name} · 답변 충돌 방지</DialogTitle>
                    <DialogDescription>
                        한 상담에 한 창만 고객 답변을 전송하도록 보호합니다.
                        내부 메모와 각 직원의 초안은 유지합니다.
                    </DialogDescription>
                </DialogHeader>
                {!query.data && <p>설정을 불러오는 중…</p>}
                {(query.error || error) && (
                    <p role="alert" className="text-sm text-red-700">
                        {query.error?.message || error}
                    </p>
                )}
                <label className="flex gap-2 text-sm">
                    <input
                        aria-label="답변 작성 잠금 사용"
                        type="checkbox"
                        disabled={busy || !query.data}
                        checked={draft?.enabled ?? query.data?.enabled ?? false}
                        onChange={(e) =>
                            setDraft({
                                enabled: e.target.checked,
                                version: draft?.version ?? query.data!.version,
                            })
                        }
                    />
                    고객 답변에 작성 권한과 최신 대화 확인 필수
                </label>
                <p className="text-xs text-muted-foreground">
                    기본 꺼짐입니다. 켜면 웹·이메일·서버 SDK의 직원 답변에
                    적용합니다. 작성 중 새 메시지가 오면 초안을 검토하고 다시
                    확인해야 합니다. 관리자는 인계 사유를 남기고 작성 권한을
                    받을 수 있습니다.
                </p>
                <p className="text-xs text-muted-foreground">
                    설정을 바꾸면 기존 작성 권한은 만료됩니다. 서버 SDK 연동도
                    작성 권한 API를 연결한 뒤 사용해주세요.
                </p>
                {draft &&
                    query.data &&
                    draft.version !== query.data.version && (
                        <p className="text-xs text-amber-800">
                            다른 창에서 설정을 바꿨습니다. 선택한 값은
                            유지했습니다.
                        </p>
                    )}
                <button
                    className="rounded border px-3 py-2"
                    disabled={busy || !query.data}
                    onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                            await saveReplyGuard({
                                channelId,
                                version: draft?.version ?? query.data!.version,
                                enabled: draft?.enabled ?? query.data!.enabled,
                            });
                            await query.mutate();
                            await onSaved();
                            setDraft(null);
                            toast.success(
                                "이 사업의 답변 잠금 설정을 저장했습니다.",
                            );
                        } catch (e) {
                            setError((e as Error).message);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    답변 잠금 설정 저장
                </button>
                {error && (
                    <button
                        className="text-xs underline"
                        disabled={busy}
                        onClick={async () => {
                            setBusy(true);
                            try {
                                await query.mutate();
                                setDraft(null);
                                setError("");
                            } catch (e) {
                                setError((e as Error).message);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        최신 설정 불러오기
                    </button>
                )}
                <InboxAudit url={`/api/inbox/channels/${channelId}/audit`} />
            </DialogContent>
        </Dialog>
    );
}
