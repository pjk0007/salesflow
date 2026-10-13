"use client";
import { useState } from "react";
import { useSession } from "@/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { useCopyManager } from "../hooks/useCopyManager";
import type { CopyCatalog, CopyPurpose, KnowledgeVersion, PolicyVersion } from "../types";
import { KnowledgeForm, PolicyForm } from "./VersionForms";
import { EvaluationManager } from "./EvaluationManager";
import { GenerationList } from "./GenerationList";
import { PriceSettings } from "./PriceSettings";
import BindingHistory from "./BindingHistory";
import { controlClass, Field, purposeLabel, stateLabel } from "./Fields";
export default function AiCopyManager() {
    const { user, isLoading } = useSession();
    const manager = useCopyManager(!!user && user.role !== "member");
    const [editKnowledge, setEditKnowledge] = useState<KnowledgeVersion | "new" | null>(null),
        [editPolicy, setEditPolicy] = useState<PolicyVersion | "new" | null>(null);
    const [block, setBlock] = useState<{
            kind: "policy" | "knowledge";
            id: number;
            name: string;
        } | null>(null),
        [reason, setReason] = useState("");
    if (isLoading || !user) return <p>권한을 확인하는 중입니다.</p>;
    if (user.role === "member") return <p>AI 품질 관리는 관리자가 사용할 수 있습니다.</p>;
    if (manager.loading) return <p>AI 품질 관리 정보를 불러오는 중입니다.</p>;
    if (manager.error || !manager.catalog || !manager.knowledge)
        return (
            <p role="alert">AI 품질 관리 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        );
    const { catalog, knowledge, act, pending } = manager;
    const workspaceName = (id: number) =>
        catalog.workspaces.find((w) => w.id === id)?.name ?? `사업 #${id}`;
    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-xl font-semibold">AI 문구와 지식 품질 관리</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    작성 지침마다 고객별 자연스러운 변주를 유지하고, 평가를 통과한 버전을 새 작업에
                    연결합니다. 이미 준비한 본문과 진행 중인 실험의 버전은 보존합니다.
                </p>
            </div>
            {manager.actionError && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm" role="alert">
                    {manager.actionError}
                </p>
            )}
            <Tabs defaultValue="policies">
                <TabsList className="flex h-auto w-fit flex-wrap">
                    <TabsTrigger value="policies">작성 지침</TabsTrigger>
                    <TabsTrigger value="knowledge">지식 근거</TabsTrigger>
                    <TabsTrigger value="evaluation">품질 평가</TabsTrigger>
                    <TabsTrigger value="bindings">발송 연결</TabsTrigger>
                    <TabsTrigger value="generations">생성 기록</TabsTrigger>
                    <TabsTrigger value="prices">비용 설정</TabsTrigger>
                </TabsList>
                <TabsContent value="policies" className="space-y-4 pt-3">
                    <Button onClick={() => setEditPolicy("new")}>새 작성 지침</Button>
                    {!catalog.versions.length && (
                        <p className="text-muted-foreground">
                            등록된 작성 지침이 없습니다. 현재 발송은 기존 지침으로 계속하며 생성
                            기록에 구분해 남깁니다.
                        </p>
                    )}
                    {catalog.versions.map((p) => (
                        <article key={p.id} className="space-y-3 rounded-md border p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-medium">
                                    {p.name} · #{p.id}
                                </h3>
                                <Badge variant="secondary">{stateLabel(p.state)}</Badge>
                                <span className="text-sm text-muted-foreground">
                                    {workspaceName(p.workspace_id)} · {purposeLabel(p.purpose)}
                                </span>
                            </div>
                            <details className="text-sm">
                                <summary className="cursor-pointer">지침과 성능 기준 보기</summary>
                                <div className="mt-3 space-y-2">
                                    <p className="whitespace-pre-wrap">{p.snapshot.instructions}</p>
                                    <p>필수 의미: {p.snapshot.requiredMeanings.join(" · ")}</p>
                                    <p>
                                        금지 표현:{" "}
                                        {p.snapshot.forbiddenPhrases.join(" · ") || "없음"}
                                    </p>
                                    <p>
                                        모델 {p.snapshot.model} · 본문 {p.snapshot.maxCharacters}자
                                        이내 · 95% 생성 {p.snapshot.targets.p95Ms / 1000}초 이내 ·
                                        첫 생성 성공 {p.snapshot.targets.firstAttemptSuccess * 100}%
                                        이상
                                    </p>
                                    {p.snapshot.targets.overrideReason && (
                                        <p>기준 변경 근거: {p.snapshot.targets.overrideReason}</p>
                                    )}
                                </div>
                            </details>
                            <p className="text-xs text-muted-foreground">
                                {p.state_reason ?? "상태 변경"} ·{" "}
                                {p.last_changed_by_name ?? "자동 처리"} ·{" "}
                                {new Date(p.last_changed_at).toLocaleString("ko-KR")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditPolicy(p)}
                                >
                                    복제하여 수정
                                </Button>
                                {!["blocked", "retired"].includes(p.state) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={pending}
                                        onClick={() =>
                                            void act(`/api/ai/copy-policies/${p.id}`, {
                                                action: "retire",
                                            })
                                        }
                                    >
                                        새 연결에서 사용 종료
                                    </Button>
                                )}
                                {p.state === "evaluated" && (
                                    <Button
                                        size="sm"
                                        disabled={pending}
                                        onClick={() =>
                                            void act(`/api/ai/copy-policies/${p.id}`, {
                                                action: "approve",
                                            })
                                        }
                                    >
                                        평가 확인 후 승인
                                    </Button>
                                )}
                                {p.state !== "blocked" && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setBlock({ kind: "policy", id: p.id, name: p.name });
                                            setReason("");
                                        }}
                                    >
                                        문제 버전 차단
                                    </Button>
                                )}
                            </div>
                        </article>
                    ))}
                    <div className="flex gap-2">
                        {manager.cursor > 0 && (
                            <Button variant="outline" onClick={() => manager.setCursor(0)}>
                                최근 버전
                            </Button>
                        )}
                        {catalog.nextCursor && (
                            <Button
                                variant="outline"
                                onClick={() => manager.setCursor(catalog.nextCursor!)}
                            >
                                이전 버전
                            </Button>
                        )}
                    </div>
                </TabsContent>
                <TabsContent value="knowledge" className="space-y-4 pt-3">
                    <Button onClick={() => setEditKnowledge("new")}>새 지식 버전</Button>
                    {!knowledge.versions.length && (
                        <p className="text-muted-foreground">
                            등록된 지식이 없습니다. 사용할 사실과 근거를 추가해 주세요.
                        </p>
                    )}
                    {knowledge.versions.map((k) => (
                        <article key={k.id} className="space-y-3 rounded-md border p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-medium">
                                    {k.name} · #{k.id}
                                </h3>
                                <Badge variant="secondary">{stateLabel(k.state)}</Badge>
                                <span className="text-sm text-muted-foreground">
                                    {workspaceName(k.workspace_id)}
                                </span>
                            </div>
                            <details className="text-sm">
                                <summary className="cursor-pointer">지식 근거 확인</summary>
                                <p className="mt-3 font-medium">{k.snapshot.businessName}</p>
                                {!k.snapshot.claims.length && (
                                    <p>추가 제품 사실 없이 사업명만 사용합니다.</p>
                                )}
                                <ul className="mt-2 space-y-3">
                                    {k.snapshot.claims.map((c, i) => (
                                        <li key={i} className="rounded-md bg-muted p-3">
                                            <p>{c.text}</p>
                                            <a
                                                className="underline"
                                                href={c.sourceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                근거 보기
                                            </a>
                                            <span>
                                                {" "}
                                                ·{" "}
                                                {new Date(c.checkedAt).toLocaleDateString(
                                                    "ko-KR",
                                                )}{" "}
                                                확인 · {c.purposes.map(purposeLabel).join(" / ")}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                            <p className="text-xs text-muted-foreground">
                                {k.state_reason ?? "상태 변경"} ·{" "}
                                {k.last_changed_by_name ?? "자동 처리"} ·{" "}
                                {new Date(k.last_changed_at).toLocaleString("ko-KR")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditKnowledge(k)}
                                >
                                    복제하여 수정
                                </Button>
                                {!["blocked", "retired"].includes(k.state) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={pending}
                                        onClick={() =>
                                            void act(`/api/ai/knowledge-versions/${k.id}`, {
                                                action: "retire",
                                            })
                                        }
                                    >
                                        새 연결에서 사용 종료
                                    </Button>
                                )}
                                {["draft", "evaluated"].includes(k.state) && (
                                    <Button
                                        size="sm"
                                        disabled={pending}
                                        onClick={() =>
                                            void act(`/api/ai/knowledge-versions/${k.id}`, {
                                                action: "approve",
                                            })
                                        }
                                    >
                                        근거 확인 후 승인
                                    </Button>
                                )}
                                {k.state !== "blocked" && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setBlock({ kind: "knowledge", id: k.id, name: k.name });
                                            setReason("");
                                        }}
                                    >
                                        문제 지식 차단
                                    </Button>
                                )}
                            </div>
                        </article>
                    ))}
                    <div className="flex gap-2">
                        {manager.knowledgeCursor > 0 && (
                            <Button variant="outline" onClick={() => manager.setKnowledgeCursor(0)}>
                                최근 지식
                            </Button>
                        )}
                        {knowledge.nextCursor && (
                            <Button
                                variant="outline"
                                onClick={() => manager.setKnowledgeCursor(knowledge.nextCursor!)}
                            >
                                이전 지식
                            </Button>
                        )}
                    </div>
                </TabsContent>
                <TabsContent value="evaluation" className="pt-3">
                    <EvaluationManager
                        catalog={catalog}
                        knowledge={knowledge.versions}
                        act={act}
                        pending={pending}
                    />
                </TabsContent>
                <TabsContent value="bindings" className="pt-3">
                    <BindingForm
                        catalog={catalog}
                        knowledge={knowledge.versions}
                        act={act}
                        pending={pending}
                    />
                    <BindingHistory />
                </TabsContent>
                <TabsContent value="generations" className="pt-3">
                    <GenerationList workspaces={catalog.workspaces} act={act} pending={pending} />
                </TabsContent>
                <TabsContent value="prices" className="pt-3">
                    <PriceSettings act={act} pending={pending} />
                </TabsContent>
            </Tabs>
            <Dialog
                open={editKnowledge !== null}
                onOpenChange={(open) => {
                    if (!open) setEditKnowledge(null);
                }}
            >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {editKnowledge === "new"
                                ? "새 지식 버전"
                                : "지식을 복제하여 새 버전 만들기"}
                        </DialogTitle>
                        <DialogDescription>
                            저장한 버전 내용은 보존합니다. 수정은 새 버전으로 기록합니다.
                        </DialogDescription>
                    </DialogHeader>
                    {editKnowledge && (
                        <KnowledgeForm
                            key={typeof editKnowledge === "string" ? "new" : editKnowledge.id}
                            workspaces={catalog.workspaces}
                            pending={pending}
                            initial={
                                typeof editKnowledge === "object"
                                    ? {
                                          workspaceId: editKnowledge.workspace_id,
                                          snapshot: editKnowledge.snapshot,
                                      }
                                    : undefined
                            }
                            onSave={async (body) => {
                                const saved = await act("/api/ai/knowledge-versions", body);
                                if (saved) setEditKnowledge(null);
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <Dialog
                open={editPolicy !== null}
                onOpenChange={(open) => {
                    if (!open) setEditPolicy(null);
                }}
            >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {editPolicy === "new"
                                ? "새 작성 지침"
                                : "작성 지침을 복제하여 새 버전 만들기"}
                        </DialogTitle>
                        <DialogDescription>
                            문장 자체를 고정하지 않고 표현 방식과 필수 의미를 관리합니다.
                        </DialogDescription>
                    </DialogHeader>
                    {editPolicy && (
                        <PolicyForm
                            key={typeof editPolicy === "string" ? "new" : editPolicy.id}
                            workspaces={catalog.workspaces}
                            pending={pending}
                            initial={
                                typeof editPolicy === "object"
                                    ? {
                                          workspaceId: editPolicy.workspace_id,
                                          snapshot: editPolicy.snapshot,
                                      }
                                    : undefined
                            }
                            onSave={async (body) => {
                                const saved = await act("/api/ai/copy-policies", body);
                                if (saved) setEditPolicy(null);
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <Dialog
                open={block !== null}
                onOpenChange={(open) => {
                    if (!open) setBlock(null);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>문제 버전 차단</DialogTitle>
                        <DialogDescription>
                            {block?.name}을 사용하는 미발송 작업을 보류합니다. 이미 발송한 이력은
                            보존합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <Field label="차단 이유">
                        {(id) => (
                            <textarea
                                id={id}
                                className={controlClass}
                                minLength={10}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                            />
                        )}
                    </Field>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBlock(null)}>
                            닫기
                        </Button>
                        <Button
                            disabled={pending || reason.trim().length < 10}
                            onClick={async () => {
                                if (!block) return;
                                const result = await act(
                                    `/api/ai/${block.kind === "policy" ? "copy-policies" : "knowledge-versions"}/${block.id}`,
                                    { action: "block", reason },
                                );
                                if (result) setBlock(null);
                            }}
                        >
                            차단하고 미발송 작업 보류
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
function BindingForm({
    catalog,
    knowledge,
    act,
    pending,
}: {
    catalog: CopyCatalog;
    knowledge: KnowledgeVersion[];
    act: <T>(url: string, body: unknown) => Promise<T | undefined>;
    pending: boolean;
}) {
    const [workspaceId, setWorkspaceId] = useState(0),
        [purpose, setPurpose] = useState<CopyPurpose>("visit_ack"),
        [ruleId, setRuleId] = useState(0),
        [policyId, setPolicyId] = useState(0),
        [knowledgeId, setKnowledgeId] = useState(0);
    return (
        <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
                승인된 버전만 연결할 수 있습니다. 적용 후 새로 준비하는 고객부터 사용하며 기존
                본문과 진행 중인 실험은 바뀌지 않습니다. 이전 승인 버전을 다시 선택하면 새 작업부터
                되돌릴 수 있습니다.
            </p>
            <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    void act("/api/ai/copy-bindings", {
                        workspaceId,
                        purpose,
                        ruleId: purpose === "visit_ack" ? 0 : ruleId,
                        policyVersionId: policyId,
                        knowledgeVersionId: knowledgeId,
                    });
                }}
            >
                <Field label="사업">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            required
                            value={workspaceId || ""}
                            onChange={(e) => {
                                setWorkspaceId(Number(e.target.value));
                                setPolicyId(0);
                                setKnowledgeId(0);
                                setRuleId(0);
                            }}
                        >
                            <option value="">선택</option>
                            {catalog.workspaces.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.name}
                                </option>
                            ))}
                        </select>
                    )}
                </Field>
                <Field label="메일 목적">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={purpose}
                            onChange={(e) => {
                                setPurpose(e.target.value as CopyPurpose);
                                setPolicyId(0);
                            }}
                        >
                            <option value="visit_ack">방문 감사 메일</option>
                            <option value="initial_email">첫 소개 메일</option>
                        </select>
                    )}
                </Field>
                {purpose === "initial_email" && (
                    <Field label="AI 자동발송 규칙">
                        {(id) => (
                            <select
                                id={id}
                                className={controlClass}
                                required
                                value={ruleId || ""}
                                onChange={(e) => setRuleId(Number(e.target.value))}
                            >
                                <option value="">선택</option>
                                {catalog.rules
                                    .filter((r) => r.workspace_id === workspaceId)
                                    .map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name ?? `규칙 #${r.id}`}
                                        </option>
                                    ))}
                            </select>
                        )}
                    </Field>
                )}
                <Field label="승인된 작성 지침">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            required
                            value={policyId || ""}
                            onChange={(e) => setPolicyId(Number(e.target.value))}
                        >
                            <option value="">선택</option>
                            {catalog.versions
                                .filter(
                                    (p) =>
                                        p.workspace_id === workspaceId &&
                                        p.purpose === purpose &&
                                        p.state === "approved",
                                )
                                .map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} · #{p.id}
                                    </option>
                                ))}
                        </select>
                    )}
                </Field>
                <Field label="승인된 지식">
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
                                .filter(
                                    (k) => k.workspace_id === workspaceId && k.state === "approved",
                                )
                                .map((k) => (
                                    <option key={k.id} value={k.id}>
                                        {k.name} · #{k.id}
                                    </option>
                                ))}
                        </select>
                    )}
                </Field>
                <div>
                    <Button disabled={pending} type="submit">
                        새 작업부터 적용
                    </Button>
                </div>
            </form>
            <h3 className="font-medium">현재 발송 연결</h3>
            {!catalog.bindings.length ? (
                <p className="text-sm text-muted-foreground">
                    승인 버전 연결이 없어 기존 지침으로 생성하고 있습니다.
                </p>
            ) : (
                <ul className="space-y-2 text-sm">
                    {catalog.bindings.map((b) => (
                        <li
                            key={`${b.workspace_id}-${b.purpose}-${b.rule_id}`}
                            className="rounded-md border p-3"
                        >
                            {catalog.workspaces.find((w) => w.id === b.workspace_id)?.name} ·{" "}
                            {purposeLabel(b.purpose)}
                            {b.rule_id > 0 && ` · 규칙 #${b.rule_id}`} · 작성 #{b.policy_version_id}{" "}
                            / 지식 #{b.knowledge_version_id}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
