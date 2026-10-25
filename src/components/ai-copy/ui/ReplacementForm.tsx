"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CopyPurpose } from "../types";
import { Field } from "./Fields";
import { VersionSelect } from "./VersionSelect";
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
                        <VersionSelect
                            id={id}
                            kind="policy"
                            workspaceId={job.workspace_id}
                            purpose={job.purpose}
                            state="approved"
                            value={policyId}
                            onChange={setPolicyId}
                        />
                    )}
                </Field>
                <Field label="새 승인 지식">
                    {(id) => (
                        <VersionSelect
                            id={id}
                            kind="knowledge"
                            workspaceId={job.workspace_id}
                            state="approved"
                            value={knowledgeId}
                            onChange={setKnowledgeId}
                        />
                    )}
                </Field>
            </div>
            <Button disabled={pending} type="submit">
                선택한 작업 재작성
            </Button>
        </form>
    );
}
