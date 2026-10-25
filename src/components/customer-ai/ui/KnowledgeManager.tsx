"use client";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { KnowledgeForm } from "@/components/ai-copy/ui/VersionForms";
import { stateLabel } from "@/components/ai-copy/ui/Fields";
import { kstParts } from "@/lib/kst";
import { isUsableSupportClaim } from "@/lib/customer-ai/knowledge-validity";
import { supportRequest, supportWrite } from "../api";
import type { SupportKnowledge } from "../types";
export function KnowledgeManager({
    workspaceId,
    name,
    canManage,
    onChanged,
}: {
    workspaceId: number;
    name: string;
    canManage: boolean;
    onChanged: () => Promise<unknown>;
}) {
    const [before, setBefore] = useState<number | null>(null),
        [editing, setEditing] = useState<SupportKnowledge | "new" | null>(null),
        [busy, setBusy] = useState(false),
        [block, setBlock] = useState<SupportKnowledge | null>(null),
        [reason, setReason] = useState(""),
        [showOtherKnowledge, setShowOtherKnowledge] = useState(false);
    const data = useSWR<{ rows: SupportKnowledge[]; hasMore: boolean }>(
        `/api/customer-ai/knowledge?workspaceId=${workspaceId}${before ? `&before=${before}` : ""}`,
        supportRequest,
    );
    async function change(id: number, action: "approve" | "block") {
        setBusy(true);
        try {
            await supportWrite(`/api/customer-ai/knowledge/${id}`, {
                workspaceId,
                action,
                ...(action === "block" ? { reason } : {}),
            });
            setBlock(null);
            setReason("");
            await Promise.all([data.mutate(), onChanged()]);
            toast.success(
                action === "approve"
                    ? "지식을 승인했습니다."
                    : "지식을 차단했습니다.",
            );
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="font-semibold">고객 상담 지식</h2>
                {canManage && (
                    <button
                        className="rounded-lg border px-3 py-2 text-sm"
                        onClick={() => setEditing("new")}
                    >
                        새 지식 버전
                    </button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                메일 AI 품질 관리와 같은 지식 버전입니다. ‘고객 상담’으로
                표시하고 승인한 사실만 상담에서 사용합니다. 수정은 새 버전으로
                만들어 검토합니다.
            </p>
            {data.error && (
                <p role="alert" className="text-red-600">
                    {data.error.message}{" "}
                    <button onClick={() => void data.mutate()}>다시 불러오기</button>
                </p>
            )}
            {data.isLoading && <p role="status" className="text-sm text-muted-foreground">지식을 불러오는 중…</p>}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                    type="checkbox"
                    checked={showOtherKnowledge}
                    onChange={(e) => setShowOtherKnowledge(e.target.checked)}
                />
                메일 전용 지식도 표시
            </label>
            {data.data?.rows.length &&
            !showOtherKnowledge &&
            !data.data.rows.some((version) =>
                version.snapshot.claims.some((claim) =>
                    claim.purposes.includes("customer_chat"),
                ),
            ) ? (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                    상담용 안내 자료가 없습니다. 새 지식 버전에서 고객 상담에
                    사용할 내용을 등록해주세요.
                </p>
            ) : null}
            {data.data?.rows
                .filter(
                    (version) =>
                        showOtherKnowledge ||
                        version.snapshot.claims.some((claim) =>
                            claim.purposes.includes("customer_chat"),
                        ),
                )
                .map((version) => (
                    <article
                        key={version.id}
                        className="space-y-3 rounded-xl border p-4 text-sm"
                    >
                        <div className="flex flex-wrap justify-between gap-2">
                            <strong>
                                {version.name} · #{version.id}
                            </strong>
                            <span>{stateLabel(version.state)}</span>
                        </div>
                        <details>
                            <summary className="cursor-pointer">
                                근거 확인 · 상담 항목{" "}
                                {
                                    version.snapshot.claims.filter((c) =>
                                        c.purposes.includes("customer_chat"),
                                    ).length
                                }
                                개
                            </summary>
                            {version.snapshot.claims.map((claim, i) => (
                                <div
                                    key={i}
                                    className="my-3 space-y-1 border-l-2 pl-3 text-xs"
                                >
                                    <p className="whitespace-pre-wrap">
                                        {claim.text}
                                    </p>
                                    <a
                                        href={claim.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="break-all text-[#635BFF]"
                                    >
                                        {claim.sourceUrl}
                                    </a>
                                    <p className="text-muted-foreground">
                                        {kstParts(new Date(claim.checkedAt)).date} 확인 ·{" "}
                                        {claim.purposes.includes(
                                            "customer_chat",
                                        )
                                            ? isUsableSupportClaim(claim) ? "상담에 사용 가능" : "확인일 만료 또는 미래 날짜 · 상담에서 제외"
                                            : "메일용 · 상담에서 제외"}
                                    </p>
                                </div>
                            ))}
                        </details>
                        {canManage && (
                            <div className="flex gap-3 text-xs">
                                <button
                                    disabled={busy}
                                    className="text-[#635BFF]"
                                    onClick={() => setEditing(version)}
                                >
                                    이 버전 복사해 수정
                                </button>
                                {["draft", "evaluated"].includes(
                                    version.state,
                                ) && (
                                    <button
                                        disabled={busy}
                                        className="text-[#635BFF]"
                                        onClick={() =>
                                            void change(version.id, "approve")
                                        }
                                    >
                                        근거 확인 후 승인
                                    </button>
                                )}
                                {version.state !== "blocked" && (
                                    <button
                                        disabled={busy}
                                        className="text-red-600"
                                        onClick={() => {
                                            setBlock(version);
                                            setReason("");
                                        }}
                                    >
                                        사용 차단
                                    </button>
                                )}
                            </div>
                        )}
                    </article>
                ))}
            {data.data && !data.data.rows.length && (
                <p className="rounded-xl bg-muted p-5 text-sm text-muted-foreground">
                    등록한 지식이 없습니다. 서비스 안내·FAQ·요금 등의 사실과
                    근거를 등록해주세요.
                </p>
            )}
            <div className="flex gap-3 text-xs">
                {before && (
                    <button disabled={data.isLoading} onClick={() => setBefore(null)}>
                        최신 버전으로
                    </button>
                )}
                {data.data?.hasMore && (
                    <button
                        disabled={data.isLoading}
                        onClick={() => setBefore(data.data!.rows.at(-1)!.id)}
                    >
                        이전 버전 보기
                    </button>
                )}
            </div>
            {editing && (
                <div className="fixed inset-0 z-50 overflow-auto bg-black/30 p-5">
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-label="상담 지식 버전 작성"
                        className="mx-auto max-w-3xl space-y-4 rounded-2xl bg-background p-6"
                    >
                        <div className="flex justify-between">
                            <h3 className="font-semibold">새 상담 지식 버전</h3>
                            <button
                                disabled={busy}
                                onClick={() => setEditing(null)}
                            >
                                닫기
                            </button>
                        </div>
                        <KnowledgeForm
                            workspaces={[{ id: workspaceId, name }]}
                            initial={{
                                workspaceId,
                                snapshot:
                                    editing === "new"
                                        ? {
                                              businessName: name,
                                              claims: [
                                                  {
                                                      text: "",
                                                      sourceUrl: "",
                                                      checkedAt:
                                                          new Date().toISOString(),
                                                      purposes: [
                                                          "customer_chat",
                                                      ],
                                                  },
                                              ],
                                          }
                                        : editing.snapshot,
                            }}
                            defaultPurposes={["customer_chat"]}
                            description="서비스 안내·FAQ·가격 등 확인한 사실을 근거 URL과 함께 등록하세요. 상담에 사용할 항목은 ‘고객 상담’을 선택해주세요."
                            pending={busy}
                            onSave={async (value) => {
                                setBusy(true);
                                try {
                                    await supportWrite(
                                        "/api/customer-ai/knowledge",
                                        value,
                                    );
                                    setEditing(null);
                                    await Promise.all([
                                        data.mutate(),
                                        onChanged(),
                                    ]);
                                    toast.success(
                                        "검토할 지식 초안을 만들었습니다.",
                                    );
                                } catch (e) {
                                    toast.error((e as Error).message);
                                } finally {
                                    setBusy(false);
                                }
                            }}
                        />
                    </section>
                </div>
            )}
            {block && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-5">
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-label="지식 사용 차단"
                        className="w-full max-w-lg space-y-4 rounded-xl bg-background p-6"
                    >
                        <h3 className="font-semibold">
                            {block.name} 사용 차단
                        </h3>
                        <p className="text-sm">
                            이 버전을 쓰는 메일 작업·실험과 상담 초안이 영향을
                            받습니다. 차단 사유를 기록해주세요.
                        </p>
                        <textarea
                            aria-label="지식 차단 사유"
                            aria-describedby="support-knowledge-block-reason"
                            className="w-full rounded-lg border p-3"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            minLength={10}
                            maxLength={1000}
                        />
                        <p id="support-knowledge-block-reason" className="text-xs text-muted-foreground">{reason.trim().length}/10자 이상 · 차단 이유를 10자 이상 입력해주세요.</p>
                        <div className="flex gap-3">
                            <button
                                disabled={busy || reason.trim().length < 10}
                                onClick={() => void change(block.id, "block")}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-40"
                            >
                                차단 적용
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => setBlock(null)}
                            >
                                취소
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </section>
    );
}
