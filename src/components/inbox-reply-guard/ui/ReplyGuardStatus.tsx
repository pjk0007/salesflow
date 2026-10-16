"use client";
import { useState } from "react";
import type { useReplyGuard } from "../hooks/useReplyGuard";
export function ReplyGuardStatus({
    guard,
    refresh,
    hasDraft,
}: {
    guard: ReturnType<typeof useReplyGuard>;
    refresh: () => Promise<unknown>;
    hasDraft: boolean;
}) {
    const [reason, setReason] = useState("");
    if (!guard.required) return null;
    return (
        <section
            aria-label="답변 작성 권한"
            className="mb-3 space-y-2 rounded-lg border bg-muted p-3 text-xs"
        >
            <p>
                {guard.mine
                    ? "이 창에서 고객 답변을 작성하고 있습니다."
                    : guard.lease
                      ? `${guard.lease.name}님이 고객 답변을 작성 중입니다. 내 초안은 이 창에 보존됩니다.`
                      : "답변 작성을 시작하면 이 창에서 전송할 수 있습니다."}
            </p>
            <p className="text-muted-foreground">
                내부 메모는 함께 작성할 수 있습니다. 창을 떠나면 해제하며 연결이
                끊기면 최대90초 후 만료됩니다.
            </p>
            {guard.error && (
                <p role="alert" className="text-red-700">
                    {guard.error}
                </p>
            )}
            {!guard.mine && hasDraft && (
                <p className="text-amber-800">
                    보관된 초안이 있습니다. 최신 대화를 확인하고 문장을 검토한
                    뒤 작성을 재개해주세요.
                </p>
            )}
            {guard.stale && (
                <p role="alert" className="text-amber-800">
                    작성 중 대화가 변경되었습니다. 최신 메시지와 초안을 검토한
                    뒤 전송해주세요.
                </p>
            )}
            {!guard.lease && (
                <button
                    type="button"
                    disabled={guard.busy || !guard.latest}
                    className="rounded border bg-background px-3 py-2"
                    onClick={() => void guard.begin()}
                >
                    {hasDraft
                        ? "대화 확인·초안으로 작성 재개"
                        : "답변 작성 시작"}
                </button>
            )}
            {guard.mine && (
                <>
                    {guard.stale && (
                        <button
                            type="button"
                            disabled={guard.busy || !guard.latest}
                            className="rounded border bg-background px-3 py-2"
                            onClick={() => void guard.acknowledge()}
                        >
                            최신 대화 확인·초안 유지
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={guard.busy}
                        className="ml-2 underline"
                        onClick={() => void guard.release()}
                    >
                        작성 권한 해제
                    </button>
                </>
            )}
            {guard.lease && !guard.mine && guard.canManage && (
                <div className="space-y-2">
                    <label className="block">
                        인계 사유{" "}
                        <input
                            aria-label="답변 인계 사유"
                            className="ml-2 rounded border p-2"
                            value={reason}
                            maxLength={300}
                            onChange={(e) => setReason(e.target.value)}
                        />
                    </label>
                    <button
                        type="button"
                        disabled={
                            guard.busy ||
                            !guard.latest ||
                            reason.trim().length < 3
                        }
                        className="rounded border bg-background px-3 py-2"
                        onClick={() => void guard.begin(reason)}
                    >
                        답변 작성 인계받기
                    </button>
                </div>
            )}
            {(!guard.latest || guard.error) && (
                <button
                    type="button"
                    className="ml-2 underline"
                    disabled={guard.busy}
                    onClick={() =>
                        void Promise.all([refresh(), guard.refresh()])
                    }
                >
                    대화·작성 상태 새로고침
                </button>
            )}
        </section>
    );
}
