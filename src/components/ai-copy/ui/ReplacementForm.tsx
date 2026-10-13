"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { copyRequest } from "../api/copy";
import type { CopyCatalog, KnowledgeVersion, CopyPurpose } from "../types";
import { Field, controlClass } from "./Fields";
export default function ReplacementForm({
    job,
    pending,
    act,
    onCreated,
}: {
    job: { id: number; workspace_id: number; purpose: CopyPurpose };
    pending: boolean;
    act: <T>(url: string, body: unknown) => Promise<T | undefined>;
    onCreated: (id: number) => void;
}) {
    const [requestId] = useState(() => crypto.randomUUID()),
        [policyId, setPolicyId] = useState(0),
        [knowledgeId, setKnowledgeId] = useState(0);
    const policies = useSWR<CopyCatalog>(
        `/api/ai/copy-policies?workspaceId=${job.workspace_id}`,
        copyRequest,
    );
    const knowledge = useSWR<{ versions: KnowledgeVersion[] }>(
        `/api/ai/knowledge-versions?workspaceId=${job.workspace_id}`,
        copyRequest,
    );
    if (policies.error || knowledge.error)
        return <p role="alert">승인 버전을 불러오지 못했습니다.</p>;
    if (!policies.data || !knowledge.data) return <p>승인 버전을 불러오는 중입니다.</p>;
    return (
        <form
            className="space-y-3 rounded-md border p-4"
            onSubmit={async (e) => {
                e.preventDefault();
                const result = await act<{ replacementJobId: number }>(
                    `/api/ai/generations/${job.id}`,
                    {
                        action: "regenerate",
                        requestId,
                        policyVersionId: policyId,
                        knowledgeVersionId: knowledgeId,
                    },
                );
                if (result) onCreated(result.replacementJobId);
            }}
        >
            <p className="text-sm text-muted-foreground">
                이 미발송 작업만 새 버전으로 작성합니다. 원본 본문은 이력에 보존하고, 새 문구가
                완성되면 기존 예약에서 다시 준비합니다. 새 AI 호출의 사용량이 차감됩니다.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label="새 승인 작성 지침">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            required
                            value={policyId || ""}
                            onChange={(e) => setPolicyId(Number(e.target.value))}
                        >
                            <option value="">선택</option>
                            {policies
                                .data!.versions.filter(
                                    (p) => p.purpose === job.purpose && p.state === "approved",
                                )
                                .map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} · #{p.id}
                                    </option>
                                ))}
                        </select>
                    )}
                </Field>
                <Field label="새 승인 지식">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            required
                            value={knowledgeId || ""}
                            onChange={(e) => setKnowledgeId(Number(e.target.value))}
                        >
                            <option value="">선택</option>
                            {knowledge
                                .data!.versions.filter((k) => k.state === "approved")
                                .map((k) => (
                                    <option key={k.id} value={k.id}>
                                        {k.name} · #{k.id}
                                    </option>
                                ))}
                        </select>
                    )}
                </Field>
            </div>
            <Button disabled={pending} type="submit">
                선택한 작업 재작성
            </Button>
        </form>
    );
}
