"use client";
import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { InboxAudit } from "@/components/inbox/ui/InboxAudit";
import type { InboxBootstrap, InboxChannel } from "@/components/inbox/types";
import { useInboxTeams } from "../hooks/useInboxTeams";
import type { RoutingTeam } from "../types";
import { toast } from "sonner";
type Form = {
    id?: string;
    version?: number;
    name: string;
    description: string;
    autoAssign: boolean;
    requireAvailable: boolean;
    enabled: boolean;
    memberIds: string[];
};
const fresh = (): Form => ({
    name: "",
    description: "",
    autoAssign: false,
    requireAvailable: false,
    enabled: true,
    memberIds: [],
});
const editForm = (t: RoutingTeam): Form => ({
    id: t.id,
    version: t.version,
    name: t.name,
    description: t.description,
    autoAssign: t.autoAssign,
    requireAvailable: t.requireAvailable ?? false,
    enabled: t.enabled,
    memberIds: [...t.memberIds],
});
export function TeamSettings({
    channel,
    bootstrap,
    onClose,
    onSaved,
}: {
    channel: InboxChannel;
    bootstrap: InboxBootstrap;
    onClose: () => void;
    onSaved: () => Promise<unknown>;
}) {
    const teams = useInboxTeams(channel.id),
        [form, setForm] = useState<Form>(fresh),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [labels, setLabels] = useState<Record<string, string>>({});
    const active = bootstrap.members.filter((m) =>
        m.workspaceIds.includes(channel.workspaceId),
    );
    const candidates = [
        ...active.map((m) => ({ ...m, eligible: true })),
        ...form.memberIds
            .filter((id) => !active.some((m) => m.id === id))
            .map((id) => ({
                id,
                name: labels[id] ?? "기존 팀원",
                eligible: false,
            })),
    ];
    function choose(team: RoutingTeam) {
        setForm(editForm(team));
        setLabels(Object.fromEntries(team.members.map((m) => [m.id, m.name])));
        setError("");
    }
    async function save() {
        setBusy(true);
        setError("");
        try {
            const saved = await teams.save(form);
            choose(saved);
            await onSaved();
            toast.success("상담팀을 저장했습니다.");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function reload() {
        setBusy(true);
        try {
            const rows = await teams.mutate();
            const current = rows?.find((t) => t.id === form.id);
            if (current) choose(current);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{channel.name} · 상담팀</DialogTitle>
                    <DialogDescription>
                        팀별 대기열과 담당 배정을 관리합니다. 팀원은 기존 사업
                        응대 권한을 사용합니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-5 md:grid-cols-[200px_1fr]">
                    <nav aria-label="상담팀 목록" className="space-y-2">
                        <button
                            disabled={busy}
                            className="w-full rounded-lg border px-3 py-2 text-sm"
                            onClick={() => {
                                setForm(fresh());
                                setLabels({});
                                setError("");
                            }}
                        >
                            새 상담팀
                        </button>
                        {teams.error && (
                            <p role="alert" className="text-sm text-red-600">
                                {teams.error.message}
                            </p>
                        )}
                        {!teams.data && <p>불러오는 중…</p>}
                        {teams.data?.map((t) => (
                            <button
                                disabled={busy}
                                key={t.id}
                                aria-label={`${t.name} 팀 편집`}
                                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${form.id === t.id ? "bg-violet-50" : ""}`}
                                onClick={() => choose(t)}
                            >
                                <strong>{t.name}</strong>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                    {t.enabled
                                        ? `${t.members.filter((m) => m.eligible).length}명 응대 권한`
                                        : "보관됨"}{" "}
                                    · {t.autoAssign ? "자동 배정" : "수동 배정"}
                                </span>
                            </button>
                        ))}
                    </nav>
                    <form
                        className="space-y-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void save();
                        }}
                    >
                        <fieldset disabled={busy} className="space-y-4">
                            <label className="block text-sm">
                                팀 이름
                                <input
                                    required
                                    maxLength={100}
                                    aria-label="팀 이름"
                                    value={form.name}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            name: e.target.value,
                                        })
                                    }
                                    className="mt-1 w-full rounded-lg border px-3 py-2"
                                />
                            </label>
                            <label className="block text-sm">
                                담당 업무
                                <textarea
                                    maxLength={500}
                                    aria-label="담당 업무"
                                    value={form.description}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            description: e.target.value,
                                        })
                                    }
                                    className="mt-1 w-full rounded-lg border px-3 py-2"
                                />
                            </label>
                            <fieldset className="space-y-2">
                                <legend className="mb-2 text-sm font-medium">
                                    팀원
                                </legend>
                                {candidates.map((m) => (
                                    <label
                                        key={m.id}
                                        className="flex items-center gap-2 text-sm"
                                    >
                                        <input
                                            type="checkbox"
                                            aria-label={`${m.name} 팀원 선택`}
                                            checked={form.memberIds.includes(
                                                m.id,
                                            )}
                                            disabled={
                                                !m.eligible &&
                                                !form.memberIds.includes(m.id)
                                            }
                                            onChange={(e) =>
                                                setForm({
                                                    ...form,
                                                    memberIds: e.target.checked
                                                        ? [
                                                              ...form.memberIds,
                                                              m.id,
                                                          ]
                                                        : form.memberIds.filter(
                                                              (id) =>
                                                                  id !== m.id,
                                                          ),
                                                })
                                            }
                                        />
                                        {m.name}
                                        {!m.eligible &&
                                            " · 현재 응대 권한 없음"}
                                    </label>
                                ))}
                                {!candidates.length && (
                                    <p className="text-xs text-muted-foreground">
                                        직원 권한에서 이 사업의 응대 권한을 먼저
                                        배정해주세요.
                                    </p>
                                )}
                            </fieldset>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    aria-label="팀 자동 배정"
                                    checked={form.autoAssign}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            autoAssign: e.target.checked,
                                        })
                                    }
                                />
                                팀으로 이관할 때 자동으로 담당자 배정
                            </label>
                            <p className="text-xs text-muted-foreground">
                                응대 가능한 팀원의 진행중 상담이 적은 순서로
                                배정합니다. 응대할 팀원이 없으면 팀 대기열에
                                남습니다.
                            </p>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    aria-label="접속 응대 가능 직원만 배정"
                                    disabled={!form.autoAssign}
                                    checked={form.requireAvailable}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            requireAvailable: e.target.checked,
                                        })
                                    }
                                />
                                접속 중이며 응대 가능한 직원에게만 자동 배정
                            </label>
                            <p className="text-xs text-muted-foreground">
                                켜면 자리 비움·접속 종료 직원을 제외합니다.
                                조건에 맞는 직원이 없으면 팀 대기열에 남습니다.
                                끄면 접속 상태와 관계없이 기존 응대 권한을
                                기준으로 배정합니다.
                            </p>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    aria-label="팀 사용"
                                    checked={form.enabled}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            enabled: e.target.checked,
                                        })
                                    }
                                />
                                팀 사용
                            </label>
                            <p className="text-xs text-muted-foreground">
                                사용을 끄면 보관합니다. 기존 상담은 유지되며 새
                                팀 배정은 중단됩니다.
                            </p>
                            {error && (
                                <div
                                    role="alert"
                                    className="space-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"
                                >
                                    <p>{error}</p>
                                    {form.id && (
                                        <button
                                            type="button"
                                            className="underline"
                                            onClick={() => void reload()}
                                        >
                                            최신 설정 불러오기
                                        </button>
                                    )}
                                </div>
                            )}
                            <button
                                disabled={busy || !form.name.trim()}
                                className="rounded-lg bg-[#635BFF] px-4 py-2 text-sm text-white disabled:opacity-50"
                            >
                                {busy ? "저장 중…" : "상담팀 저장"}
                            </button>
                        </fieldset>
                    </form>
                </div>
                <InboxAudit url={`/api/inbox/channels/${channel.id}/audit`} />
            </DialogContent>
        </Dialog>
    );
}
