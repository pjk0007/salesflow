"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { copyRequest } from "../api/copy";
import type { GenerationRow } from "../types";
import { Field, controlClass, purposeLabel, reasonLabel, stateLabel } from "./Fields";
import ReplacementForm from "./ReplacementForm";
type Action = <T>(url: string, body: unknown) => Promise<T | undefined>;
const origins = [
    { value: "operational", label: "발송 준비" },
    { value: "replacement", label: "선택 재작성" },
    { value: "evaluation", label: "품질 평가" },
    { value: "benchmark", label: "부하 측정" },
    { value: "all", label: "전체" },
];
export function GenerationList({
    workspaces,
    act,
    pending,
}: {
    workspaces: { id: number; name: string }[];
    act: Action;
    pending: boolean;
}) {
    const [workspace, setWorkspace] = useState(0),
        [origin, setOrigin] = useState("operational"),
        [cursor, setCursor] = useState(0),
        [selected, setSelected] = useState<number | null>(null);
    const { data, error, isLoading } = useSWR<{ jobs: GenerationRow[]; nextCursor: number | null }>(
        `/api/ai/generations?workspaceId=${workspace}&origin=${origin}&cursor=${cursor}`,
        copyRequest,
        { refreshInterval: 15000 },
    );
    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="사업 필터">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={workspace}
                            onChange={(e) => {
                                setWorkspace(Number(e.target.value));
                                setCursor(0);
                            }}
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
                <Field label="작업 분류">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={origin}
                            onChange={(e) => {
                                setOrigin(e.target.value);
                                setCursor(0);
                            }}
                        >
                            {origins.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    )}
                </Field>
            </div>
            <p className="text-sm text-muted-foreground">
                첫 메일과 방문 감사 메일의 생성·검증·재시도를 기록합니다. 기존 지침으로 만든 작업은
                승인 버전과 구분합니다. 비용은 실패와 재시도까지 포함합니다.
            </p>
            {isLoading ? (
                <p>생성 기록을 불러오는 중입니다.</p>
            ) : error ? (
                <p role="alert">생성 기록을 불러오지 못했습니다.</p>
            ) : !data?.jobs.length ? (
                <p>아직 생성 기록이 없습니다.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr>
                                {["작업", "메일", "상태", "시도", "버전", "비용", "상세"].map(
                                    (s) => (
                                        <th className="border-b p-3" key={s}>
                                            {s}
                                        </th>
                                    ),
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {data.jobs.map((j) => (
                                <tr key={j.id} className="border-b">
                                    <td className="p-3">
                                        #{j.id}
                                        <div className="text-xs text-muted-foreground">
                                            {new Date(j.created_at).toLocaleString("ko-KR")}
                                        </div>
                                    </td>
                                    <td className="p-3">{purposeLabel(j.purpose)}</td>
                                    <td className="p-3">
                                        {stateLabel(j.state)}
                                        <div className="text-xs text-muted-foreground">
                                            {reasonLabel(j.reason)}
                                        </div>
                                    </td>
                                    <td className="p-3">{j.attempts}회</td>
                                    <td className="p-3">
                                        {j.policy_version_id
                                            ? `작성 #${j.policy_version_id} · 지식 #${j.knowledge_version_id}`
                                            : "기존 지침 계측"}
                                    </td>
                                    <td className="p-3">
                                        {j.cost_known && j.cost_krw !== null
                                            ? `${Number(j.cost_krw).toFixed(3)}원`
                                            : "확인 필요"}
                                    </td>
                                    <td className="p-3">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setSelected(j.id)}
                                        >
                                            보기
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <div className="flex gap-2">
                {cursor > 0 && (
                    <Button variant="outline" onClick={() => setCursor(0)}>
                        최근 기록
                    </Button>
                )}
                {data?.nextCursor && (
                    <Button variant="outline" onClick={() => setCursor(data.nextCursor!)}>
                        이전 기록
                    </Button>
                )}
            </div>
            {selected && (
                <GenerationDetail
                    key={selected}
                    id={selected}
                    act={act}
                    pending={pending}
                    onSelect={setSelected}
                />
            )}
        </div>
    );
}
function GenerationDetail({
    id,
    act,
    pending,
    onSelect,
}: {
    id: number;
    act: Action;
    pending: boolean;
    onSelect: (id: number) => void;
}) {
    const [replacing, setReplacing] = useState(false);
    const { data, error } = useSWR<{
        job: GenerationRow & {
            output: { subject: string; htmlBody: string } | null;
            eligible_at: string;
            ready_at: string | null;
            policy_snapshot: { model: string; validatorVersion: string };
            assignment_id: number | null;
            superseded_by_id: number | null;
        };
        attempts: {
            id: number;
            result: string;
            reason: string | null;
            duration_ms: number | null;
            prompt_tokens: number | null;
            completion_tokens: number | null;
            cost_krw: string | null;
            late_usage_known: boolean;
        }[];
    }>(`/api/ai/generations/${id}`, copyRequest, { refreshInterval: 15000 });
    if (error) return <p role="alert">생성 상세를 불러오지 못했습니다.</p>;
    if (!data) return <p>상세를 불러오는 중입니다.</p>;
    const { job, attempts } = data;
    return (
        <section className="space-y-3 rounded-md border p-4">
            <h3 className="font-semibold">
                작업 #{id} · {stateLabel(job.state)}
            </h3>
            <p className="text-sm">
                모델 {job.policy_snapshot.model} · 검사 {job.policy_snapshot.validatorVersion} ·
                실험 배정 {job.assignment_id ?? "없음"} · 발송 기록 {job.send_log_id ?? "없음"}
            </p>
            <p className="text-sm">{reasonLabel(job.reason)}</p>
            {job.superseded_by_id && (
                <Button variant="outline" onClick={() => onSelect(job.superseded_by_id!)}>
                    대체 작업 #{job.superseded_by_id} 보기
                </Button>
            )}
            {job.output && (
                <div className="rounded-md bg-muted p-3">
                    <p className="mb-2 text-sm font-medium">{job.output.subject}</p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                        {job.output.htmlBody}
                    </pre>
                </div>
            )}
            <ul className="space-y-2 text-sm">
                {attempts.map((a, index) => (
                    <li key={a.id} className="rounded-md bg-muted p-3">
                        시도 {index + 1} · {a.result} ·{" "}
                        {a.duration_ms === null
                            ? "진행 중"
                            : `${(a.duration_ms / 1000).toFixed(1)}초`}{" "}
                        · {reasonLabel(a.reason)}
                        <br />
                        사용량 입력 {a.prompt_tokens ?? "확인 필요"} / 출력{" "}
                        {a.completion_tokens ?? "확인 필요"} 토큰 · 비용{" "}
                        {a.cost_krw === null ? "확인 필요" : `${Number(a.cost_krw).toFixed(3)}원`}
                        {a.late_usage_known && " · 늦은 응답의 사용량 포함, 본문 채택 안 함"}
                    </li>
                ))}
            </ul>
            {!job.send_log_id && job.state !== "cancelled" && (
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => void act(`/api/ai/generations/${id}`, { action: "cancel" })}
                    >
                        이 작업 취소
                    </Button>
                    {job.state === "held" &&
                        job.reason === "token_quota" &&
                        job.origin !== "benchmark" && (
                            <Button
                                disabled={pending}
                                onClick={() =>
                                    void act(`/api/ai/generations/${id}`, { action: "resume" })
                                }
                            >
                                한도 확인 후 재개
                            </Button>
                        )}
                    {!job.assignment_id &&
                        ["operational", "replacement"].includes(job.origin) &&
                        ["held", "ready"].includes(job.state) && (
                            <Button variant="outline" onClick={() => setReplacing((v) => !v)}>
                                새 승인 버전으로 재작성
                            </Button>
                        )}
                </div>
            )}
            {job.assignment_id && (
                <p className="text-sm text-muted-foreground">
                    실험의 고정 버전은 이 화면에서 바꾸지 않습니다. 문제가 있으면 실험을 무효화하고
                    새 실험에서 검토합니다.
                </p>
            )}
            {replacing && (
                <ReplacementForm job={job} pending={pending} act={act} onCreated={onSelect} />
            )}
        </section>
    );
}
