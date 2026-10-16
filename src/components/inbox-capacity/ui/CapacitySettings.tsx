"use client";
import { useState } from "react";
import useSWR from "swr";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { InboxAudit } from "@/components/inbox/ui/InboxAudit";
import { loadCapacity, saveCapacity, dispatchCapacity } from "../api";
import type { CapacityPage } from "../types";
function AgentLimit({
    agent,
    channelId,
    refresh,
}: {
    agent: CapacityPage["agents"][number];
    channelId: number;
    refresh: () => Promise<unknown>;
}) {
    const [edit, setEdit] = useState<{ value: string; version: number } | null>(
            null,
        ),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const value =
        edit?.value ??
        (agent.maxOpenConversations == null
            ? ""
            : String(agent.maxOpenConversations));
    return (
        <article className="space-y-2 rounded-xl border p-3">
            <strong className="text-sm">{agent.name}</strong>
            <p className="text-xs text-muted-foreground">
                진행중 {agent.openConversations}건 · 현재 한도{" "}
                {agent.maxOpenConversations === null
                    ? "무제한"
                    : `${agent.maxOpenConversations}건`}
            </p>
            <label className="block text-xs">
                자동 배정 한도
                <input
                    aria-label={`${agent.name} 자동 배정 한도`}
                    className="ml-2 rounded border p-2"
                    type="number"
                    min={0}
                    max={1000}
                    placeholder="무제한"
                    value={value}
                    disabled={busy}
                    onChange={(e) =>
                        setEdit({
                            value: e.target.value,
                            version: edit?.version ?? agent.version,
                        })
                    }
                />
            </label>
            {edit && edit.version !== agent.version && (
                <p className="text-xs text-amber-800">
                    다른 창에서 응대 상태 또는 한도를 변경했습니다. 작성한 값은
                    유지했습니다.
                </p>
            )}
            {error && (
                <p role="alert" className="text-xs text-red-700">
                    {error}
                </p>
            )}
            <button
                disabled={busy}
                aria-label={`${agent.name} 한도 저장`}
                className="rounded border px-3 py-1 text-xs"
                onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                        const limit =
                            value.trim() === "" ? null : Number(value);
                        if (
                            limit !== null &&
                            (!Number.isInteger(limit) ||
                                limit < 0 ||
                                limit > 1000)
                        )
                            throw new Error(
                                "0~1,000 또는 빈칸(무제한)으로 입력해주세요.",
                            );
                        await saveCapacity({
                            channelId,
                            userId: agent.id,
                            version: edit?.version ?? agent.version,
                            maxOpenConversations: limit,
                        });
                        await refresh();
                        setEdit(null);
                    } catch (e) {
                        setError((e as Error).message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                한도 저장
            </button>
            {(error || (edit && edit.version !== agent.version)) && (
                <button
                    disabled={busy}
                    className="ml-2 text-xs underline"
                    onClick={async () => {
                        setBusy(true);
                        try {
                            await refresh();
                            setEdit(null);
                            setError("");
                        } catch (e) {
                            setError((e as Error).message);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    최신 설정 불러오기
                </button>
            )}
        </article>
    );
}
export function CapacitySettings({
    channelId,
    name,
    onClose,
    onAssigned,
}: {
    channelId: number;
    name: string;
    onClose: () => void;
    onAssigned: () => Promise<unknown>;
}) {
    const query = useSWR(
        `/api/inbox-capacity?channelId=${channelId}`,
        loadCapacity,
        { refreshInterval: 10000 },
    );
    const [busy, setBusy] = useState(false),
        [result, setResult] = useState(""),
        [error, setError] = useState("");
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{name} · 자동 배정 수용량</DialogTitle>
                    <DialogDescription>
                        이 사업의 모든 팀에서 맡은 진행중 상담을 합산합니다.
                        빈칸은 무제한, 0은 새 자동 배정 중지입니다. 기존 담당은
                        유지하며 수동 지정은 한도를 넘길 수 있습니다.
                    </DialogDescription>
                </DialogHeader>
                {(query.error || error) && (
                    <p role="alert" className="text-sm text-red-700">
                        {query.error?.message || error}
                    </p>
                )}
                {!query.data && <p>불러오는 중…</p>}
                {query.data?.agents.map((a) => (
                    <AgentLimit
                        key={a.id}
                        agent={a}
                        channelId={channelId}
                        refresh={() => query.mutate()}
                    />
                ))}
                <div className="space-y-2 rounded-xl bg-muted p-3 text-xs">
                    <p>
                        수동 팀·종료/보류·이미 개인 담당이 있는 상담은
                        재배정하지 않습니다. 대기열 재처리는 한 번에 최대50건을
                        확인하며, 막힌 팀 뒤의 다른 상담도 다음 회차에서
                        확인합니다.
                    </p>
                    <p>
                        {query.data?.workerEnabled
                            ? "서버의 대기열 자동 재처리가 켜져 있습니다."
                            : "서버의 대기열 자동 재처리는 꺼져 있습니다. 아래 버튼으로 직접 실행할 수 있습니다."}
                    </p>
                    <button
                        className="rounded border bg-background px-3 py-2"
                        disabled={busy || !query.data}
                        onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                                const r = await dispatchCapacity(channelId);
                                setResult(
                                    `${r.examined}건 확인 · ${r.assigned}건 배정 · ${r.waiting}건 대기`,
                                );
                                await Promise.all([
                                    query.mutate(),
                                    onAssigned(),
                                ]);
                            } catch (e) {
                                setError((e as Error).message);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        대기 상담 배정
                    </button>
                    {result && <p role="status">{result}</p>}
                </div>
                <InboxAudit url={`/api/inbox/channels/${channelId}/audit`} />
            </DialogContent>
        </Dialog>
    );
}
