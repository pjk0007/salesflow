"use client";
import { useConversationOperations } from "../hooks/useOperations";
import { durationText, operationTime } from "../utils/display";
export function ConversationServiceStatus({ id }: { id: string }) {
    const { data, error, mutate } = useConversationOperations(id);
    if (error)
        return (
            <section className="border-t p-4 text-xs" role="alert">
                응대 목표를 불러오지 못했습니다.{" "}
                <button onClick={() => void mutate()}>다시 불러오기</button>
            </section>
        );
    if (!data) return null;
    if (data.historyOnly) return null;
    const active = data.cases.filter((c) => !c.closedAt),
        shown = active.length ? active : data.cases.slice(0, 1);
    return (
        <section
            className="space-y-3 border-t p-4 text-xs"
            aria-label="상담 응대 목표"
        >
            <h3 className="font-semibold">응대 목표</h3>
            {!shown.length && (
                <p className="text-muted-foreground">
                    새 고객 문의부터 응대 시간을 기록합니다.
                </p>
            )}
            {shown.map((c) => (
                <div key={c.id} className="space-y-2">
                    <p>
                        {c.closedAt ? "종료된 응대" : "진행 중"} · 설정 v
                        {c.policyVersion}
                        {c.paused && " · 보류 시간 제외"}
                    </p>
                    {!c.slaApplied && (
                        <p className="text-muted-foreground">
                            이 문의에는 응대 목표를 적용하지 않았습니다.
                        </p>
                    )}
                    {c.firstReplyAt && (
                        <p>
                            첫 답변 {durationText(c.firstReplyMs)}
                            {c.firstResponder === "ai"
                                ? " · AI 자동답변"
                                : " · 상담원"}
                        </p>
                    )}
                    {c.waiting.map((w) => (
                        <p
                            key={w.id}
                            className={
                                w.missed
                                    ? "rounded bg-red-50 p-2 font-medium text-red-700"
                                    : ""
                            }
                        >
                            {w.kind === "first" ? "첫 답변" : "추가 답변"}{" "}
                            {w.missed ? "목표 초과" : "대기"}
                            {w.dueAt && <> · {operationTime(w.dueAt)}까지</>}
                        </p>
                    ))}
                    {c.resolutionDueAt && (
                        <p
                            className={
                                c.resolutionMissed
                                    ? "text-red-700"
                                    : "text-muted-foreground"
                            }
                        >
                            해결 {c.resolutionMissed ? "목표 초과" : "목표"} ·{" "}
                            {operationTime(c.resolutionDueAt)}
                        </p>
                    )}
                    {c.closedAt && (
                        <p>해결 소요 {durationText(c.resolutionMs)}</p>
                    )}
                </div>
            ))}
            {!!active.length && !data.settingsEnabled && (
                <p className="text-muted-foreground">
                    현재 목표 알림이 중지돼 있습니다.
                </p>
            )}
            {!!active.length && data.settingsEnabled && !data.workerEnabled && (
                <p className="text-muted-foreground">
                    자동 목표 알림은 서버에서 켜야 합니다.
                </p>
            )}
        </section>
    );
}
