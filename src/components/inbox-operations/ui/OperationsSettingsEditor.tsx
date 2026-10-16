"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useOperationsSettings } from "../hooks/useOperations";
import { saveOperations } from "../api";
import type { OperationsPolicy } from "../types";
const days = ["일", "월", "화", "수", "목", "금", "토"];
export function OperationsSettingsEditor({
    channelId,
    canManage,
}: {
    channelId: number;
    canManage: boolean;
}) {
    const { data, error, mutate } = useOperationsSettings(channelId),
        [draft, setDraft] = useState<{
            version: number;
            policy: OperationsPolicy;
        } | null>(null),
        [busy, setBusy] = useState(false),
        [holidays, setHolidays] = useState<string | null>(null);
    if (error)
        return (
            <p role="alert">
                {error.message}{" "}
                <button onClick={() => void mutate()}>다시 불러오기</button>
            </p>
        );
    if (!data) return <p>운영 설정을 불러오는 중…</p>;
    const policy = draft?.policy ?? data.policy;
    function edit(value: Partial<OperationsPolicy>) {
        setDraft((current) => ({
            version: current?.version ?? data!.version,
            policy: { ...(current?.policy ?? data!.policy), ...value },
        }));
    }
    return (
        <form
            className="space-y-6"
            onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                const next = {
                    ...policy,
                    calendar: {
                        ...policy.calendar,
                        holidays:
                            holidays === null
                                ? policy.calendar.holidays
                                : [
                                      ...new Set(
                                          holidays.split(/\s+/).filter(Boolean),
                                      ),
                                  ],
                    },
                };
                void saveOperations(
                    channelId,
                    draft?.version ?? data.version,
                    next,
                )
                    .then(async () => {
                        setDraft(null);
                        setHolidays(null);
                        await mutate();
                        toast.success(
                            "운영 설정을 저장했습니다. 자동 배정은 다음 판단부터, 응대 계산은 새 응대부터 적용합니다.",
                        );
                    })
                    .catch((e) => toast.error((e as Error).message))
                    .finally(() => setBusy(false));
            }}
        >
            <p className="rounded-lg bg-muted p-3 text-sm">
                업무시간·휴무일은 고객 안내, 응대 시간 계산과 선택한 팀의 자동
                배정에 사용합니다. 응대 계산은 새로 시작하는 응대부터 적용하며
                진행 중·과거 응대의 기준은 유지합니다. 업무시간 배정 옵션을 켠
                팀의 대기 상담은 다음 배정 판단부터 최신 달력을 사용합니다.
            </p>
            {!canManage && <p>설정 변경은 관리자에게 요청해주세요.</p>}
            <fieldset
                disabled={!canManage || busy}
                className="space-y-5 disabled:opacity-70"
            >
                <legend className="mb-3 font-semibold">업무시간</legend>
                <label className="block text-sm">
                    시간대{" "}
                    <input
                        className="ml-2 rounded border p-2"
                        aria-label="업무 시간대"
                        value={policy.calendar.timezone}
                        onChange={(e) =>
                            edit({
                                calendar: {
                                    ...policy.calendar,
                                    timezone: e.target.value,
                                },
                            })
                        }
                    />
                </label>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        className="rounded border px-3 py-1.5 text-sm"
                        onClick={() =>
                            edit({
                                calendar: {
                                    ...policy.calendar,
                                    weekly: [1, 2, 3, 4, 5].map((day) => ({
                                        day,
                                        start: "09:00",
                                        end: "18:00",
                                    })),
                                },
                            })
                        }
                    >
                        평일 09:00~18:00
                    </button>
                    <button
                        type="button"
                        className="rounded border px-3 py-1.5 text-sm"
                        onClick={() =>
                            edit({
                                calendar: {
                                    ...policy.calendar,
                                    weekly: [0, 1, 2, 3, 4, 5, 6].map(
                                        (day) => ({
                                            day,
                                            start: "00:00",
                                            end: "24:00",
                                        }),
                                    ),
                                },
                            })
                        }
                    >
                        매일 24시간
                    </button>
                </div>
                <div className="space-y-2">
                    {policy.calendar.weekly.map((row, i) => (
                        <div
                            key={i}
                            className="flex flex-wrap items-center gap-2"
                        >
                            <select
                                className="rounded border p-2"
                                aria-label={`업무 구간 ${i + 1} 요일`}
                                value={row.day}
                                onChange={(e) =>
                                    edit({
                                        calendar: {
                                            ...policy.calendar,
                                            weekly: policy.calendar.weekly.map(
                                                (r, n) =>
                                                    n === i
                                                        ? {
                                                              ...r,
                                                              day: Number(
                                                                  e.target
                                                                      .value,
                                                              ),
                                                          }
                                                        : r,
                                            ),
                                        },
                                    })
                                }
                            >
                                {days.map((d, n) => (
                                    <option key={n} value={n}>
                                        {d}요일
                                    </option>
                                ))}
                            </select>
                            <input
                                aria-label={`업무 구간 ${i + 1} 시작`}
                                className="w-24 rounded border p-2"
                                value={row.start}
                                placeholder="09:00"
                                onChange={(e) =>
                                    edit({
                                        calendar: {
                                            ...policy.calendar,
                                            weekly: policy.calendar.weekly.map(
                                                (r, n) =>
                                                    n === i
                                                        ? {
                                                              ...r,
                                                              start: e.target
                                                                  .value,
                                                          }
                                                        : r,
                                            ),
                                        },
                                    })
                                }
                            />
                            <span>~</span>
                            <input
                                aria-label={`업무 구간 ${i + 1} 종료`}
                                className="w-24 rounded border p-2"
                                value={row.end}
                                placeholder="18:00"
                                onChange={(e) =>
                                    edit({
                                        calendar: {
                                            ...policy.calendar,
                                            weekly: policy.calendar.weekly.map(
                                                (r, n) =>
                                                    n === i
                                                        ? {
                                                              ...r,
                                                              end: e.target
                                                                  .value,
                                                          }
                                                        : r,
                                            ),
                                        },
                                    })
                                }
                            />
                            <button
                                type="button"
                                aria-label={`업무 구간 ${i + 1} 삭제`}
                                className="text-xs underline"
                                onClick={() =>
                                    edit({
                                        calendar: {
                                            ...policy.calendar,
                                            weekly: policy.calendar.weekly.filter(
                                                (_, n) => n !== i,
                                            ),
                                        },
                                    })
                                }
                            >
                                삭제
                            </button>
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    className="rounded border px-3 py-1.5 text-sm"
                    disabled={policy.calendar.weekly.length >= 21}
                    onClick={() =>
                        edit({
                            calendar: {
                                ...policy.calendar,
                                weekly: [
                                    ...policy.calendar.weekly,
                                    { day: 1, start: "09:00", end: "18:00" },
                                ],
                            },
                        })
                    }
                >
                    업무 구간 추가
                </button>
                <p className="text-xs text-muted-foreground">
                    시간은 HH:mm 형식으로 입력합니다. 자정 종료는 24:00, 점심
                    휴게는 같은 요일의 구간을 나눠 설정하세요.
                </p>
                <label className="block text-sm">
                    휴무일{" "}
                    <textarea
                        className="mt-1 block w-full rounded border p-3"
                        rows={3}
                        aria-label="상담 휴무일"
                        placeholder="2026-12-25"
                        value={holidays ?? policy.calendar.holidays.join("\n")}
                        onChange={(e) => {
                            setHolidays(e.target.value);
                            edit({});
                        }}
                    />
                    <span className="text-xs text-muted-foreground">
                        YYYY-MM-DD로 한 줄에 한 날짜. 해당 시간대 기준으로 쉬는
                        날을 입력합니다.
                    </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={policy.showHours}
                        onChange={(e) => edit({ showHours: e.target.checked })}
                    />
                    사이트 상담창에 업무시간 상태 안내
                </label>
                <label className="block text-sm">
                    업무시간 밖 안내 문구{" "}
                    <textarea
                        className="mt-1 block w-full rounded border p-3"
                        aria-label="업무시간 밖 안내 문구"
                        maxLength={500}
                        value={policy.awayMessage}
                        onChange={(e) => edit({ awayMessage: e.target.value })}
                    />
                </label>
                <div className="space-y-3 border-t pt-4">
                    <h3 className="font-semibold">응대 목표</h3>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={policy.enabled}
                            onChange={(e) =>
                                edit({ enabled: e.target.checked })
                            }
                        />
                        새 응대에 목표 적용·초과 알림 허용
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                        {(
                            [
                                ["firstMinutes", "첫 답변"],
                                ["nextMinutes", "추가 답변"],
                                ["resolutionMinutes", "해결"],
                            ] as const
                        ).map(([key, label]) => (
                            <label key={key} className="text-sm">
                                {label} · 업무시간 분{" "}
                                <input
                                    aria-label={`${label} 목표 분`}
                                    type="number"
                                    min={1}
                                    max={43200}
                                    className="mt-1 w-full rounded border p-2"
                                    value={policy[key]}
                                    onChange={(e) =>
                                        edit({ [key]: Number(e.target.value) })
                                    }
                                />
                            </label>
                        ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={policy.includeAi}
                            onChange={(e) =>
                                edit({ includeAi: e.target.checked })
                            }
                        />
                        AI 자동답변도 응답으로 집계
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={policy.pauseOnSnooze}
                            onChange={(e) =>
                                edit({ pauseOnSnooze: e.target.checked })
                            }
                        />
                        보류 중 시간은 목표와 소요시간에서 제외
                    </label>
                    <p className="text-xs text-muted-foreground">
                        목표를 끄면 초과 알림 검사를 중지합니다. 기존 응대의
                        기록은 남습니다. 이메일은 공급자 접수가 확인된 답장부터
                        응답으로 집계합니다.
                    </p>
                </div>
            </fieldset>
            {!data.workerEnabled && (
                <p role="status" className="rounded border p-3 text-sm">
                    자동 초과 알림은 서버에서 꺼져 있습니다. 목표·성과는
                    화면에서 확인할 수 있고, 관리자가 자동 검사를 켜면 알림도
                    받습니다.
                </p>
            )}
            {canManage && (
                <div className="flex gap-3">
                    <button
                        disabled={busy}
                        className="rounded bg-violet-600 px-4 py-2 text-white"
                    >
                        {busy ? "저장 중…" : "운영 설정 저장"}
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        className="rounded border px-3"
                        onClick={() => {
                            setDraft(null);
                            setHolidays(null);
                            void mutate();
                        }}
                    >
                        최신 설정 불러오기
                    </button>
                </div>
            )}
        </form>
    );
}
