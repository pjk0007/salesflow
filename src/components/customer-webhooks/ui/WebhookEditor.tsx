"use client";
import { useState } from "react";
import type { WebhookEndpoint } from "../types";
export const eventNames: Record<string, string> = {
    "contact.created": "고객 생성",
    "contact.updated": "고객 정보 변경",
    "company.created": "회사 생성",
    "company.updated": "회사 정보 변경",
    "customer.event": "고객 행동 이벤트",
    "conversation.created": "새 상담",
    "conversation.updated": "상담 상태·담당 변경",
    "conversation.identified": "비회원 상담의 회원 연결",
    "message.created": "고객 문의·공개 답변",
    "deal.created": "딜 생성",
    "deal.updated": "딜 변경",
    "task.created": "할 일 생성",
    "task.updated": "할 일 변경",
    "pipeline.created": "파이프라인 생성",
    "pipeline.updated": "파이프라인 변경",
    "platform.test": "가상 연결 확인",
    "ai.draft.ready": "AI 답변 초안 준비",
    "ai.handoff": "AI에서 사람 응대로 전환",
};
export function WebhookEditor({
    endpoint,
    eventTypes,
    busy,
    onSave,
}: {
    endpoint?: WebhookEndpoint;
    eventTypes: string[];
    busy: boolean;
    onSave: (value: unknown) => Promise<WebhookEndpoint>;
}) {
    const initial = () => ({
        name: endpoint?.name ?? "",
        url: endpoint?.url ?? "",
        eventTypes: endpoint?.eventTypes ?? [
            "message.created",
            "conversation.updated",
        ],
        enabled: endpoint?.enabled ?? false,
        version: endpoint?.version ?? 1,
    });
    const [draft, setDraft] = useState(initial),
        [error, setError] = useState("");
    const field =
        "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
    return (
        <form
            className="space-y-4"
            onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                try {
                    const saved = await onSave(
                        endpoint
                            ? draft
                            : {
                                  name: draft.name,
                                  url: draft.url,
                                  eventTypes: draft.eventTypes,
                              },
                    );
                    setDraft({
                        name: saved.name,
                        url: saved.url,
                        eventTypes: saved.eventTypes,
                        enabled: saved.enabled,
                        version: saved.version,
                    });
                } catch (e) {
                    setError((e as Error).message);
                }
            }}
        >
            <h2 className="font-semibold">
                {endpoint ? "수신 설정" : "웹훅 등록"}
            </h2>
            {endpoint && endpoint.version !== draft.version && (
                <div
                    role="alert"
                    className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
                >
                    다른 변경이 있습니다. 작성 중인 내용은 보존했습니다.
                    <button
                        type="button"
                        className="ml-2 underline"
                        onClick={() => {
                            setDraft(initial());
                            setError("");
                        }}
                    >
                        최신 설정 불러오기
                    </button>
                </div>
            )}
            <label className="block text-xs">
                연동 이름
                <input
                    aria-label="웹훅 이름"
                    className={field}
                    value={draft.name}
                    disabled={busy}
                    maxLength={100}
                    required
                    onChange={(e) =>
                        setDraft((d) => ({ ...d, name: e.target.value }))
                    }
                />
            </label>
            <label className="block text-xs">
                수신 서버 주소
                <input
                    aria-label="웹훅 수신 주소"
                    type="url"
                    placeholder="https://example.com/sendb/webhook"
                    className={field}
                    value={draft.url}
                    disabled={busy}
                    required
                    onChange={(e) =>
                        setDraft((d) => ({ ...d, url: e.target.value }))
                    }
                />
            </label>
            <fieldset disabled={busy} className="space-y-2">
                <legend className="mb-2 text-xs">전달할 이벤트</legend>
                <label className="mb-3 flex gap-2 text-xs">
                    <input
                        type="checkbox"
                        checked={eventTypes.every((t) =>
                            draft.eventTypes.includes(t),
                        )}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                eventTypes: e.target.checked ? eventTypes : [],
                            }))
                        }
                    />
                    전체 선택
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                    {eventTypes.map((type) => (
                        <label key={type} className="flex gap-2 text-xs">
                            <input
                                type="checkbox"
                                checked={draft.eventTypes.includes(type)}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        eventTypes: e.target.checked
                                            ? [...d.eventTypes, type]
                                            : d.eventTypes.filter(
                                                  (v) => v !== type,
                                              ),
                                    }))
                                }
                            />
                            {eventNames[type] ?? type}
                        </label>
                    ))}
                </div>
            </fieldset>
            {endpoint ? (
                <label className="flex gap-2 rounded-lg border p-3 text-sm">
                    <input
                        type="checkbox"
                        aria-label="웹훅 전송 켜기"
                        disabled={busy}
                        checked={draft.enabled}
                        onChange={(e) =>
                            setDraft((d) => ({
                                ...d,
                                enabled: e.target.checked,
                            }))
                        }
                    />
                    웹훅 전송 켜기
                </label>
            ) : (
                <p className="text-xs text-muted-foreground">
                    등록 후 서명 키를 수신 서버에 복사하고 전송을 켜주세요.
                </p>
            )}
            {endpoint && (
                <p className="text-xs text-muted-foreground">
                    주소·이벤트·키 등 설정 변경 시 이전 대기 발송은 취소됩니다.
                    이미 진행 중인 요청은 완료될 수 있습니다.
                </p>
            )}
            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}
            <button
                disabled={busy || !draft.eventTypes.length}
                className="rounded-lg bg-[#635BFF] px-4 py-2 text-sm text-white disabled:opacity-40"
            >
                {busy ? "저장 중…" : endpoint ? "설정 저장" : "웹훅 등록"}
            </button>
        </form>
    );
}
