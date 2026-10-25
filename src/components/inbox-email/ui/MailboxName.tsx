"use client";
import { useState } from "react";
import { toast } from "sonner";
import { renameEmailMailbox } from "../api";
import type { EmailMailbox } from "../types";
/** 고객이 받는 답장의 보내는 이름(From 표시 이름). 바꿔도 발송 대기 답장은 취소되지 않는다. */
export function MailboxName({
    box,
    onChange,
}: {
    box: EmailMailbox;
    onChange: () => Promise<unknown>;
}) {
    const [name, setName] = useState(box.name),
        [busy, setBusy] = useState(false);
    return (
        <form
            className="space-y-2"
            onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                    await renameEmailMailbox(
                        box.id,
                        box.version,
                        box.enabled,
                        name.trim(),
                    );
                    await onChange();
                    toast.success("보내는 이름을 저장했습니다. 다음 답장부터 적용됩니다.");
                } catch (e) {
                    toast.error((e as Error).message);
                } finally {
                    setBusy(false);
                }
            }}
        >
            <label className="block text-sm">
                보내는 이름 (고객에게 표시)
                <input
                    aria-label={`${box.address} 보내는 이름`}
                    className="mt-1 w-full rounded border p-2"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                />
            </label>
            <button
                className="rounded border px-3 py-2 text-sm"
                disabled={busy || !name.trim() || name.trim() === box.name}
            >
                보내는 이름 저장
            </button>
        </form>
    );
}
