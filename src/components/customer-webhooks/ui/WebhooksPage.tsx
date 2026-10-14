"use client";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { webhookRequest, webhookWrite } from "../api";
import type { WebhookEndpoint, WebhookList } from "../types";
import type { InboxBootstrap } from "@/components/inbox/types";
import { WebhookEditor } from "./WebhookEditor";
import { WebhookDeliveries } from "./WebhookDeliveries";
export function WebhooksPage({ role }: { role: string }) {
    void role;
    const params = useSearchParams(),
        router = useRouter(),
        pathname = usePathname();
    const bootstrap = useSWR<InboxBootstrap>(
            "/api/customer-platform/webhooks-config",
            webhookRequest,
        ),
        [chosenWorkspace, setWorkspace] = useState<number | null>(
            Number(params.get("workspaceId")) || null,
        ),
        [selected, setSelected] = useState<string | null>(null),
        [creating, setCreating] = useState(false),
        [busy, setBusy] = useState(false),
        [issued, setIssued] = useState<{ id: string; secret: string } | null>(
            null,
        );
    const workspaceId =
            chosenWorkspace ?? bootstrap.data?.workspaces[0]?.id ?? null,
        list = useSWR<WebhookList>(
            workspaceId
                ? `/api/customer-platform/webhooks?workspaceId=${workspaceId}`
                : null,
            webhookRequest,
            { refreshInterval: 5000 },
        ),
        endpoint = list.data?.endpoints.find((e) => e.id === selected),
        canManage = workspaceAbilities(bootstrap.data, workspaceId).manage;
    async function save(value: unknown) {
        setBusy(true);
        try {
            const result = await webhookWrite<{
                endpoint: WebhookEndpoint;
                secret?: string;
            }>(
                `/api/customer-platform/webhooks${endpoint ? `/${endpoint.id}` : ""}`,
                endpoint ? value : { workspaceId, ...(value as object) },
                endpoint ? "PATCH" : "POST",
            );
            if (result.secret)
                setIssued({ id: result.endpoint.id, secret: result.secret });
            setSelected(result.endpoint.id);
            setCreating(false);
            await list.mutate();
            toast.success("웹훅을 저장했습니다.");
            return result.endpoint;
        } finally {
            setBusy(false);
        }
    }
    async function action(type: "test" | "rotate") {
        if (!endpoint) return;
        setBusy(true);
        try {
            const result = await webhookWrite<{
                endpoint?: WebhookEndpoint;
                secret?: string;
            }>(
                `/api/customer-platform/webhooks/${endpoint.id}`,
                type === "test"
                    ? { action: type, clientId: crypto.randomUUID() }
                    : { action: type, version: endpoint.version },
            );
            if (result.secret)
                setIssued({ id: endpoint.id, secret: result.secret });
            await list.mutate();
            toast.success(
                type === "test"
                    ? "가상 이벤트를 발송 대기열에 넣었습니다."
                    : "새 서명 키를 발급했습니다.",
            );
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <main className="space-y-6 p-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">
                        고객 플랫폼 외부 연동
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        고객·상담·영업 변화를 두 사이트와 업무 도구로
                        전달합니다.
                    </p>
                </div>
                <label className="text-sm">
                    사업
                    <select
                        aria-label="외부 연동 사업"
                        className="ml-3 rounded-lg border p-2"
                        value={workspaceId ?? ""}
                        onChange={(e) => {
                            setWorkspace(Number(e.target.value));
                            const query = new URLSearchParams(
                                params.toString(),
                            );
                            query.set("workspaceId", e.target.value);
                            router.replace(`${pathname}?${query}`, {
                                scroll: false,
                            });
                            setSelected(null);
                            setCreating(false);
                            setIssued(null);
                        }}
                    >
                        {bootstrap.data?.workspaces.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.name}
                            </option>
                        ))}
                    </select>
                </label>
            </header>
            {(bootstrap.error || list.error) && (
                <p role="alert" className="text-red-600">
                    {bootstrap.error?.message || list.error?.message}
                    <button
                        onClick={() => {
                            void bootstrap.mutate();
                            void list.mutate();
                        }}
                        className="ml-2 underline"
                    >
                        다시 불러오기
                    </button>
                </p>
            )}
            {list.data && !list.data.workerEnabled && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                    현재 자동 발송 워커가 꺼져 있습니다. 설정과 대기 내역을
                    준비할 수 있으며, 관리자가 서버 발송 설정을 켜면 전달을
                    시작합니다.
                </p>
            )}
            {issued && selected === issued.id && (
                <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm">
                    <p className="font-medium">서명 키가 발급되었습니다.</p>
                    <p>
                        이 창에서 한 번 복사해 수신 서버에 저장하세요. 나중에
                        잃어버리면 새 키를 발급할 수 있습니다.
                    </p>
                    <button
                        className="rounded-lg border bg-white px-3 py-2"
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(
                                    issued.secret,
                                );
                                toast.success("서명 키를 복사했습니다.");
                            } catch {
                                toast.error(
                                    "브라우저의 클립보드 접근을 허용한 뒤 다시 복사해주세요.",
                                );
                            }
                        }}
                    >
                        서명 키 복사
                    </button>
                    <button
                        className="ml-3 text-xs underline"
                        onClick={() => setIssued(null)}
                    >
                        키 표시 닫기
                    </button>
                </div>
            )}
            <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
                <aside className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="font-semibold">등록한 웹훅</h2>
                        {canManage && (
                            <button
                                className="text-sm text-[#635BFF]"
                                onClick={() => {
                                    setSelected(null);
                                    setCreating(true);
                                    setIssued(null);
                                }}
                            >
                                새 웹훅
                            </button>
                        )}
                    </div>
                    {!list.data ? (
                        <p>불러오는 중…</p>
                    ) : !list.data.endpoints.length ? (
                        <p className="rounded-xl border p-5 text-sm text-muted-foreground">
                            등록한 웹훅이 없습니다.
                        </p>
                    ) : (
                        list.data.endpoints.map((e) => (
                            <button
                                key={e.id}
                                className={`w-full space-y-1 rounded-xl border p-4 text-left text-sm ${selected === e.id ? "border-violet-300 bg-violet-50" : ""}`}
                                onClick={() => {
                                    setSelected(e.id);
                                    setCreating(false);
                                    if (issued?.id !== e.id) setIssued(null);
                                }}
                            >
                                <strong className="block">{e.name}</strong>
                                <span className="block text-xs text-muted-foreground">
                                    {new URL(e.url).hostname} ·{" "}
                                    {e.enabled ? "전송 켜짐" : "전송 꺼짐"}
                                </span>
                            </button>
                        ))
                    )}
                </aside>
                <section className="min-w-0 space-y-6 rounded-xl border p-5">
                    {creating && list.data && canManage ? (
                        <WebhookEditor
                            key={`new:${workspaceId}`}
                            eventTypes={list.data.eventTypes}
                            busy={busy}
                            onSave={save}
                        />
                    ) : endpoint && list.data ? (
                        <>
                            {canManage ? (
                                <WebhookEditor
                                    key={`editor:${endpoint.id}`}
                                    endpoint={endpoint}
                                    eventTypes={list.data.eventTypes}
                                    busy={busy}
                                    onSave={save}
                                />
                            ) : (
                                <h2 className="font-semibold">
                                    {endpoint.name}
                                </h2>
                            )}
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                                <span className="text-muted-foreground">
                                    키 식별값 {endpoint.secretHint}
                                </span>
                                {canManage && (
                                    <>
                                        <button
                                            className="rounded-lg border px-3 py-2 disabled:opacity-40"
                                            disabled={busy || !endpoint.enabled}
                                            onClick={() => void action("test")}
                                        >
                                            가상 이벤트 전송
                                        </button>
                                        <button
                                            className="rounded-lg border px-3 py-2 disabled:opacity-40"
                                            disabled={busy}
                                            onClick={() =>
                                                void action("rotate")
                                            }
                                        >
                                            서명 키 새로 발급
                                        </button>
                                    </>
                                )}
                            </div>
                            <WebhookDeliveries
                                key={`deliveries:${endpoint.id}`}
                                endpoint={endpoint}
                                canManage={canManage}
                            />
                        </>
                    ) : (
                        <p className="py-20 text-center text-sm text-muted-foreground">
                            웹훅을 선택하거나 새로 등록하세요.
                        </p>
                    )}
                </section>
            </div>
        </main>
    );
}
