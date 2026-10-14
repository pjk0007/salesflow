"use client";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { supportRequest, supportWrite } from "../api";
import type { SupportCatalog, SupportSettings } from "../types";
import type { InboxBootstrap } from "@/components/inbox/types";
import { KnowledgeManager } from "./KnowledgeManager";
import { SupportSettingsForm } from "./SupportSettingsForm";
export function CustomerAiPage({ role }: { role: string }) {
    void role;
    const params = useSearchParams(),
        router = useRouter(),
        pathname = usePathname(),
        [chosen, setChosen] = useState<number | null>(
            Number(params.get("workspaceId")) || null,
        ),
        bootstrap = useSWR<InboxBootstrap>("/api/inbox", supportRequest),
        workspaceId = chosen ?? bootstrap.data?.workspaces[0]?.id ?? null,
        catalog = useSWR<SupportCatalog>(
            workspaceId
                ? `/api/customer-ai/settings?workspaceId=${workspaceId}`
                : null,
            supportRequest,
        );
    const canManage = workspaceAbilities(bootstrap.data, workspaceId).manage;
    return (
        <main className="space-y-6 p-6">
            <header className="flex flex-wrap justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">
                        상담 AI와 승인 지식
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        메일과 상담의 지식을 함께 관리하고, 자동 응대는 사람이
                        적용합니다.
                    </p>
                </div>
                <label className="text-sm">
                    사업
                    <select
                        aria-label="상담 AI 사업"
                        className="ml-3 rounded-lg border p-2"
                        value={workspaceId ?? ""}
                        onChange={(e) => {
                            setChosen(Number(e.target.value));
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
            {(bootstrap.error || catalog.error) && (
                <p role="alert" className="text-red-600">
                    {bootstrap.error?.message || catalog.error?.message}
                    <button
                        className="ml-2 underline"
                        onClick={() => {
                            void bootstrap.mutate();
                            void catalog.mutate();
                        }}
                    >
                        다시 불러오기
                    </button>
                </p>
            )}
            {catalog.data && !catalog.data.workerEnabled && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                    자동 응대 워커가 꺼져 있습니다. 수동 초안은 지금 생성할 수
                    있고, 자동 초안·답변은 서버 설정을 켜면 새 문의부터
                    처리합니다.
                </p>
            )}
            {workspaceId && catalog.data && bootstrap.data ? (
                <>
                    <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
                        <div className="rounded-xl border p-5">
                            <KnowledgeManager
                                key={`kb:${workspaceId}`}
                                workspaceId={workspaceId}
                                name={
                                    bootstrap.data.workspaces.find(
                                        (w) => w.id === workspaceId,
                                    )?.name ?? ""
                                }
                                canManage={canManage}
                                onChanged={() => catalog.mutate()}
                            />
                        </div>
                        <div className="rounded-xl border p-5">
                            <SupportSettingsForm
                                key={`settings:${workspaceId}`}
                                catalog={catalog.data}
                                members={bootstrap.data.members}
                                canManage={canManage}
                                onSave={async (value) => {
                                    try {
                                        const saved =
                                            await supportWrite<SupportSettings>(
                                                "/api/customer-ai/settings",
                                                { workspaceId, ...value },
                                            );
                                        await catalog.mutate();
                                        return saved;
                                    } catch (error) {
                                        await catalog.mutate();
                                        throw error;
                                    }
                                }}
                            />
                        </div>
                    </div>
                    <details className="rounded-xl border p-5 text-xs">
                        <summary className="cursor-pointer font-semibold">
                            AI 설정 변경 이력 · 최근 100개
                        </summary>
                        {catalog.data.history.map((h) => (
                            <p key={h.id} className="mt-3">
                                {new Date(h.createdAt).toLocaleString("ko-KR")}{" "}
                                · {h.actorName} · 설정 v{h.version} ·{" "}
                                {h.snapshot.mode === "reply"
                                    ? "자동 답변"
                                    : h.snapshot.mode === "draft"
                                      ? "자동 초안"
                                      : "수동 초안"}{" "}
                                · 지식 #
                                {h.snapshot.knowledgeVersionId ?? "없음"}
                            </p>
                        ))}
                    </details>
                </>
            ) : (
                <p>AI 상담 정보를 불러오는 중…</p>
            )}
        </main>
    );
}
