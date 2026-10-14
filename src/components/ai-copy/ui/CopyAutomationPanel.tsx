"use client";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { copyRequest } from "../api/copy";
import { controlClass, Field, purposeLabel } from "./Fields";
import type { PolicySnapshot } from "../types";

interface Cycle {
    id: number;
    setting_id: number;
    purpose: "initial_email" | "visit_ack";
    rule_id: number;
    stage: string;
    cursor: number;
    reason: string | null;
    experiment_id: number | null;
    baseline_policy_id: number;
    candidate_policy_id: number | null;
    baseline_snapshot: PolicySnapshot;
    candidate_snapshot: PolicySnapshot | null;
    sample_outputs?: { arm: string; output: { subject: string; htmlBody: string } | null }[];
    report: {
        passed?: boolean;
        humanReview?: boolean;
        controlledLoad?: boolean;
        blocks?: string[];
        means?: {
            A: { naturalness: number; factuality: number; purposeFit: number };
            B: { naturalness: number; factuality: number; purposeFit: number };
        };
        p95Ms?: number;
        p99Ms?: number;
        diversity?: { duplicateRate: number | null; questionShare: number | null };
    } | null;
}
interface Setting {
    id: number;
    enabled: boolean;
    experiment_mode: "auto" | "manual";
    rule_name: string | null;
    purpose: string;
    rule_id: number;
    last_error: string | null;
}
const stages: Record<string, string> = {
    candidate: "후보 작성 중",
    generating: "가상 문구 생성·검증 중",
    reviewing: "AI 문구 검토 중",
    ready_for_experiment: "실험 준비 완료",
    experimenting: "실험·관찰 진행 중",
    awaiting_application: "사람의 적용 대기",
    applied: "관리자 적용 완료",
    declined: "기존 지침 유지",
    blocked: "준비 보류",
};

export default function CopyAutomationPanel({
    workspaces,
    firstOnly = false,
    onOpenExperiment,
}: {
    workspaces: { id: number; name: string }[];
    firstOnly?: boolean;
    onOpenExperiment?: (id: number) => void;
}) {
    const [workspace, setWorkspace] = useState(workspaces[0]?.id ?? 0),
        [mode, setMode] = useState<"auto" | "manual" | null>(null),
        [busy, setBusy] = useState(false),
        [review, setReview] = useState<Cycle | null>(null);
    const { mutate } = useSWRConfig();
    const { data, error, isLoading } = useSWR<{
        settings: Setting[];
        cycles: Cycle[];
        finalApplication: "manual";
        dailyCalls: number;
    }>(workspace ? `/api/ai/copy-automation?workspaceId=${workspace}` : null, copyRequest, {
        refreshInterval: 15000,
    });
    const enabled = data?.settings.some((s) => s.enabled) ?? false;
    const experimentMode = mode ?? data?.settings[0]?.experiment_mode ?? "auto";
    async function act(body: unknown) {
        setBusy(true);
        try {
            const result = await copyRequest<{ experimentId?: number }>(
                "/api/ai/copy-automation",
                body,
            );
            await mutate(
                (key) =>
                    typeof key === "string" &&
                    (key.startsWith("/api/ai/") || key.startsWith("/api/email/experiments")),
            );
            toast.success("저장했습니다.");
            if (result.experimentId) onOpenExperiment?.(result.experimentId);
            return true;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "처리하지 못했습니다.");
            return false;
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="space-y-4 rounded-md border p-5">
            <div className="flex flex-wrap gap-2 items-center">
                <h3 className="font-semibold">자동 후보 준비와 실험</h3>
                <Badge variant="secondary">최종 적용은 사람</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
                후보 지침 작성 → 가상 문구 생성·검증 → AI 검토 → 실험·관찰까지 준비합니다. 좋은
                결과가 나와도 발송 지침은 자동으로 바뀌지 않습니다.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="자동 준비 사업">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={workspace}
                            onChange={(e) => {
                                setWorkspace(Number(e.target.value));
                                setMode(null);
                            }}
                        >
                            {workspaces.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.name}
                                </option>
                            ))}
                        </select>
                    )}
                </Field>
                <Field label="첫 메일 실험 진행 방식">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={experimentMode}
                            onChange={(e) => setMode(e.target.value as "auto" | "manual")}
                        >
                            <option value="auto">자동으로 개설·시작</option>
                            <option value="manual">사람이 직접 개설·시작</option>
                        </select>
                    )}
                </Field>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button
                    disabled={busy || !workspace || isLoading || !!error}
                    onClick={() =>
                        void act({
                            action: "configure",
                            workspaceId: workspace,
                            enabled: true,
                            experimentMode,
                        })
                    }
                >
                    {enabled ? "설정 저장" : "이 사업 자동 준비 켜기"}
                </Button>
                {enabled && (
                    <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                            void act({
                                action: "configure",
                                workspaceId: workspace,
                                enabled: false,
                                experimentMode,
                            })
                        }
                    >
                        자동 준비 끄기
                    </Button>
                )}
                <a href="/email?tab=experiments" className="text-sm underline self-center">
                    직접 실험 만들기
                </a>
            </div>
            <p className="text-xs text-muted-foreground">
                {enabled ? "자동 준비 사용 중" : "자동 준비 꺼짐"} · 같은 사업의 첫 메일 규칙과 방문
                감사 메일에 적용합니다. 방문 감사 메일은 AI 검토 후 적용 대기로 남습니다. AI 검토는
                사람 검수·통제 부하 시험과 구분합니다. 사용량 한도에 도달하면 다음 회차로 미룹니다.
            </p>
            {error ? (
                <p role="alert">자동 준비 정보를 불러오지 못했습니다.</p>
            ) : isLoading ? (
                <p>자동 준비 상태를 불러오는 중입니다.</p>
            ) : (
                data && (
                    <div className="space-y-3">
                        {data.cycles
                            .filter((c) => !firstOnly || c.purpose === "initial_email")
                            .map((c) => (
                                <article className="rounded border p-4 space-y-2" key={c.id}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <strong>
                                            {purposeLabel(c.purpose)}
                                            {c.rule_id ? ` · 규칙 #${c.rule_id}` : ""}
                                        </strong>
                                        <Badge
                                            variant={
                                                c.stage === "awaiting_application"
                                                    ? "default"
                                                    : "secondary"
                                            }
                                        >
                                            {stages[c.stage] ?? c.stage}
                                        </Badge>
                                    </div>
                                    {c.stage === "generating" && (
                                        <p className="text-sm">가상 문구 {c.cursor}/80건</p>
                                    )}
                                    {c.stage === "reviewing" && (
                                        <p className="text-sm">AI 검토 {c.cursor}/40회</p>
                                    )}
                                    {c.reason && (
                                        <p className="text-sm text-muted-foreground">{c.reason}</p>
                                    )}
                                    {c.candidate_snapshot && (
                                        <details className="text-sm">
                                            <summary className="cursor-pointer">
                                                기존 지침과 후보 비교
                                            </summary>
                                            <div className="grid gap-4 mt-3 sm:grid-cols-2">
                                                <div>
                                                    <strong>A · 기존 지침</strong>
                                                    <p className="whitespace-pre-wrap mt-2">
                                                        {c.baseline_snapshot.instructions}
                                                    </p>
                                                </div>
                                                <div>
                                                    <strong>B · 후보 지침</strong>
                                                    <p className="whitespace-pre-wrap mt-2">
                                                        {c.candidate_snapshot.instructions}
                                                    </p>
                                                </div>
                                            </div>
                                        </details>
                                    )}
                                    {c.report && (
                                        <details className="text-sm">
                                            <summary className="cursor-pointer">
                                                자동 평가 근거와 예시 보기
                                            </summary>
                                            <QualityEvidence cycle={c} />
                                            <p className="text-xs text-muted-foreground">
                                                자동 평가 {c.report.passed ? "통과" : "보류"} · 실제
                                                모델 호출 결과로 판단 · 사람 검수와 통제 부하 시험을
                                                통과했다는 뜻은 아닙니다.
                                            </p>
                                        </details>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        {c.stage === "awaiting_application" && (
                                            <Button disabled={busy} onClick={() => setReview(c)}>
                                                결과 검토 후 적용
                                            </Button>
                                        )}
                                        {c.stage === "ready_for_experiment" &&
                                            experimentMode === "manual" &&
                                            !c.experiment_id && (
                                                <Button
                                                    variant="outline"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        void act({
                                                            action: "draft_experiment",
                                                            cycleId: c.id,
                                                        })
                                                    }
                                                >
                                                    실험 초안 만들기
                                                </Button>
                                            )}
                                        {c.experiment_id &&
                                            (onOpenExperiment ? (
                                                <Button
                                                    variant="outline"
                                                    onClick={() =>
                                                        onOpenExperiment(c.experiment_id!)
                                                    }
                                                >
                                                    실험 #{c.experiment_id} 열기
                                                </Button>
                                            ) : (
                                                <a
                                                    className="text-sm underline self-center"
                                                    href="/email?tab=experiments"
                                                >
                                                    실험 #{c.experiment_id} 확인
                                                </a>
                                            ))}
                                        {!["applied", "declined", "blocked"].includes(c.stage) && (
                                            <Button
                                                variant="ghost"
                                                disabled={busy}
                                                onClick={() =>
                                                    void act({ action: "decline", cycleId: c.id })
                                                }
                                            >
                                                기존 지침 유지하고 종료
                                            </Button>
                                        )}
                                    </div>
                                </article>
                            ))}
                    </div>
                )
            )}
            <Dialog
                open={!!review}
                onOpenChange={(open) => {
                    if (!open) setReview(null);
                }}
            >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>새 발송 지침을 적용할까요?</DialogTitle>
                        <DialogDescription>
                            아래 후보를 검토한 뒤 직접 적용해 주세요. 이후 새로 준비하는 메일에만
                            사용하며, 이미 준비된 본문과 진행 중인 다른 실험은 보존합니다.
                        </DialogDescription>
                    </DialogHeader>
                    {review && (
                        <div className="space-y-3 text-sm">
                            <p>
                                작성 지침 #{review.baseline_policy_id} → #
                                {review.candidate_policy_id}
                            </p>
                            <div className="rounded bg-muted p-4 whitespace-pre-wrap">
                                {review.candidate_snapshot?.instructions}
                            </div>
                            <QualityEvidence cycle={review} />
                            <p>
                                자동 검토 결과와 실험 기준을 다시 확인하고 적용합니다. 기준이
                                달라졌다면 적용을 보류합니다.
                            </p>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReview(null)}>
                            돌아가기
                        </Button>
                        <Button
                            disabled={busy}
                            onClick={async () => {
                                if (review && (await act({ action: "apply", cycleId: review.id })))
                                    setReview(null);
                            }}
                        >
                            검토했고 새 작업부터 적용
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </section>
    );
}

function QualityEvidence({ cycle }: { cycle: Cycle }) {
    const report = cycle.report;
    return (
        <div className="space-y-3 my-3">
            {report?.means && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead>
                            <tr>
                                <th>AI 검토 (5점 만점)</th>
                                <th>A 기존</th>
                                <th>B 후보</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(
                                [
                                    ["naturalness", "자연스러움"],
                                    ["factuality", "사실 근거"],
                                    ["purposeFit", "목적 적합성"],
                                ] as const
                            ).map(([key, label]) => (
                                <tr key={key}>
                                    <td>{label}</td>
                                    <td>{report.means!.A[key].toFixed(2)}</td>
                                    <td>{report.means!.B[key].toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {report?.p95Ms !== undefined && (
                <p>
                    후보 생성 p95 {(report.p95Ms / 1000).toFixed(1)}초 · p99{" "}
                    {((report.p99Ms ?? 0) / 1000).toFixed(1)}초 (소표본 참고값)
                </p>
            )}
            {report?.blocks?.length ? <p role="alert">{report.blocks.join(" / ")}</p> : null}
            <p className="text-xs text-muted-foreground">
                가상 문구 80건과 AI 검토 40회 기준입니다. 사람 검수와 통제 부하 시험은 별도입니다.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                {cycle.sample_outputs?.map(
                    (s, i) =>
                        s.output && (
                            <div className="rounded border p-3" key={i}>
                                <strong>
                                    {s.arm === "A" ? "A 기존" : "B 후보"} · 가상 문구 예시
                                </strong>
                                <p className="mt-2 font-medium">{s.output.subject}</p>
                                <p className="whitespace-pre-wrap mt-2">
                                    {s.output.htmlBody.replace(/<[^>]*>/g, "\n").trim()}
                                </p>
                            </div>
                        ),
                )}
            </div>
        </div>
    );
}
