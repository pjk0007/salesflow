"use client";
import type { useEmailReply } from "../hooks/useEmailReply";
export function EmailReplyRecipients({
    state,
    disabled,
}: {
    state: ReturnType<typeof useEmailReply>;
    disabled: boolean;
}) {
    const { draft, recipients, stale } = state;
    return (
        <fieldset
            disabled={disabled}
            className="mb-3 space-y-2 rounded-lg border p-3 text-xs"
            aria-label="이메일 회신 대상"
        >
            <label className="flex items-center gap-2">
                회신 방식
                <select
                    aria-label="메일 회신 방식"
                    className="rounded border bg-background p-1"
                    value={draft.mode}
                    onChange={(e) =>
                        state.setMode(e.target.value as typeof draft.mode)
                    }
                >
                    <option value="reply">답장</option>
                    <option value="reply_all">전체 회신</option>
                    <option value="custom">받는 사람 직접 지정</option>
                </select>
            </label>
            {draft.mode === "custom" ? (
                <>
                    <label className="block">
                        받는 사람
                        <input
                            aria-label="메일 받는 사람"
                            value={draft.to}
                            onChange={(e) =>
                                state.setField("to", e.target.value)
                            }
                            className="mt-1 w-full rounded border bg-background p-2"
                            placeholder="lead@example.com, colleague@example.com"
                        />
                    </label>
                    <label className="block">
                        참조
                        <input
                            aria-label="메일 참조"
                            value={draft.cc}
                            onChange={(e) =>
                                state.setField("cc", e.target.value)
                            }
                            className="mt-1 w-full rounded border bg-background p-2"
                            placeholder="쉼표로 구분, 최대 합계 30명"
                        />
                    </label>
                </>
            ) : (
                <>
                    <p className="break-all">
                        받는 사람: {recipients.to.join(", ") || "없음"}
                    </p>
                    <p className="break-all">
                        참조: {recipients.cc.join(", ") || "없음"}
                    </p>
                </>
            )}
            <p className="text-muted-foreground">
                최신 수신 메일 기준입니다. 전체 회신에는 보이는 받는 사람과
                참조만 포함하며 숨은참조는 추가하지 않습니다.
            </p>
            {stale && (
                <p role="alert" className="text-amber-800">
                    새 메일이 도착했습니다. 작성한 본문은 유지됩니다. 받는
                    사람을 다시 확인해주세요.{" "}
                    <button
                        type="button"
                        className="underline"
                        onClick={state.reset}
                    >
                        최신 회신 대상으로 변경
                    </button>
                </p>
            )}
        </fieldset>
    );
}
