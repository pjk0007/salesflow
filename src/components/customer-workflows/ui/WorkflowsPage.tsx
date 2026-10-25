"use client";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import type { InboxBootstrap } from "@/components/inbox/types";
import type { RoutingTeam } from "@/components/inbox-routing/types";
import { workflowRequest, workflowWrite } from "../api";
import type { WorkflowList, WorkflowDetail } from "../types";
import { auditLabels } from "../utils/labels";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkflowEditor } from "./WorkflowEditor";
import { WorkflowRuns } from "./WorkflowRuns";
export function WorkflowsPage({ role }: { role: string }) {
    void role;
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
        channelId = bootstrap.data?.channels.find(
            (c) => c.workspaceId === workspaceId,
        )?.id,
        teams = useSWR<RoutingTeam[]>(
            channelId
                ? `/api/inbox-routing/teams?channelId=${channelId}`
                : null,
            workflowRequest,
            { refreshInterval: 15000 },
        ),
        canManage = workspaceAbilities(bootstrap.data, workspaceId).manage;
    const { confirm, confirmationDialog } = useAsyncConfirm(),
        [toggling, setToggling] = useState(false);
    async function refreshed(id: string) {
        setCreating(false);
        setSelected(id);
        await Promise.all([list.mutate(), detail.mutate()]);
    }
    // 중단: 취소될 대기 실행 수와 다시 켜는 방법을 알린 뒤 실행(UX-099)
    function confirmDisable() {
        const current = detail.data;
        if (!current || !selected) return;
        confirm({
            title: "자동화 중단",
            description: `새 이벤트 처리를 멈추고 예약·대기 중인 실행 ${current.activeRuns}건을 모두 취소합니다. 취소한 실행은 다시 켜도 되살아나지 않습니다.\n같은 게시 버전으로 '다시 켜기'를 누르면 새 이벤트부터 다시 처리합니다.`,
            confirmLabel: "중단",
            onConfirm: async () => {
                await workflowWrite(`/api/customer-workflows/${selected}`, {
                    action: "disable",
                    version: current.workflow.version,
                });
                await refreshed(selected);
                toast.success("자동화와 대기 실행을 중단했습니다.");
            },
        });
    }
    async function enable() {
        const current = detail.data;
        if (!current || !selected || toggling) return;
        setToggling(true);
        try {
            await workflowWrite(`/api/customer-workflows/${selected}`, {
                action: "enable",
                version: current.workflow.version,
            });
            await refreshed(selected);
            toast.success("같은 게시 버전으로 자동화를 다시 켰습니다.");
        } catch (e) {
            toast.error((e as Error).message);
            await detail.mutate();
        } finally {
            setToggling(false);
        }
    }
    const loadingFirst =
        bootstrap.isLoading || (!!workspaceId && list.isLoading);
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
                pipelines.error ||
                teams.error) && (
                <p role="alert" className="text-red-600">
                    {bootstrap.error?.message ||
                        list.error?.message ||
                        detail.error?.message ||
                        pipelines.error?.message ||
                        teams.error?.message}
                    <button
                        className="ml-2 underline"
                        onClick={() => {
                            void bootstrap.mutate();
                            void list.mutate();
                            void detail.mutate();
                            void pipelines.mutate();
                            void teams.mutate();
                        }}
                    >
                        다시 불러오기
                    </button>
                </p>
            )}
            {loadingFirst && (
                <div aria-busy="true" className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        자동화를 불러오는 중…
                    </p>
                    <Skeleton className="h-10 max-w-xs" />
                    <Skeleton className="h-40" />
                </div>
            )}
            {bootstrap.data &&
                !bootstrap.error &&
                !bootstrap.data.workspaces.length && (
                    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">
                            사용할 수 있는 사업이 없습니다.
                        </p>
                        <p className="mt-2">
                            고객 자동화는 사업별로 운영합니다. 조직 관리자에게 사업
                            접근 권한(자동화 편집은 운영 관리)을 요청해주세요.
                        </p>
                    </div>
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
                                {w.enabled && w.publisherCanManage === false && (
                                    <span className="mt-1 block text-xs text-amber-700">
                                        게시자 권한 없음 · 실행 실패
                                    </span>
                                )}
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
                                        members: bootstrap.data.members.filter(
                                            (m) =>
                                                m.workspaceIds.includes(
                                                    workspaceId,
                                                ),
                                        ),
                                        teams: teams.data ?? [],
                                        pipelines: pipelines.data ?? [],
                                        names: list.data.stepNames,
                                    }}
                                    eventTypes={list.data.eventTypes}
                                    canManage={canManage}
                                    onSaved={refreshed}
                                />
                            </div>
                        )}
                        {!creating && selected && !detail.data && !detail.error && (
                            <div aria-busy="true" className="space-y-3 rounded-xl border p-5">
                                <p className="text-sm text-muted-foreground">
                                    자동화를 불러오는 중…
                                </p>
                                <Skeleton className="h-24" />
                            </div>
                        )}
                        {!creating && detail.data && (
                            <>
                                <section className="space-y-3 rounded-xl border p-5">
                                    <h3 className="font-semibold">현재 적용</h3>
                                    <p className="text-sm">
                                        {detail.data.workflow.enabled
                                            ? detail.data.publisher?.canManage === false
                                                ? "게시는 켜져 있지만 새 이벤트를 실행하지 못하고 있습니다."
                                                : "게시한 버전으로 새 이벤트를 처리합니다."
                                            : detail.data.workflow.activeRevisionId
                                              ? "자동화가 중단되어 있습니다. '다시 켜기'로 같은 게시 버전을 새 이벤트부터 다시 적용할 수 있습니다."
                                              : "아직 게시하지 않은 초안입니다. 모의 실행 후 게시해주세요."}
                                    </p>
                                    {detail.data.publisher && (
                                        <p
                                            role={
                                                detail.data.publisher.canManage
                                                    ? undefined
                                                    : "alert"
                                            }
                                            className={`text-xs ${detail.data.publisher.canManage ? "text-muted-foreground" : "rounded-lg bg-amber-50 p-3 text-amber-900"}`}
                                        >
                                            게시한 직원:{" "}
                                            {detail.data.publisher.name ??
                                                "알 수 없음(삭제된 계정)"}
                                            {detail.data.publisher.canManage
                                                ? " · 운영 관리 권한 확인됨 (실행은 게시한 직원 권한으로 처리합니다)"
                                                : " · 지금 이 사업의 운영 관리 권한이 없어 모든 실행이 실패합니다. 운영 관리 권한이 있는 직원이 새 버전으로 저장해 다시 게시하면 그 직원 권한으로 실행됩니다."}
                                        </p>
                                    )}
                                    {detail.data.lastFailure?.reason && (
                                        <p className="text-xs text-red-700">
                                            최근 실패 (
                                            {new Date(
                                                detail.data.lastFailure.updatedAt,
                                            ).toLocaleString("ko-KR")}
                                            ): {detail.data.lastFailure.reason}
                                        </p>
                                    )}
                                    {canManage &&
                                        detail.data.workflow.enabled && (
                                            <button
                                                className="rounded-lg border px-3 py-2 text-sm"
                                                onClick={confirmDisable}
                                            >
                                                자동화·대기 실행 중단
                                            </button>
                                        )}
                                    {canManage &&
                                        !detail.data.workflow.enabled &&
                                        detail.data.workflow.activeRevisionId && (
                                            <button
                                                className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
                                                disabled={toggling}
                                                onClick={() => void enable()}
                                            >
                                                {toggling
                                                    ? "켜는 중…"
                                                    : "같은 게시 버전으로 다시 켜기"}
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
                                            · {h.actorName} ·{" "}
                                            {auditLabels[h.action] ?? h.action}
                                        </p>
                                    ))}
                                </details>
                            </>
                        )}
                        {!creating && !selected && (
                            <p className="rounded-xl bg-muted p-6 text-sm text-muted-foreground">
                                {list.data.rows.length
                                    ? "자동화를 선택하거나 새 자동화를 만들어주세요."
                                    : canManage
                                      ? "아직 자동화가 없습니다. '새 자동화'로 첫 자동화를 만들어주세요."
                                      : "아직 자동화가 없습니다. 자동화는 운영 관리 권한이 있는 직원이 만들 수 있습니다."}
                            </p>
                        )}
                    </div>
                </div>
            )}
            {confirmationDialog}
        </main>
    );
}
