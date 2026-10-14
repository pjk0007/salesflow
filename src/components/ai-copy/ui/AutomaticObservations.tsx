"use client";
import { useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { copyRequest } from "../api/copy";
import type { CopyObservations } from "@/lib/ai-copy/observations";
import { Field, controlClass, purposeLabel } from "./Fields";
import CopyAutomationPanel from "./CopyAutomationPanel";

const percent = (value: number | null) =>
    value === null ? "관찰 중" : `${(value * 100).toFixed(1)}%`;
const seconds = (value: number | null) =>
    value === null ? "측정 없음" : `${(value / 1000).toFixed(1)}초`;

export default function AutomaticObservations({
    workspaces,
    mode,
    onOpenExperiment,
}: {
    workspaces: { id: number; name: string }[];
    mode: "quality" | "outcomes";
    onOpenExperiment?: (id: number) => void;
}) {
    const [workspace, setWorkspace] = useState(0);
    const { data, error, isLoading } = useSWR<CopyObservations>(
        `/api/ai/copy-observations?workspaceId=${workspace}&days=30`,
        copyRequest,
        { refreshInterval: 30000 },
    );
    return (
        <div className="space-y-5">
            <CopyAutomationPanel
                workspaces={workspaces}
                firstOnly={mode === "outcomes"}
                onOpenExperiment={onOpenExperiment}
            />
            <div className="rounded-md border bg-muted/30 p-5 space-y-2">
                <div className="flex gap-2 items-center">
                    <h3 className="font-semibold">
                        {mode === "quality"
                            ? "평소 발송 품질 자동 관찰"
                            : "평소 첫 메일 성과 자동 관찰"}
                    </h3>
                    <Badge variant="secondary">자동 연결</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                    {mode === "quality"
                        ? "평소처럼 AI 자동발송과 방문 감사 메일을 사용하면 기록이 쌓입니다. 별도 실험 생성이나 수동 등록이 필요 없습니다."
                        : "평소처럼 AI 자동발송으로 첫 메일을 보내면 규칙과 지침별 성과가 쌓입니다. 별도 실험 생성이나 수동 등록이 필요 없습니다."}
                </p>
                {mode === "outcomes" && (
                    <p className="text-sm text-muted-foreground">
                        실제 발송 후 14일이 지난 고객의 사람 회신을 비교합니다. 일반 발송 관찰이므로
                        문구의 우열이나 인과 효과를 확정하지 않습니다.
                    </p>
                )}
            </div>
            <div className="max-w-sm">
                <Field label="자동 관찰 사업">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={workspace}
                            onChange={(e) => setWorkspace(Number(e.target.value))}
                        >
                            <option value={0}>전체 사업</option>
                            {workspaces.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.name}
                                </option>
                            ))}
                        </select>
                    )}
                </Field>
            </div>
            {isLoading ? (
                <p>평소 발송 기록을 모으는 중입니다.</p>
            ) : error ? (
                <p role="alert">자동 관찰 기록을 불러오지 못했습니다.</p>
            ) : (
                data && (
                    <>
                        <p className="text-sm text-muted-foreground">
                            최근 {data.days}일 · 관찰 작업 {data.observedJobs.toLocaleString()}건 ·
                            내부 계정 제외 {data.excludedInternal.toLocaleString()}건
                            {data.truncated &&
                                ` · 최신 ${data.limit.toLocaleString()}건 범위의 요약입니다.`}
                        </p>
                        {mode === "quality" ? (
                            <div className="grid gap-4 lg:grid-cols-2">
                                {data.purposes.map((p) => (
                                    <section
                                        className="rounded-md border p-5 space-y-3"
                                        key={p.purpose}
                                    >
                                        <h4 className="font-semibold">{purposeLabel(p.purpose)}</h4>
                                        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
                                            <dt>준비 완료 / 전체 작업</dt>
                                            <dd>
                                                {p.ready} / {p.jobs}
                                            </dd>
                                            <dt>준비 중 / 검토 대기</dt>
                                            <dd>
                                                {p.waiting} / {p.held}
                                            </dd>
                                            <dt>첫 시도 성공률</dt>
                                            <dd>{percent(p.firstAttemptSuccess)}</dd>
                                            <dt>30분 내 준비율</dt>
                                            <dd>{percent(p.readyWithin30Minutes)}</dd>
                                            <dt>준비 소요 p95 / p99</dt>
                                            <dd>
                                                {seconds(p.p95ReadyMs)} / {seconds(p.p99ReadyMs)}
                                            </dd>
                                            <dt>동일 본문 비율</dt>
                                            <dd>{percent(p.diversity.duplicateRate)}</dd>
                                            <dt>가장 많이 쓴 질문 비율</dt>
                                            <dd>{percent(p.diversity.questionShare)}</dd>
                                            <dt>AI 생성 비용</dt>
                                            <dd>
                                                {p.costKrw === null
                                                    ? "단가·사용량 확인 필요"
                                                    : `${p.costKrw.toFixed(3)}원`}
                                            </dd>
                                        </dl>
                                        <p className="text-xs text-muted-foreground">
                                            준비 시간은 대기·재시도를 포함합니다. {p.latencySamples}
                                            건 측정 · 30분 관찰 완료 {p.settledJobs}건. 실제 모델
                                            품질 승인과 통제 부하 측정은 품질 평가에서 확인합니다.
                                        </p>
                                    </section>
                                ))}
                            </div>
                        ) : !data.groups.length ? (
                            <p>
                                평소 첫 메일 발송 기록이 쌓이면 규칙·지침별로 여기에 표시됩니다. A/B
                                배정 중인 메일은 실험과 결과에서 확인합니다.
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr>
                                            {[
                                                "사업 / 발송 규칙",
                                                "사용 지침",
                                                "생성 완료",
                                                "발송 고객",
                                                "14일 관찰 완료",
                                                "사람 회신 고객",
                                                "사람 회신율",
                                            ].map((label) => (
                                                <th className="border-b p-3" key={label}>
                                                    {label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.groups.map((g) => (
                                            <tr
                                                className="border-b"
                                                key={`${g.workspaceId}:${g.ruleId}:${g.policyId}`}
                                            >
                                                <td className="p-3">
                                                    {g.workspaceName}
                                                    <div className="text-xs text-muted-foreground">
                                                        {g.ruleName ??
                                                            (g.ruleId
                                                                ? `규칙 #${g.ruleId}`
                                                                : "일반 발송")}
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    {g.policyName ?? "기존 지침 자동 기록"}
                                                </td>
                                                <td className="p-3">{g.generated}</td>
                                                <td className="p-3">{g.sent}</td>
                                                <td className="p-3">
                                                    {g.matured}
                                                    <div className="text-xs text-muted-foreground">
                                                        관찰 중 {g.awaitingObservation}
                                                    </div>
                                                </td>
                                                <td className="p-3">{g.humanReplies}</td>
                                                <td className="p-3">
                                                    {g.replyConnected
                                                        ? percent(g.humanReplyRate)
                                                        : "회신 수집 확인 필요"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {mode === "outcomes" && (
                            <p className="text-sm text-muted-foreground">
                                내부 계정·자동 응답·반송은 제외하고, 같은 규칙·지침의 동일 고객은 한
                                번 계산합니다. 사람 회신은 수집 연결에서 가져오며, 회신 미연결
                                상태에서는 0건을 무응답으로 판단하지 않습니다. 관심 여부가 확인되지
                                않은 회신을 긍정으로 집계하지 않습니다.
                            </p>
                        )}
                    </>
                )
            )}
        </div>
    );
}
