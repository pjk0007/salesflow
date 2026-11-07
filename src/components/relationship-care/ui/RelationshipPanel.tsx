"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TIERS, TIER_LABEL, DEFAULT_CADENCE } from "@/lib/relationship-care/rules";
import { careAction, saveCare } from "../api";
import { useCare } from "../hooks/useRelationship";
import type { Care, Channel, Tier } from "../types";
import { lastTouchText, seoulToday } from "../utils/links";
type Member = { id: string; name: string; workspaceIds: number[] };
type Form = {
    tier: Tier;
    cadenceDays: string;
    ownerUserId: string;
    metPlace: string;
    metOn: string;
    memoryNote: string;
    importantDates: { label: string; monthDay: string }[];
    lastTouchOn: string;
};
const toForm = (care: Care | null, userId: string): Form => ({
    tier: care?.tier ?? "c",
    cadenceDays: care?.cadenceDays ? String(care.cadenceDays) : "",
    ownerUserId: care ? (care.ownerUserId ?? "") : userId,
    metPlace: care?.metPlace ?? "",
    metOn: care?.metOn ?? "",
    memoryNote: care?.memoryNote ?? "",
    importantDates: care?.importantDates ?? [],
    lastTouchOn: care?.lastTouchAt
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(care.lastTouchAt))
        : "",
});
/** 고객 상세의 관계 관리 칸(등급·주기·담당·만난 곳·기억 메모·기념일·마지막 연락일) */
export function RelationshipPanel({
    workspaceId,
    contactId,
    userId,
    members,
    canRespond,
}: {
    workspaceId: number;
    contactId: string;
    userId: string;
    members: Member[];
    canRespond: boolean;
}) {
    const state = useCare(workspaceId, contactId);
    const care = state.data?.care ?? null;
    const [form, setForm] = useState<Form>(() => toForm(null, userId));
    const [busy, setBusy] = useState(false);
    const [logChannel, setLogChannel] = useState<Channel>("call");
    const [newDate, setNewDate] = useState({ label: "", monthDay: "" });
    useEffect(() => {
        if (state.data) setForm(toForm(state.data.care, userId));
    }, [state.data, userId]);
    const staff = members.filter((m) => m.workspaceIds.includes(workspaceId));
    async function run(action: () => Promise<unknown>, done: string) {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            toast.success(done);
            await state.mutate();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const save = () =>
        run(
            () =>
                saveCare(contactId, {
                    workspaceId,
                    ...(care ? { version: care.version } : {}),
                    tier: form.tier,
                    cadenceDays: form.cadenceDays ? Number(form.cadenceDays) : null,
                    ownerUserId: form.ownerUserId || null,
                    metPlace: form.metPlace.trim() || null,
                    metOn: form.metOn || null,
                    memoryNote: form.memoryNote,
                    importantDates: form.importantDates,
                    lastTouchOn: form.lastTouchOn || null,
                }),
            care ? "관계 관리 설정을 저장했습니다." : "관계 관리를 시작했습니다.",
        );
    const input = "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
    return (
        <section className="mt-8 border-t pt-5" aria-label="관계 관리">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">관계 관리</h3>
                {care && (
                    <p className="text-xs text-muted-foreground">
                        {care.statusLabel} · {lastTouchText(care.daysSinceTouch)} ·{" "}
                        {care.welcomeDeadline
                            ? `첫 인사 기한 ${new Date(care.welcomeDeadline).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric" })}`
                            : `다음 점검 ${new Date(care.nextDueAt).toLocaleDateString("ko-KR")}`}{" "}
                        ({care.cadence}일 주기)
                    </p>
                )}
            </div>
            {state.error && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                    {state.error.message}
                </p>
            )}
            {state.isLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">불러오는 중…</p>
            ) : (
                <div className="mt-3 space-y-3 text-sm">
                    {!care && (
                        <p className="text-muted-foreground">
                            이 고객을 점검 주기로 챙깁니다. 마지막 연락일을 비워 두면 첫 인사 카드부터 시작합니다.
                        </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <label>
                            <span className="text-xs text-muted-foreground">점검 등급</span>
                            <select
                                className={input}
                                value={form.tier}
                                disabled={!canRespond}
                                onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}
                            >
                                {TIERS.map((t) => (
                                    <option key={t} value={t}>
                                        {TIER_LABEL[t]} · {DEFAULT_CADENCE[t]}일
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span className="text-xs text-muted-foreground">개별 주기(일, 비우면 등급 기본값)</span>
                            <input
                                type="number"
                                min={1}
                                max={730}
                                className={input}
                                value={form.cadenceDays}
                                disabled={!canRespond}
                                onChange={(e) => setForm({ ...form, cadenceDays: e.target.value })}
                            />
                        </label>
                        <label>
                            <span className="text-xs text-muted-foreground">담당자</span>
                            <select
                                className={input}
                                value={form.ownerUserId}
                                disabled={!canRespond}
                                onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
                            >
                                <option value="">담당자 없음</option>
                                {staff.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span className="text-xs text-muted-foreground">마지막 연락일</span>
                            <input
                                type="date"
                                max={seoulToday()}
                                className={input}
                                value={form.lastTouchOn}
                                disabled={!canRespond}
                                onChange={(e) => setForm({ ...form, lastTouchOn: e.target.value })}
                            />
                        </label>
                        <label>
                            <span className="text-xs text-muted-foreground">만난 곳</span>
                            <input
                                className={input}
                                maxLength={200}
                                value={form.metPlace}
                                disabled={!canRespond}
                                onChange={(e) => setForm({ ...form, metPlace: e.target.value })}
                            />
                        </label>
                        <label>
                            <span className="text-xs text-muted-foreground">만난 날</span>
                            <input
                                type="date"
                                className={input}
                                value={form.metOn}
                                disabled={!canRespond}
                                onChange={(e) => setForm({ ...form, metOn: e.target.value })}
                            />
                        </label>
                    </div>
                    <label className="block">
                        <span className="text-xs text-muted-foreground">기억 메모(가족·취미·관심사·다음에 물어볼 것)</span>
                        <textarea
                            className={`${input} h-20`}
                            maxLength={2000}
                            value={form.memoryNote}
                            disabled={!canRespond}
                            onChange={(e) => setForm({ ...form, memoryNote: e.target.value })}
                        />
                    </label>
                    <div>
                        <span className="text-xs text-muted-foreground">기념일(아는 경우만)</span>
                        <ul className="mt-1 flex flex-wrap gap-2">
                            {form.importantDates.map((d, i) => (
                                <li key={`${d.label}-${d.monthDay}-${i}`} className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs">
                                    {d.label} {d.monthDay.replace("-", "월 ")}일
                                    {canRespond && (
                                        <button
                                            aria-label={`${d.label} 삭제`}
                                            className="ml-1 text-muted-foreground"
                                            onClick={() =>
                                                setForm({
                                                    ...form,
                                                    importantDates: form.importantDates.filter((_, j) => j !== i),
                                                })
                                            }
                                        >
                                            ×
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {canRespond && form.importantDates.length < 10 && (
                            <div className="mt-2 flex gap-2">
                                <input
                                    aria-label="기념일 이름"
                                    className="w-28 rounded-lg border bg-background px-2 py-1 text-xs"
                                    placeholder="예: 생일"
                                    maxLength={30}
                                    value={newDate.label}
                                    onChange={(e) => setNewDate({ ...newDate, label: e.target.value })}
                                />
                                <input
                                    aria-label="기념일 날짜(월-일)"
                                    className="w-24 rounded-lg border bg-background px-2 py-1 text-xs"
                                    placeholder="MM-DD"
                                    maxLength={5}
                                    value={newDate.monthDay}
                                    onChange={(e) => setNewDate({ ...newDate, monthDay: e.target.value })}
                                />
                                <button
                                    className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
                                    disabled={!newDate.label.trim() || !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(newDate.monthDay)}
                                    onClick={() => {
                                        setForm({
                                            ...form,
                                            importantDates: [...form.importantDates, { label: newDate.label.trim(), monthDay: newDate.monthDay }],
                                        });
                                        setNewDate({ label: "", monthDay: "" });
                                    }}
                                >
                                    추가
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            className="rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50"
                            disabled={!canRespond || busy}
                            onClick={() => void save()}
                        >
                            {care ? "관계 관리 저장" : "관계 관리 시작"}
                        </button>
                        {care && (
                            <>
                                <span className="flex items-center gap-1 rounded-lg border px-1">
                                    <select
                                        aria-label="연락한 방법"
                                        className="bg-transparent py-2 text-sm"
                                        value={logChannel}
                                        onChange={(e) => setLogChannel(e.target.value as Channel)}
                                    >
                                        <option value="call">통화</option>
                                        <option value="meeting">만남</option>
                                        <option value="sms">문자</option>
                                        <option value="kakao">카카오톡</option>
                                        <option value="email">메일</option>
                                    </select>
                                    <button
                                        className="px-2 py-2 disabled:opacity-50"
                                        disabled={!canRespond || busy}
                                        onClick={() =>
                                            void run(
                                                () => careAction(workspaceId, contactId, "logged", { channel: logChannel }),
                                                "연락을 기록했습니다.",
                                            )
                                        }
                                    >
                                        연락 기록
                                    </button>
                                </span>
                                <button
                                    className="rounded-lg border px-3 py-2 disabled:opacity-50"
                                    disabled={!canRespond || busy}
                                    onClick={() =>
                                        void run(() => careAction(workspaceId, contactId, "reply"), "답장 받음을 기록했습니다.")
                                    }
                                >
                                    답장 받음
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
