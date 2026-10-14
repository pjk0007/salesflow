"use client";
import { useState } from "react";
import { toast } from "sonner";
import { controlGoogleConnection } from "../api";
import { useGoogleConnection } from "../hooks/useGoogleConnection";
import type { EmailMailbox } from "../types";
const displayTime = (value?: string | null) =>
    value ? new Date(value).toLocaleString("ko-KR") : "아직 없음";
export function GoogleConnectionPanel({
    box,
    onChange,
}: {
    box: EmailMailbox;
    onChange: () => Promise<unknown>;
}) {
    const { data, error, mutate } = useGoogleConnection(box.id),
        [days, setDays] = useState(0),
        [busy, setBusy] = useState(false);
    const act = async (action: "connect" | "disconnect" | "retry") => {
        setBusy(true);
        try {
            const result = await controlGoogleConnection(
                box.id,
                action === "connect"
                    ? { action, version: box.version, lookbackDays: days }
                    : action === "disconnect"
                      ? { action, version: data!.connection.version }
                      : { action },
            );
            if (result.authorizationUrl) {
                window.location.assign(result.authorizationUrl);
                return;
            }
            await Promise.all([mutate(), onChange()]);
            if (action === "retry")
                toast.success(`${result.retried ?? 0}건을 다시 가져옵니다.`);
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    if (error)
        return (
            <p role="alert" className="text-sm">
                메일 계정 상태를 불러오지 못했습니다.{" "}
                <button onClick={() => void mutate()}>다시 불러오기</button>
            </p>
        );
    if (!data) return <p className="text-sm">Google 연결 확인 중…</p>;
    const connected = data.connection.status === "connected";
    return (
        <section
            aria-label={`${box.name} Google 연결`}
            className="space-y-3 border-t pt-3 text-sm"
        >
            <h4 className="font-medium">
                Google 계정 ·{" "}
                {connected
                    ? "연결됨"
                    : data.connection.status === "reconnect"
                      ? "재연결 필요"
                      : "미연결"}
            </h4>
            {!data.configured && (
                <p>
                    관리자가 Google 앱 설정을 등록하면 여기서 계정을 연결할 수
                    있습니다.
                </p>
            )}
            {data.configured && (
                <>
                    <label className="block">
                        연결할 때 가져올 메일
                        <select
                            aria-label={`${box.name} 수신 시작 범위`}
                            className="mt-1 w-full rounded border p-2"
                            value={days}
                            disabled={busy}
                            onChange={(e) => setDays(Number(e.target.value))}
                        >
                            <option value={0}>연결을 시작한 이후</option>
                            <option value={7}>최근 7일부터</option>
                            <option value={30}>최근 30일부터</option>
                        </select>
                    </label>
                    <button
                        className="rounded-lg border px-3 py-2"
                        disabled={busy}
                        onClick={() => void act("connect")}
                    >
                        {connected
                            ? "Google 계정 다시 연결"
                            : "Google 계정 연결"}
                    </button>
                    <p className="text-xs text-muted-foreground">
                        등록한 주소와 같은 계정을 선택하고 메일 읽기·발송을
                        승인해주세요. 연결 후 수신·발송 켜기를 눌러야 자동
                        처리가 시작됩니다. 다시 연결하면 기존 발송 대기 답장은
                        취소됩니다.
                    </p>
                </>
            )}
            {connected && (
                <>
                    <p>
                        {data.workerEnabled
                            ? box.enabled
                                ? "새 문의·첨부·답장을 자동 처리 중"
                                : "수신·발송을 켜면 자동 처리를 시작합니다."
                            : "계정은 연결됐습니다. 관리자가 서버의 자동 메일 처리를 켜야 새 문의와 답장을 처리합니다."}
                    </p>
                    <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                        <dt>마지막 메일 확인</dt>
                        <dd>{displayTime(data.connection.lastPollAt)}</dd>
                        <dt>마지막 가져오기</dt>
                        <dd>{displayTime(data.connection.lastProcessedAt)}</dd>
                        <dt>가져오기 대기 / 완료</dt>
                        <dd>
                            {data.counts.pending} / {data.counts.done}
                        </dd>
                    </dl>
                </>
            )}
            {data.connection.errorCode && (
                <p role="status">
                    {data.connection.status === "reconnect"
                        ? "Google 권한이나 계정 설정을 확인하고 다시 연결해주세요."
                        : "메일 처리에 일시적인 문제가 있어 자동 재시도하고 있습니다."}
                </p>
            )}
            {data.counts.failed > 0 && (
                <p role="alert">
                    가져오기 확인 필요 {data.counts.failed}건{" "}
                    {connected && (
                        <button
                            className="underline"
                            disabled={busy}
                            onClick={() => void act("retry")}
                        >
                            실패한 메일 다시 가져오기
                        </button>
                    )}
                </p>
            )}
            {data.connection.status !== "disconnected" && (
                <button
                    className="rounded border px-3 py-2"
                    disabled={busy}
                    onClick={() => void act("disconnect")}
                >
                    Google 연결 해제·수신 발송 중지
                </button>
            )}
        </section>
    );
}
