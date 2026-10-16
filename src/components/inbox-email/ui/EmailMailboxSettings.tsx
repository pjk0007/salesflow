"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { GoogleConnectionPanel } from "./GoogleConnectionPanel";
import { toast } from "sonner";
import { useEmailMailboxes } from "../hooks/useEmailMailboxes";
import { createEmailMailbox, toggleEmailMailbox } from "../api";
export function EmailMailboxSettings({
    workspaceId,
    onClose,
}: {
    workspaceId: number;
    onClose: () => void;
}) {
    const connectionResult = useSearchParams().get("emailConnection");
    const { data, error, mutate } = useEmailMailboxes(workspaceId);
    const [address, setAddress] = useState(""),
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
                        {connectionResult === "connected"
                            ? "Google 계정이 연결됐습니다. 메일함의 수신·발송 켜기를 눌러주세요."
                            : connectionResult === "cancelled"
                              ? "Google 연결 승인을 취소했습니다."
                              : "Google 연결을 완료하지 못했습니다. 등록 주소와 같은 계정으로 다시 시도해주세요."}
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
                        <p className="text-xs text-muted-foreground">
                            연결 ID <code className="break-all">{box.id}</code>
                        </p>
                        <p className="text-sm">
                            {box.enabled ? "수신·발송 허용" : "수신·발송 중지"}
                        </p>
                        <button
                            disabled={busy}
                            className="rounded-lg border px-3 py-2 text-sm"
                            onClick={() =>
                                void run(() =>
                                    toggleEmailMailbox(
                                        box.id,
                                        box.version,
                                        !box.enabled,
                                    ),
                                )
                            }
                        >
                            {box.enabled ? "수신·발송 중지" : "수신·발송 켜기"}
                        </button>
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
                            );
                            setAddress("");
                            setName("");
                        });
                    }}
                >
                    <h3 className="font-semibold">메일함 등록</h3>
                    <label className="block text-sm">
                        메일함 이름
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
                        수신·발신 주소
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
