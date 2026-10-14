"use client";
import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import type { InboxBootstrap } from "@/components/inbox/types";
import { workflowRequest, workflowWrite } from "../api";
import type { WorkflowList, WorkflowDetail } from "../types";
import { WorkflowEditor } from "./WorkflowEditor";
import { WorkflowRuns } from "./WorkflowRuns";
export function WorkflowsPage({ role }: { role: string }) {
    const params = useSearchParams(),
        router = useRouter(),
        pathname = usePathname(),
        [chosen, setChosen] = useState<number | null>(
            Number(params.get("workspaceId")) || null,
        ),
        [selected, setSelected] = useState<string | null>(null),
        [creating, setCreating] = useState(false),
        [before, setBefore] = useState<string | null>(null),
        bootstrap = useSWR<InboxBootstrap>("/api/inbox", workflowRequest),
        workspaceId = chosen ?? bootstrap.data?.workspaces[0]?.id ?? null,
        list = useSWR<WorkflowList>(
            workspaceId
                ? `/api/customer-workflows?workspaceId=${workspaceId}${before ? `&before=${before}` : ""}`
                : null,
            workflowRequest,
            { refreshInterval: 5000 },
        ),
        detail = useSWR<WorkflowDetail>(
            selected ? `/api/customer-workflows/${selected}` : null,
            workflowRequest,
        ),
        pipelines = useSWR<
            {
                id: string;
                name: string;
                stages: { id: string; name: string }[];
            }[]
        >(
            workspaceId
                ? `/api/customer-crm/pipelines?workspaceId=${workspaceId}`
                : null,
            workflowRequest,
        ),
        canManage = role !== "member";
    async function refreshed(id: string) {
        setCreating(false);
        setSelected(id);
        await Promise.all([list.mutate(), detail.mutate()]);
    }
    return (
        <main className="space-y-6 p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">고객 자동화</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        고객 행동과 상담·영업 변화를 같은 고객 흐름으로
                        이어갑니다. 모의 실행을 확인한 뒤 사람이 게시합니다.
                    </p>
                </div>
                <label className="text-sm">
                    사업
                    <select
                        aria-label="고객 자동화 사업"
                        className="ml-3 rounded-lg border p-2"
                        value={workspaceId ?? ""}
                        onChange={(e) => {
                            setChosen(Number(e.target.value));
                            setSelected(null);
                            setCreating(false);
                            setBefore(null);
                            router.replace(
                                `${pathname}?workspaceId=${e.target.value}`,
                                { scroll: false },
                            );
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
            {(bootstrap.error ||
                list.error ||
                detail.error ||
                pipelines.error) && (
                <p role="alert" className="text-red-600">
                    {bootstrap.error?.message ||
                        list.error?.message ||
                        detail.error?.message ||
                        pipelines.error?.message}
                    <button
                        className="ml-2 underline"
                        onClick={() => {
                            void bootstrap.mutate();
                            void list.mutate();
                            void detail.mutate();
                            void pipelines.mutate();
                        }}
                    >
                        다시 불러오기
                    </button>
                </p>
            )}
            {list.data && !list.data.workerEnabled && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                    자동화 워커가 꺼져 있습니다. 모의 실행과 게시는 가능하며
                    실제 단계 처리는 서버에서 워커를 켠 뒤 시작합니다.
                </p>
            )}
            {list.data && workspaceId && bootstrap.data && (
                <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
                    <aside className="space-y-3">
                        {canManage && (
                            <button
                                onClick={() => {
                                    setCreating(true);
                                    setSelected(null);
                                }}
                                className="w-full rounded-lg bg-[#635BFF] px-4 py-2 text-sm text-white"
                            >
                                새 자동화
                            </button>
                        )}
                        {list.data.rows.map((w) => (
                            <button
                                key={w.id}
                                className={`w-full rounded-xl border p-4 text-left ${selected === w.id ? "border-[#635BFF]" : ""}`}
                                onClick={() => {
                                    setCreating(false);
                                    setSelected(w.id);
                                }}
                            >
                                <strong className="block text-sm">
                                    {w.name}
                                </strong>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                    {w.enabled ? "게시·활성" : "중단 또는 초안"}{" "}
                                    · 설정 {w.version}
                                </span>
                            </button>
                        ))}
                        {before && (
                            <button
                                onClick={() => setBefore(null)}
                                className="text-xs underline"
                            >
                                최신 목록
                            </button>
                        )}
                        {list.data.hasMore && (
                            <button
                                onClick={() =>
                                    setBefore(list.data!.rows.at(-1)!.id)
                                }
                                className="text-xs underline"
                            >
                                이전 자동화
                            </button>
                        )}
                    </aside>
                    <div className="min-w-0 space-y-6">
                        {(creating || detail.data) && (
                            <div className="rounded-xl border p-5">
                                <WorkflowEditor
                                    key={
                                        creating
                                            ? `new:${workspaceId}`
                                            : selected
                                    }
                                    workspaceId={workspaceId}
                                    detail={creating ? undefined : detail.data}
                                    options={{
                                        members: bootstrap.data.members,
                                        pipelines: pipelines.data ?? [],
                                        names: list.data.stepNames,
                                    }}
                                    eventTypes={list.data.eventTypes}
                                    canManage={canManage}
                                    onSaved={refreshed}
                                />
                            </div>
                        )}
                        {!creating && detail.data && (
                            <>
                                <section className="space-y-3 rounded-xl border p-5">
                                    <h3 className="font-semibold">현재 적용</h3>
                                    <p className="text-sm">
                                        {detail.data.workflow.enabled
                                            ? "게시한 버전으로 새 이벤트를 처리합니다."
                                            : "자동화가 중단되어 있습니다."}
                                    </p>
                                    {canManage &&
                                        detail.data.workflow.enabled && (
                                            <button
                                                className="rounded-lg border px-3 py-2 text-sm"
                                                onClick={async () => {
                                                    try {
                                                        await workflowWrite(
                                                            `/api/customer-workflows/${selected}`,
                                                            {
                                                                action: "disable",
                                                                version:
                                                                    detail.data!
                                                                        .workflow
                                                                        .version,
                                                            },
                                                        );
                                                        await refreshed(
                                                            selected!,
                                                        );
                                                        toast.success(
                                                            "자동화와 대기 실행을 중단했습니다.",
                                                        );
                                                    } catch (e) {
                                                        toast.error(
                                                            (e as Error)
                                                                .message,
                                                        );
                                                        await detail.mutate();
                                                    }
                                                }}
                                            >
                                                자동화·대기 실행 중단
                                            </button>
                                        )}
                                </section>
                                <div className="rounded-xl border p-5">
                                    <WorkflowRuns
                                        key={selected}
                                        id={selected!}
                                        workspaceId={workspaceId}
                                        canManage={canManage}
                                    />
                                </div>
                                <details className="rounded-xl border p-5 text-xs">
                                    <summary className="cursor-pointer">
                                        설정 감사 · 최근 100개
                                    </summary>
                                    {detail.data.history.map((h) => (
                                        <p key={h.id} className="mt-3">
                                            {new Date(
                                                h.createdAt,
                                            ).toLocaleString("ko-KR")}{" "}
                                            · {h.actorName} · {h.action}
                                        </p>
                                    ))}
                                </details>
                            </>
                        )}
                        {!creating && !selected && (
                            <p className="rounded-xl bg-muted p-6 text-sm text-muted-foreground">
                                자동화를 선택하거나 새 자동화를 만들어주세요.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}
