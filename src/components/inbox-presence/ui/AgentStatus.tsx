"use client";
import { useState } from "react";
import type { useAgentPresence } from "../hooks/useAgentPresence";
export function AgentStatus({
    presence,
    userId,
    canRespond,
}: {
    presence: ReturnType<typeof useAgentPresence>;
    userId: string;
    canRespond: boolean;
}) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const self = presence.agents.find((a) => a.id === userId);
    return (
        <div className="max-w-xs text-xs">
            {canRespond && (
                <label className="flex items-center gap-2 rounded-xl border px-3 py-2">
                    <span
                        className={`h-2 w-2 rounded-full ${self?.online && self.state === "available" ? "bg-emerald-500" : "bg-amber-400"}`}
                    />
                    내 응대 상태
                    <select
                        aria-label="내 응대 상태"
                        value={presence.data?.me.state ?? "away"}
                        disabled={busy || !presence.data || !!presence.error}
                        onChange={async (e) => {
                            setBusy(true);
                            setError("");
                            try {
                                await presence.update(
                                    e.target.value as "available" | "away",
                                );
                            } catch (err) {
                                setError((err as Error).message);
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        <option value="away">자리 비움</option>
                        <option value="available">응대 가능</option>
                    </select>
                </label>
            )}
            {(error || presence.error || presence.connectionError) && (
                <p role="status" className="mt-1 text-amber-800">
                    {error ||
                        presence.error?.message ||
                        presence.connectionError}{" "}
                    접속 상태를 다시 확인하고 있습니다.
                </p>
            )}
        </div>
    );
}
