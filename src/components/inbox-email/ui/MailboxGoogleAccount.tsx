"use client";
import { useState } from "react";
import { toast } from "sonner";
import { changeGoogleAccount } from "../api";
import type { EmailMailbox } from "../types";
export function MailboxGoogleAccount({
    box,
    onChange,
}: {
    box: EmailMailbox;
    onChange: () => Promise<unknown>;
}) {
    const current = box.googleAccount || box.address;
    const [account, setAccount] = useState(current),
        [busy, setBusy] = useState(false);
    return (
        <form
            className="space-y-2"
            onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                    await changeGoogleAccount(box.id, box.version, account);
                    await onChange();
                    toast.success(
                        "로그인 계정을 저장했습니다. Google 계정을 연결해주세요.",
                    );
                } catch (e) {
                    toast.error((e as Error).message);
                } finally {
                    setBusy(false);
                }
            }}
        >
            <label className="block text-sm">
                Google 로그인 계정
                <input
                    aria-label={`${box.address} Google 로그인 계정`}
                    className="mt-1 w-full rounded border p-2"
                    type="email"
                    required
                    maxLength={254}
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    disabled={busy}
                />
            </label>
            <button
                className="rounded border px-3 py-2 text-sm"
                disabled={busy || account.trim().toLowerCase() === current}
            >
                로그인 계정 저장
            </button>
            <p className="text-xs text-muted-foreground">
                통합 메일함을 쓰면 실제 로그인 주소를 입력하세요. 계정 변경 전
                Google 연결을 해제해주세요. 저장하면 수신·발송이 중지됩니다.
            </p>
        </form>
    );
}
