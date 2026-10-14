"use client";
import { InboxAudit } from "./InboxAudit";
import { useState } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import type { InboxBootstrap, InboxChannel } from "../types";
import { inboxWrite } from "../api";
export function ChannelSettings({
    bootstrap,
    channel,
    onClose,
    onSaved,
}: {
    bootstrap: InboxBootstrap;
    channel?: InboxChannel;
    onClose: () => void;
    onSaved: (channel: InboxChannel) => void;
}) {
    const availableWorkspaces = channel
        ? bootstrap.workspaces
        : bootstrap.workspaces.filter(
              (w) => !bootstrap.channels.some((c) => c.workspaceId === w.id),
          );
    const [workspaceId, setWorkspace] = useState(
        channel?.workspaceId ?? availableWorkspaces[0]?.id ?? 0,
    );
    const [name, setName] = useState(channel?.name ?? "고객 상담");
    const [greeting, setGreeting] = useState(
        channel?.greeting ??
            "반갑습니다. 무엇을 도와드릴까요?\n궁금한 점을 남겨주시면 안내드리겠습니다.",
    );
    const [color, setColor] = useState(channel?.color ?? "#635BFF");
    const [origins, setOrigins] = useState(
        channel?.allowedOrigins.join("\n") ?? "",
    );
    const [enabled, setEnabled] = useState(channel?.enabled ?? false),
        [busy, setBusy] = useState(false);
    const base = typeof window === "undefined" ? "" : window.location.origin;
    const snippet = channel
        ? `<script src="${base}/sendb-chat.js" data-channel="${channel.publicKey}" defer></script>`
        : "";
    const field = "w-full rounded-xl border bg-background px-3 py-2 text-sm";
    return (
        <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={onClose}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="inbox-settings"
                className="h-full w-full max-w-lg overflow-auto bg-background p-7 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="mb-6 flex items-center justify-between">
                    <div>
                        <h2
                            id="inbox-settings"
                            className="text-xl font-semibold"
                        >
                            사이트 상담창
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            사이트에 설치하면 문의가 수신함으로 들어옵니다.
                        </p>
                    </div>
                    <button aria-label="설정 닫기" onClick={onClose}>
                        <X size={20} />
                    </button>
                </header>
                {workspaceId > 0 && (
                    <a
                        className="mb-5 block text-sm text-[#635BFF]"
                        href={`/customer-ai?workspaceId=${workspaceId}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        상담 AI·승인 지식 설정 ↗
                    </a>
                )}
                <form
                    className="space-y-5"
                    onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        try {
                            const saved = await inboxWrite<InboxChannel>(
                                "/api/inbox/channels",
                                {
                                    workspaceId,
                                    name,
                                    greeting,
                                    color,
                                    allowedOrigins: origins
                                        .split(/\n|,/)
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    enabled,
                                },
                            );
                            toast.success("상담창 설정을 저장했습니다.");
                            onSaved(saved);
                        } catch (e) {
                            toast.error((e as Error).message);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">
                            사업 · 워크스페이스
                        </span>
                        <select
                            aria-label="상담창 워크스페이스"
                            className={field}
                            value={workspaceId}
                            disabled={!!channel}
                            onChange={(e) =>
                                setWorkspace(Number(e.target.value))
                            }
                        >
                            {!availableWorkspaces.length && (
                                <option value={0}>
                                    모든 사업의 상담창을 만들었습니다
                                </option>
                            )}
                            {availableWorkspaces.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">상담창 이름</span>
                        <input
                            className={field}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            maxLength={100}
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">환영 인사</span>
                        <textarea
                            className={field}
                            rows={3}
                            value={greeting}
                            onChange={(e) => setGreeting(e.target.value)}
                            required
                            maxLength={1000}
                        />
                    </label>
                    <label className="flex items-center justify-between text-sm">
                        브랜드 색상
                        <input
                            aria-label="브랜드 색상"
                            type="color"
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium">설치 도메인</span>
                        <textarea
                            className={field}
                            rows={3}
                            value={origins}
                            onChange={(e) => setOrigins(e.target.value)}
                            placeholder="https://designer-hire.com"
                        />
                        <span className="block text-xs text-muted-foreground">
                            주소를 한 줄에 하나씩 입력하세요. http://localhost
                            주소로 로컬 시험도 가능합니다.
                        </span>
                    </label>
                    <label className="flex items-center justify-between rounded-xl border p-4 text-sm font-medium">
                        상담창 사용
                        <input
                            aria-label="상담창 사용"
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => setEnabled(e.target.checked)}
                        />
                    </label>
                    <button
                        disabled={busy || !workspaceId}
                        className="w-full rounded-xl bg-[#635BFF] py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                        {busy ? "저장 중…" : "설정 저장"}
                    </button>
                </form>
                {channel && (
                    <div className="mt-7 space-y-3 border-t pt-5">
                        <InboxAudit
                            url={`/api/inbox/channels/${channel.id}/audit`}
                        />
                        <h3 className="font-medium">사이트에 설치</h3>
                        <p className="text-sm text-muted-foreground">
                            설치할 사이트의 HTML에 아래 코드를 추가하세요.
                        </p>
                        <pre className="overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted p-4 text-xs">
                            {snippet}
                        </pre>
                        <div className="flex gap-3">
                            <button
                                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(
                                            snippet,
                                        );
                                        toast.success(
                                            "설치 코드를 복사했습니다.",
                                        );
                                    } catch {
                                        toast.error(
                                            "코드를 직접 선택해서 복사해주세요.",
                                        );
                                    }
                                }}
                            >
                                <Copy size={14} />
                                설치 코드 복사
                            </button>
                            <a
                                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                                href={`/chat/${channel.publicKey}`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <ExternalLink size={14} />
                                상담창 열기
                            </a>
                        </div>
                        {!channel.enabled && (
                            <p className="text-sm text-amber-700">
                                현재 꺼져 있습니다. 도메인을 등록하고 사용을
                                켜주세요.
                            </p>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
