"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { copyRequest } from "../api/copy";
import { KST_TIME_ZONE } from "@/lib/kst";
import { purposeLabel } from "./Fields";
import { copyNames } from "../utils/names";
import type { CopyCatalog, CopyPurpose, KnowledgeVersion } from "../types";
export default function BindingHistory({
    catalog,
    knowledge,
}: {
    catalog: CopyCatalog;
    knowledge: KnowledgeVersion[];
}) {
    const names = copyNames({
        workspaces: catalog.workspaces,
        rules: catalog.rules,
        policies: catalog.versions,
        knowledge,
    });
    const [cursor, setCursor] = useState(0);
    const { data, error } = useSWR<{
        events: {
            id: number;
            workspace_id: number;
            purpose: CopyPurpose;
            rule_id: number;
            previous_policy_id: number | null;
            previous_knowledge_id: number | null;
            policy_version_id: number;
            knowledge_version_id: number;
            changed_by_name: string | null;
            changed_at: string;
        }[];
        nextCursor: number | null;
    }>(`/api/ai/copy-binding-history?cursor=${cursor}`, copyRequest);
    return (
        <section className="mt-6 space-y-3">
            <h3 className="font-medium">발송 연결 변경 이력</h3>
            {error ? (
                <p role="alert">연결 변경 이력을 불러오지 못했습니다.</p>
            ) : !data ? (
                <p>변경 이력을 불러오는 중입니다.</p>
            ) : !data.events.length ? (
                <p className="text-sm text-muted-foreground">연결 변경 이력이 없습니다.</p>
            ) : (
                <ul className="space-y-2 text-sm">
                    {data.events.map((e) => (
                        <li key={e.id} className="rounded-md border p-3">
                            {names.workspace(e.workspace_id)} · {purposeLabel(e.purpose)}
                            {e.rule_id > 0 && ` · ${names.rule(e.rule_id)}`}
                            <br />
                            작성{" "}
                            {e.previous_policy_id ? names.policy(e.previous_policy_id) : "기존 지침"}{" "}
                            → {names.policy(e.policy_version_id)}
                            <br />
                            지식{" "}
                            {e.previous_knowledge_id
                                ? names.knowledge(e.previous_knowledge_id)
                                : "없음"}{" "}
                            → {names.knowledge(e.knowledge_version_id)}
                            <br />
                            {new Date(e.changed_at).toLocaleString("ko-KR", {
                                timeZone: KST_TIME_ZONE,
                            })}{" "}
                            ·{" "}
                            {e.changed_by_name ?? "자동 처리"} · 이후 새 작업부터 적용
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex gap-2">
                {cursor > 0 && (
                    <Button variant="outline" onClick={() => setCursor(0)}>
                        최근 변경
                    </Button>
                )}
                {data?.nextCursor && (
                    <Button variant="outline" onClick={() => setCursor(data.nextCursor!)}>
                        이전 변경
                    </Button>
                )}
            </div>
        </section>
    );
}
