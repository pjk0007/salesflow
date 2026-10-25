"use client";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { useApprovedKnowledge } from "../hooks/useApprovedKnowledge";
import type { SupportCatalog, SupportSettings } from "../types";
export function SupportSettingsForm({
    workspaceId,
    catalog,
    members,
    onSave,
    canManage,
}: {
    workspaceId: number;
    catalog: SupportCatalog;
    members: { id: string; name: string }[];
    onSave: (value: SupportSettings) => Promise<SupportSettings>;
    canManage: boolean;
}) {
    const [draft, setDraft] = useState(catalog.settings),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    // 최신 100개 밖의 이전 승인 지식 찾기(UX-301). 선택한 값은 검색·쪽을 바꿔도 목록에 남긴다.
    const [findOlder, setFindOlder] = useState(false),
        [knowledgeQuery, setKnowledgeQuery] = useState(""),
        [picked, setPicked] = useState<SupportCatalog["knowledge"][number] | null>(null);
    const older = useApprovedKnowledge(workspaceId, knowledgeQuery, findOlder);
    const knowledgeOptions = [...catalog.knowledge];
    for (const k of [...(picked ? [picked] : []), ...older.options])
        if (!knowledgeOptions.some((o) => o.id === k.id))
            knowledgeOptions.push({ ...k, fingerprint: "" });
    const field =
        "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
    const saving = useRef(false);
    return (
        <form
            className="space-y-4"
            onSubmit={async (e) => {
                e.preventDefault();
                if (saving.current || !canManage) return;
                saving.current = true;
                setBusy(true);
                setError("");
                try {
                    const saved = await onSave(draft);
                    setDraft(saved);
                    toast.success(`AI 응대 설정 v${saved.version}을 적용했습니다.`);
                } catch (e) {
                    setError((e as Error).message);
                } finally {
                    saving.current = false;
                    setBusy(false);
                }
            }}
        >
            <h2 className="font-semibold">AI 응대 설정</h2>
            {catalog.settings.version !== draft.version && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
                    다른 변경이 있습니다. 작성 중인 값은 보존했습니다.
                    <button
                        type="button"
                        className="ml-2 underline"
                        onClick={() => {
                            setDraft(catalog.settings);
                            setError("");
                        }}
                    >
                        최신 설정 불러오기
                    </button>
                </p>
            )}
            <fieldset disabled={!canManage || busy} className="space-y-4">
                <label className="block text-xs">
                    응대 방식
                    <select
                        aria-label="AI 응대 방식"
                        className={field}
                        value={draft.mode}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                mode: e.target.value as SupportSettings["mode"],
                            }))
                        }
                    >
                        <option value="manual">
                            수동 초안 · 상담원이 필요할 때 생성
                        </option>
                        <option value="draft">
                            자동 초안 · 상담원이 확인하고 전송
                        </option>
                        <option value="reply">
                            AI 자동 답변 · 근거 부족 시 사람에게 인계
                        </option>
                    </select>
                </label>
                <label className="block text-xs">
                    사용할 승인 지식
                    <select
                        aria-label="상담 승인 지식"
                        className={field}
                        value={draft.knowledgeVersionId ?? ""}
                        onChange={(e) => {
                            const id = Number(e.target.value) || null;
                            setPicked(knowledgeOptions.find((k) => k.id === id) ?? null);
                            setDraft((d) => ({ ...d, knowledgeVersionId: id }));
                        }}
                    >
                        <option value="">지식 선택</option>
                        {knowledgeOptions.map((k) => (
                            <option
                                key={k.id}
                                value={k.id}
                                disabled={k.state !== "approved" || !k.claims}
                            >
                                {k.name} · #{k.id} ·{" "}
                                {k.state === "approved" ? "승인" : "미승인"} ·
                                상담 근거 {k.claims}개
                            </option>
                        ))}
                    </select>
                </label>
                <div className="space-y-2 text-xs">
                    {!findOlder ? (
                        <button type="button" className="underline" onClick={() => setFindOlder(true)}>
                            이전 승인 지식 찾기
                        </button>
                    ) : (
                        <>
                            <input
                                aria-label="이전 승인 지식 이름 검색"
                                className={field}
                                placeholder="지식 이름으로 찾기 (최신 100개 밖의 승인 지식도 찾습니다)"
                                value={knowledgeQuery}
                                maxLength={120}
                                onChange={(e) => setKnowledgeQuery(e.target.value)}
                            />
                            {older.error ? (
                                <p role="alert" className="text-red-600">
                                    {older.error.message}{" "}
                                    <button type="button" className="underline" onClick={older.retry}>
                                        다시 시도
                                    </button>
                                </p>
                            ) : older.loading ? (
                                <p role="status" className="text-muted-foreground">
                                    승인 지식을 찾는 중…
                                </p>
                            ) : (
                                <p className="text-muted-foreground">
                                    찾은 승인 지식은 위 목록에 추가됩니다.
                                    {older.hasMore && (
                                        <button type="button" className="ml-2 underline" onClick={older.loadMore}>
                                            더 보기
                                        </button>
                                    )}
                                </p>
                            )}
                        </>
                    )}
                </div>
                {draft.knowledgeVersionId && !knowledgeOptions.find((knowledge) => knowledge.id === draft.knowledgeVersionId)?.claims && (
                    <p role="alert" className="text-sm text-amber-800">선택한 지식에 현재 사용할 수 있는 상담 근거가 없습니다. 확인일과 승인 상태를 검토해주세요.</p>
                )}
                <label className="block text-xs">
                    AI 모델
                    <select
                        aria-label="상담 AI 모델"
                        className={field}
                        value={draft.model}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, model: e.target.value }))
                        }
                    >
                        {catalog.models.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.label}
                                {m.configured ? "" : " · 연결 필요"}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="block text-xs">
                    말투·안내 지침
                    <textarea
                        aria-label="상담 작성 지침"
                        className={field}
                        rows={3}
                        value={draft.instructions}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                instructions: e.target.value,
                            }))
                        }
                        maxLength={2000}
                    />
                </label>
                <label className="block text-xs">
                    사람에게 인계할 담당자
                    <select
                        aria-label="AI 인계 담당자"
                        className={field}
                        value={draft.handoffAssigneeId ?? ""}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                handoffAssigneeId: e.target.value || null,
                            }))
                        }
                    >
                        <option value="">
                            담당자 미지정 · 수신함에서 확인
                        </option>
                        {draft.handoffAssigneeId && !members.some((member) => member.id === draft.handoffAssigneeId) && (
                            <option value={draft.handoffAssigneeId} disabled>기존 담당자 (권한 없음)</option>
                        )}
                        {members.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="block text-xs">
                    인계 시 고객에게 보여줄 안내
                    <textarea
                        aria-label="AI 인계 안내"
                        className={field}
                        rows={2}
                        value={draft.handoffMessage}
                        maxLength={500}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                handoffMessage: e.target.value,
                            }))
                        }
                    />
                </label>
                <label className="block text-xs">
                    사업별 하루 생성 시도 한도
                    <input
                        aria-label="하루 AI 생성 한도"
                        type="number"
                        min={1}
                        max={1000}
                        className={field}
                        value={draft.maxJobsPerDay}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                maxJobsPerDay: Number(e.target.value),
                            }))
                        }
                    />
                </label>
            </fieldset>
            <p className="text-xs text-muted-foreground">
                설정을 저장한 뒤 들어오는 새 문의부터 사용합니다. 기존 초안은
                설정이 바뀌면 전송 전 다시 확인합니다. ‘사람 응대’로 전환한
                상담에는 자동 답변하지 않습니다.
            </p>
            {draft.mode === "reply" && (
                <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-900">
                    이 설정을 저장하면 승인 지식으로 답변을 생성·검토한 뒤
                    고객에게 직접 보냅니다. 가격·조건·인계 안내를 먼저
                    확인해주세요.
                </p>
            )}
            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}
            {canManage && (
                <button
                    disabled={busy}
                    className="rounded-lg bg-[#635BFF] px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                    {busy ? "저장 중…" : "설정 검토 후 적용"}
                </button>
            )}
        </form>
    );
}
