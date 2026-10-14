"use client";
import { useState } from "react";
import useSWR from "swr";
import { useSession } from "@/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { useCopyManager } from "@/components/ai-copy/hooks/useCopyManager";
import { copyRequest } from "@/components/ai-copy/api/copy";
import type { Experiment } from "../types";
import ExperimentForm from "./ExperimentForm";
import ExperimentDetail, { experimentStateLabel } from "./ExperimentDetail";
import AutomaticObservations from "@/components/ai-copy/ui/AutomaticObservations";
export default function ExperimentManager({ initialRuleId }: { initialRuleId?: number }) {
    const { user, isLoading } = useSession();
    const enabled = !!user && user.role !== "member",
        manager = useCopyManager(enabled);
    const [cursor, setCursor] = useState(0),
        [activeTab, setActiveTab] = useState("observations"),
        [selected, setSelected] = useState<number | null>(null),
        [creating, setCreating] = useState(false);
    const list = useSWR<{
        experiments: Experiment[];
        nextCursor: number | null;
        members: { id: string; name: string }[];
    }>(enabled ? `/api/email/experiments?cursor=${cursor}` : null, copyRequest, {
        refreshInterval: 15000,
    });
    if (isLoading || !user) return <p>권한을 확인하는 중입니다.</p>;
    if (!enabled) return <p>문구 실험은 관리자가 사용할 수 있습니다.</p>;
    if (manager.loading || list.isLoading) return <p>실험 정보를 불러오는 중입니다.</p>;
    if (manager.error || list.error || !manager.catalog || !manager.knowledge || !list.data)
        return <p role="alert">문구 실험 정보를 불러오지 못했습니다.</p>;
    const { catalog, knowledge, act, pending } = manager;
    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold">첫 메일 문구 실험</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        평소 첫 메일의 발송과 사람 회신을 자동으로 모읍니다. 지침의 효과를 비교할
                        때는 실험과 결과에서 표본·관찰·데이터 품질 기준을 확인합니다.
                    </p>
                </div>
                <Button onClick={() => setCreating(true)}>새 실험</Button>
            </div>
            {initialRuleId && (
                <p className="text-sm text-muted-foreground">
                    규칙 #{initialRuleId}에서 들어왔습니다. 새 실험을 만들 때 이 규칙이 선택됩니다.
                </p>
            )}
            {manager.actionError && (
                <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm">
                    {manager.actionError}
                </p>
            )}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="observations">자동 관찰</TabsTrigger>
                    <TabsTrigger value="experiments">실험과 결과</TabsTrigger>
                </TabsList>
                <TabsContent value="observations" className="pt-3">
                    <AutomaticObservations
                        workspaces={catalog.workspaces}
                        mode="outcomes"
                        onOpenExperiment={(id) => {
                            setSelected(id);
                            setActiveTab("experiments");
                        }}
                    />
                </TabsContent>
                <TabsContent value="experiments" className="space-y-5 pt-3">
                    {!list.data.experiments.length ? (
                        <div className="rounded-md border p-5">
                            <p>아직 만든 실험이 없습니다.</p>
                            <p className="mt-2 text-sm text-muted-foreground">
                                먼저 AI 품질 화면에서 두 작성 지침을 평가·승인하고 A 지침을 해당
                                규칙에 연결해 주세요.
                            </p>
                            <a
                                href="/email?tab=ai-quality"
                                className="mt-3 inline-block text-sm underline"
                            >
                                AI 품질 관리 열기
                            </a>
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {list.data.experiments.map((e) => (
                                <button
                                    key={e.id}
                                    type="button"
                                    onClick={() => setSelected(e.id)}
                                    className={`space-y-2 rounded-md border p-4 text-left ${selected === e.id ? "border-primary bg-muted" : "hover:bg-muted/50"}`}
                                >
                                    <p className="font-medium">
                                        {e.name} · #{e.id}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {
                                            catalog.workspaces.find((w) => w.id === e.workspace_id)
                                                ?.name
                                        }{" "}
                                        · 규칙 #{e.rule_id}
                                    </p>
                                    <Badge variant="secondary">
                                        {experimentStateLabel(e.state)}
                                    </Badge>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2">
                        {cursor > 0 && (
                            <Button variant="outline" onClick={() => setCursor(0)}>
                                최근 실험
                            </Button>
                        )}
                        {list.data.nextCursor && (
                            <Button
                                variant="outline"
                                onClick={() => setCursor(list.data!.nextCursor!)}
                            >
                                이전 실험
                            </Button>
                        )}
                    </div>
                    {selected && (
                        <ExperimentDetail
                            key={selected}
                            id={selected}
                            act={act}
                            pending={pending}
                        />
                    )}
                </TabsContent>
            </Tabs>
            <Dialog open={creating} onOpenChange={setCreating}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>첫 메일 문구 실험 초안</DialogTitle>
                        <DialogDescription>
                            모델과 제품 지식, 제목, 발송 조건은 공통으로 고정합니다. 초안을 저장한
                            뒤 대상과 수집 기간을 확인하고 시작합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <ExperimentForm
                        catalog={catalog}
                        knowledge={knowledge.versions}
                        members={list.data.members}
                        initialRuleId={initialRuleId}
                        pending={pending}
                        onSave={async (value) => {
                            const e = await act<Experiment>("/api/email/experiments", value);
                            if (e) {
                                setCreating(false);
                                setSelected(e.id);
                            }
                        }}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
}
