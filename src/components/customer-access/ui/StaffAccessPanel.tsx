"use client";
import { useState } from "react";
import { useStaffAccess } from "../hooks/useStaffAccess";
import { roleNames } from "../utils/abilities";
import {
    workspaceRoles,
    type WorkspaceRole,
} from "@/lib/customer-access/rules";
import type { InboxBootstrap } from "@/components/inbox/types";
import { toast } from "sonner";
export function StaffAccessPanel({
    bootstrap,
    initialWorkspaceId,
    onClose,
    onSaved,
}: {
    bootstrap: InboxBootstrap;
    initialWorkspaceId?: number;
    onClose: () => void;
    onSaved: () => Promise<unknown>;
}) {
    const [workspaceId, setWorkspace] = useState(
        initialWorkspaceId ?? bootstrap.workspaces[0]?.id ?? 0,
    );
    return (
        <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={onClose}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-label="직원 사업 권한"
                className="h-full w-full max-w-4xl space-y-5 overflow-auto bg-background p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">직원 사업 권한</h2>
                    <button aria-label="직원 권한 닫기" onClick={onClose}>
                        닫기
                    </button>
                </header>
                <p className="text-sm text-muted-foreground">
                    직원이 담당할 사업과 역할을 지정하세요. 조직 관리자는 모든
                    사업을 관리하며, 일반 직원은 배정받은 사업만 사용합니다.
                </p>
                <select
                    aria-label="권한 관리 사업"
                    className="w-full rounded-lg border bg-background p-3"
                    value={workspaceId}
                    onChange={(e) => setWorkspace(Number(e.target.value))}
                >
                    <option value={0} disabled>
                        사업 선택
                    </option>
                    {bootstrap.workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </select>
                <div className="grid gap-2 rounded-lg bg-muted p-4 text-sm">
                    <p>
                        <b>열람</b> · 상담·고객·영업·성과 조회, 내 알림 확인
                    </p>
                    <p>
                        <b>응대·편집</b> · 답변·내부 메모·첨부·담당
                        배정·고객·딜·할 일 편집
                    </p>
                    <p>
                        <b>운영 관리</b> · 응대·편집과
                        상담창·메일함·AI·자동화·파이프라인·외부 연동·이전 설정
                    </p>
                    <p>
                        <b>접근 없음</b> · 다음 요청부터 해당 사업 접근 중단.
                        이미 처리 중인 발송은 취소를 보장하지 않습니다.
                    </p>
                </div>
                {workspaceId > 0 && (
                    <Roster
                        key={workspaceId}
                        workspaceId={workspaceId}
                        onSaved={onSaved}
                    />
                )}
            </section>
        </div>
    );
}
function Roster({
    workspaceId,
    onSaved,
}: {
    workspaceId: number;
    onSaved: () => Promise<unknown>;
}) {
    const [before, setBefore] = useState<string>(),
        [previous, setPrevious] = useState<(string | undefined)[]>([]),
        [drafts, setDrafts] = useState<Record<string, WorkspaceRole>>({}),
        [busy, setBusy] = useState<string | null>(null);
    const state = useStaffAccess(workspaceId, before);
    return (
        <>
            {state.error && (
                <p role="alert" className="text-red-700">
                    {state.error.message}{" "}
                    <button
                        className="underline"
                        onClick={() => void state.mutate()}
                    >
                        새로 불러오기
                    </button>
                </p>
            )}
            {!state.data && !state.error && <p>직원 권한을 불러오는 중…</p>}
            {state.data && (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="p-3">직원</th>
                                    <th>사업 역할</th>
                                    <th>저장</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.data.members.map((m) => (
                                    <tr key={m.id} className="border-b">
                                        <td className="p-3">
                                            <b>{m.name}</b>
                                            <span className="block text-xs text-muted-foreground">
                                                {m.email}
                                                {m.active !== 1
                                                    ? " · 비활성"
                                                    : ""}
                                            </span>
                                        </td>
                                        <td>
                                            {m.orgRole !== "member" ? (
                                                <span>
                                                    조직 관리자 · 전체 관리
                                                </span>
                                            ) : (
                                                <select
                                                    aria-label={`${m.name} 사업 역할`}
                                                    className="rounded border bg-background p-2"
                                                    disabled={busy !== null}
                                                    value={
                                                        drafts[m.id] ?? m.role
                                                    }
                                                    onChange={(e) =>
                                                        setDrafts((d) => ({
                                                            ...d,
                                                            [m.id]: e.target
                                                                .value as WorkspaceRole,
                                                        }))
                                                    }
                                                >
                                                    {workspaceRoles.map((r) => (
                                                        <option
                                                            key={r}
                                                            value={r}
                                                            disabled={
                                                                m.active !==
                                                                    1 &&
                                                                r !== "none"
                                                            }
                                                        >
                                                            {roleNames[r]}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}
                                            {/* UX-101 게시자 권한을 낮추면 그 직원이 게시한 자동화가 모두 실패한다 */}
                                            {m.orgRole === "member" &&
                                                !!m.publishedWorkflows &&
                                                (drafts[m.id] ?? m.role) !==
                                                    "manager" &&
                                                (drafts[m.id] ?? m.role) !==
                                                    m.role && (
                                                    <p
                                                        role="alert"
                                                        className="mt-1 max-w-xs text-xs text-amber-800"
                                                    >
                                                        이 직원이 게시한 켜진
                                                        자동화 {m.publishedWorkflows}
                                                        개가 저장 후 실행되지
                                                        않습니다. 운영 관리 권한이
                                                        있는 직원이 고객
                                                        자동화에서 다시 게시해야
                                                        합니다.
                                                    </p>
                                                )}
                                        </td>
                                        <td>
                                            {m.orgRole === "member" && (
                                                <button
                                                    aria-label={`${m.name} 권한 저장`}
                                                    className="rounded border p-2 disabled:opacity-40"
                                                    disabled={
                                                        busy !== null ||
                                                        (drafts[m.id] ??
                                                            m.role) === m.role
                                                    }
                                                    onClick={async () => {
                                                        setBusy(m.id);
                                                        try {
                                                            await state.save(
                                                                m.id,
                                                                drafts[m.id] ??
                                                                    m.role,
                                                                m.version,
                                                            );
                                                            setDrafts((d) => {
                                                                const next = {
                                                                    ...d,
                                                                };
                                                                delete next[
                                                                    m.id
                                                                ];
                                                                return next;
                                                            });
                                                            await state.mutate();
                                                            await onSaved();
                                                            toast.success(
                                                                "사업 권한을 저장했습니다.",
                                                            );
                                                        } catch (e) {
                                                            toast.error(
                                                                (e as Error)
                                                                    .message,
                                                            );
                                                            await state.mutate();
                                                        } finally {
                                                            setBusy(null);
                                                        }
                                                    }}
                                                >
                                                    {busy === m.id
                                                        ? "저장 중…"
                                                        : "저장"}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <section className="space-y-3">
                        <h3 className="font-semibold">권한 변경 이력</h3>
                        {!state.data.history.length && (
                            <p className="text-sm text-muted-foreground">
                                변경 이력이 없습니다.
                            </p>
                        )}
                        {state.data.history.map((h) => (
                            <p
                                key={h.id}
                                className="rounded border p-3 text-sm"
                            >
                                <b>{h.name}</b> · {roleNames[h.beforeRole]} →{" "}
                                {roleNames[h.afterRole]}
                                <span className="mt-1 block text-xs text-muted-foreground">
                                    {h.actorName} ·{" "}
                                    {new Date(h.createdAt).toLocaleString(
                                        "ko-KR",
                                    )}
                                </span>
                            </p>
                        ))}
                        <div className="flex gap-3">
                            <button
                                disabled={!previous.length}
                                onClick={() => {
                                    setBefore(previous.at(-1));
                                    setPrevious((p) => p.slice(0, -1));
                                }}
                            >
                                이전
                            </button>
                            <button
                                disabled={!state.data.hasMore}
                                onClick={() => {
                                    setPrevious((p) => [...p, before]);
                                    setBefore(state.data?.history.at(-1)?.id);
                                }}
                            >
                                다음
                            </button>
                        </div>
                    </section>
                </>
            )}
        </>
    );
}
