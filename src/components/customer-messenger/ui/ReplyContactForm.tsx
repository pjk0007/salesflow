"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { inboxRequest } from "@/components/inbox/api";
import type { ReplyContactDraft } from "@/lib/customer-messenger/rules";
type Contact = {
    name: string;
    phone: string;
    email: string;
    notifyEmail: boolean;
    verified: boolean;
    consent: boolean;
};
export function ReplyContactForm({
    channelKey,
    token,
    conversationId,
    profile,
    emailAvailable,
    onDraft,
    initialDraft,
}: {
    channelKey: string;
    token: string;
    conversationId?: string | null;
    profile?: { name: string; email: string | null };
    emailAvailable: boolean;
    onDraft: (draft: ReplyContactDraft | null) => void;
    initialDraft?: ReplyContactDraft | null;
}) {
    const url = `/api/messenger/${channelKey}/contact${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`;
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
    const data = useSWR<Contact>(
        token && conversationId ? [url, token] : null,
        ([u, t]: [string, string]) =>
            inboxRequest(u, { headers: { Authorization: `Bearer ${t}` } }),
    );
    const [draft, setDraft] = useState<ReplyContactDraft>(
        initialDraft ?? {
            action: "contact",
            name: profile?.name === "방문 고객" ? "" : (profile?.name ?? ""),
            phone: "",
            email: profile?.email ?? "",
            notifyEmail: false,
        },
    );
    const [busy, setBusy] = useState(false),
        [notice, setNotice] = useState(""),
        [error, setError] = useState(""),
        [code, setCode] = useState(""),
        [codeSent, setCodeSent] = useState(false);
    const touched = useRef(false);
    useEffect(() => {
        if (!touched.current && data.data)
            setDraft({
                action: "contact",
                name: data.data.name,
                phone: data.data.phone,
                email: data.data.email,
                notifyEmail: data.data.notifyEmail,
            });
    }, [data.data]);
    async function act(body: unknown) {
        setBusy(true);
        setError("");
        try {
            const result = await inboxRequest(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            });
            await data.mutate();
            return result;
        } catch (e) {
            setError((e as Error).message);
            return null;
        } finally {
            setBusy(false);
        }
    }
    const edit = (patch: Partial<ReplyContactDraft>) => {
        touched.current = true;
        onDraft(null);
        setNotice("");
        setDraft((d) => ({ ...d, ...patch }));
    };
    return (
        <details
            open={!conversationId || undefined}
            className="rounded-2xl border border-violet-100 bg-white p-4 text-xs"
            aria-label="상담 연락처와 답변 알림"
        >
            <summary className="cursor-pointer font-semibold text-gray-800">
                연락처 남기기 · 답변 알림{" "}
                <span className="font-normal text-gray-400">(선택)</span>
            </summary>
            <p className="mt-3 leading-5 text-gray-500">
                원활한 상담을 위해 연락처를 남겨주세요. 이 문의의 담당자가
                이어서 안내하는 데 사용합니다.
            </p>
            {emailAvailable && (
                <p className="mt-1 leading-5 text-gray-500">
                    상담창에서 확인하지 못한 새 답변은 동의하신 이메일로 알림을
                    받을 수 있어요.
                </p>
            )}
            <form
                className="mt-3 space-y-3"
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (!conversationId) {
                        onDraft(draft);
                        setNotice(
                            "연락처 입력을 마쳤습니다. 첫 문의를 보내면 함께 저장됩니다.",
                        );
                        return;
                    }
                    const result = await act(draft);
                    if (result) {
                        onDraft(null);
                        setNotice(
                            draft.notifyEmail
                                ? "저장했습니다. 이메일 인증 상태를 확인해주세요."
                                : "연락처를 저장했습니다.",
                        );
                    }
                }}
            >
                <label className="block space-y-1">
                    이름 또는 회사명
                    <input
                        aria-label="상담 연락처 이름"
                        className="w-full rounded-lg border px-3 py-2.5 text-sm"
                        value={draft.name}
                        onChange={(e) => edit({ name: e.target.value })}
                        maxLength={100}
                        autoComplete="name"
                    />
                </label>
                <label className="block space-y-1">
                    전화번호 (선택)
                    <input
                        aria-label="상담 연락처 전화번호"
                        type="tel"
                        className="w-full rounded-lg border px-3 py-2.5 text-sm"
                        value={draft.phone}
                        onChange={(e) => edit({ phone: e.target.value })}
                        maxLength={30}
                        autoComplete="tel"
                    />
                </label>
                <label className="block space-y-1">
                    이메일 (선택)
                    <input
                        aria-label="상담 연락처 이메일"
                        type="email"
                        className="w-full rounded-lg border px-3 py-2.5 text-sm"
                        value={draft.email}
                        onChange={(e) =>
                            edit({ email: e.target.value, notifyEmail: false })
                        }
                        maxLength={254}
                        autoComplete="email"
                        required={draft.notifyEmail}
                    />
                </label>
                {emailAvailable && (
                    <label className="flex items-start gap-2 leading-5">
                        <input
                            aria-label="이메일 답변 알림 동의"
                            type="checkbox"
                            checked={draft.notifyEmail}
                            onChange={(e) =>
                                edit({ notifyEmail: e.target.checked })
                            }
                            className="mt-1"
                        />
                        이 문의의 새 답변을 이메일로 받는 데 동의합니다. 언제든
                        해제할 수 있습니다.
                    </label>
                )}
                <p className="leading-5 text-gray-400">
                    연락처 입력은 선택이며, 입력하지 않아도 문의할 수 있습니다.
                </p>
                <button
                    disabled={busy}
                    className="rounded-lg bg-violet-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
                >
                    {busy ? "저장 중…" : "연락처 저장"}
                </button>
            </form>
            {data.data?.notifyEmail && data.data.verified ? (
                <p className="mt-3 text-emerald-700" role="status">
                    인증 완료 · 이메일 답변 알림이 켜져 있습니다.
                </p>
            ) : data.data?.notifyEmail && conversationId ? (
                <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3">
                    <p>알림을 받으려면 이메일 주소를 인증해주세요.</p>
                    <button
                        type="button"
                        disabled={busy}
                        className="font-medium text-violet-700"
                        onClick={async () => {
                            if (await act({ action: "send-code" })) {
                                setCodeSent(true);
                                setNotice("이메일로 인증번호를 보냈습니다.");
                            }
                        }}
                    >
                        {codeSent ? "인증번호 다시 보내기" : "인증번호 보내기"}
                    </button>
                    {codeSent && (
                        <div className="flex gap-2">
                            <input
                                aria-label="이메일 인증번호"
                                inputMode="numeric"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                className="min-w-0 flex-1 rounded border px-2 py-2"
                                placeholder="6자리 인증번호"
                            />
                            <button
                                type="button"
                                disabled={busy || !/^\d{6}$/.test(code)}
                                onClick={async () => {
                                    if (
                                        await act({
                                            action: "verify-code",
                                            code,
                                        })
                                    )
                                        setNotice("이메일 인증을 마쳤습니다.");
                                }}
                                className="rounded bg-violet-600 px-3 text-white disabled:opacity-50"
                            >
                                인증
                            </button>
                        </div>
                    )}
                </div>
            ) : null}
            {notice && (
                <p role="status" className="mt-3 leading-5 text-violet-700">
                    {notice}
                </p>
            )}
            {(error || data.error) && (
                <p role="alert" className="mt-3 text-red-600">
                    {error || data.error?.message}
                </p>
            )}
        </details>
    );
}
