"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GoogleConnectionPanel } from "./GoogleConnectionPanel";
import { MailboxGoogleAccount } from "./MailboxGoogleAccount";
import { MailboxName } from "./MailboxName";
import { MailboxToggle } from "./MailboxToggle";
import { toast } from "sonner";
import { useEmailMailboxes } from "../hooks/useEmailMailboxes";
import { createEmailMailbox } from "../api";
import { connectionResultMessage } from "../utils/connection-result";
export function EmailMailboxSettings({
    workspaceId,
    onClose: close,
}: {
    workspaceId: number;
    onClose: () => void;
}) {
    const params = useSearchParams(),
        router = useRouter(),
        pathname = usePathname();
    const connectionResult = params.get("emailConnection");
    // 닫으면 승인 결과 쿼리를 지워 다시 열거나 새로고침할 때 지난 결과가 반복되지 않게 한다.
    const onClose = () => {
        if (connectionResult) {
            const next = new URLSearchParams(params.toString());
            next.delete("emailConnection");
            const query = next.toString();
            router.replace(query ? `${pathname}?${query}` : pathname, {
                scroll: false,
            });
        }
        close();
    };
    const { data, error, mutate } = useEmailMailboxes(workspaceId);
    const [address, setAddress] = useState(""),
        [googleAccount, setGoogleAccount] = useState(""),
        [name, setName] = useState(""),
        [busy, setBusy] = useState(false);
    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await fn();
            await mutate();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={onClose}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-label="이메일 상담 연결"
                className="h-full w-full max-w-lg space-y-6 overflow-auto bg-background p-7"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">이메일 상담 연결</h2>
                    <button aria-label="메일 설정 닫기" onClick={onClose}>
                        닫기
                    </button>
                </header>
                {connectionResult && (
                    <p role="status" className="rounded border p-3 text-sm">
                        {connectionResultMessage(connectionResult)}
                    </p>
                )}
                <p className="text-sm text-muted-foreground">
                    등록한 메일함의 문의를 같은 상담함에서 받고 답장합니다.
                    Google 계정을 연결하거나 개발자가 API 연결 서버를 설치한 뒤
                    수신·발송을 켜주세요. 주소 등록만으로 Gmail에 연결되지는
                    않습니다.
                </p>
                {error && (
                    <p role="alert">
                        {error.message}{" "}
                        <button onClick={() => void mutate()}>
                            다시 불러오기
                        </button>
                    </p>
                )}
                {!data && !error && <p>메일함을 불러오는 중…</p>}
                {data?.map((box) => (
                    <article
                        key={box.id}
                        className="space-y-3 rounded-xl border p-4"
                    >
                        <h3 className="font-semibold">{box.name}</h3>
                        <p>{box.address}</p>
                        {!!box.aliasMailboxCount &&
                            (!box.googleAccount ||
                                box.googleAccount === box.address) && (
                                <p className="text-xs text-amber-800">
                                    이 계정을 로그인 계정으로 쓰는 다른 사업
                                    메일함이 {box.aliasMailboxCount}개 있어,
                                    그 주소로만 온 메일은 이 기본 메일함에
                                    가져오지 않습니다. 받는 사람·참조에 이
                                    주소도 있으면 양쪽 메일함에서 받습니다.
                                </p>
                            )}
                        <MailboxName
                            key={`name:${box.name}`}
                            box={box}
                            onChange={mutate}
                        />
                        <MailboxGoogleAccount
                            key={box.googleAccount || box.address}
                            box={box}
                            onChange={mutate}
                        />
                        <p className="text-xs text-muted-foreground">
                            연결 ID <code className="break-all">{box.id}</code>
                        </p>
                        <p className="text-sm">
                            {box.enabled ? "수신·발송 허용" : "수신·발송 중지"}
                        </p>
                        <MailboxToggle
                            box={box}
                            busy={busy}
                            onChange={mutate}
                        />
                        <GoogleConnectionPanel box={box} onChange={mutate} />
                    </article>
                ))}
                <form
                    className="space-y-3 border-t pt-5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                            await createEmailMailbox(
                                workspaceId,
                                address,
                                name,
                                googleAccount.trim() || undefined,
                            );
                            setAddress("");
                            setName("");
                            setGoogleAccount("");
                        });
                    }}
                >
                    <h3 className="font-semibold">메일함 등록</h3>
                    <label className="block text-sm">
                        보내는 이름 (고객에게 표시)
                        <input
                            className="mt-1 w-full rounded-lg border p-2"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            maxLength={100}
                            disabled={busy}
                        />
                    </label>
                    <label className="block text-sm">
                        사업 문의 주소 (수신·답장)
                        <input
                            type="email"
                            className="mt-1 w-full rounded-lg border p-2"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            required
                            maxLength={254}
                            disabled={busy}
                        />
                    </label>
                    <label className="block text-sm">
                        Google 로그인 계정 (다른 경우)
                        <input
                            type="email"
                            className="mt-1 w-full rounded-lg border p-2"
                            value={googleAccount}
                            onChange={(e) => setGoogleAccount(e.target.value)}
                            maxLength={254}
                            disabled={busy}
                            placeholder="예: support@100office.kr"
                        />
                    </label>
                    <p className="text-xs text-muted-foreground">
                        같은 통합 계정을 여러 사업에서 연결할 수 있습니다. 문의
                        주소는 Gmail에서 인증된 발신 주소여야 하며, 해당 주소로
                        받은 문의만 이 사업에 가져옵니다.
                    </p>
                    <button
                        disabled={busy || !data}
                        className="rounded-lg bg-[#635BFF] px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                        중지 상태로 등록
                    </button>
                    <p className="text-xs text-muted-foreground">
                        연결을 중지하면 아직 발송을 시작하지 않은 답장은
                        취소됩니다. 이미 메일 서비스에 전달한 요청은 결과 확인이
                        필요합니다.
                    </p>
                </form>
            </section>
        </div>
    );
}
