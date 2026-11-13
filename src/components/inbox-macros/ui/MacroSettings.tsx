"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import { SettingsSection } from "@/components/inbox/ui/SettingsSection";
import { cn } from "@/lib/utils";
import { macrosUrl, useMacros } from "../hooks/useMacros";
import type { InboxMacro } from "../types";

type Draft = { id?: number; name: string; body: string };

/** 상담 설정 › 매크로 — 사업부별로 #이름 문구를 추가·수정·삭제한다 */
export function MacroSettings({ workspaceId, canManage }: { workspaceId: number; canManage: boolean }) {
    const { data, error, mutate } = useMacros(workspaceId);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const url = macrosUrl(workspaceId);

    async function save() {
        if (!draft) return;
        setBusy(true);
        try {
            await inboxWrite<InboxMacro>(url, draft);
            await mutate();
            setDraft(null);
            toast.success("매크로를 저장했습니다.");
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    }

    const editor = draft && (
        <div className="space-y-3 rounded-lg border border-border/40 bg-muted/30 p-4">
            <label className="block space-y-1.5">
                <span className="text-sm font-medium">이름</span>
                <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">#</span>
                    <Input
                        autoFocus
                        className="border-border/70 bg-background"
                        value={draft.name}
                        maxLength={50}
                        placeholder="가입승인"
                        onChange={(e) => setDraft({ ...draft, name: e.target.value.replace(/[\s#]/g, "") })}
                    />
                </div>
            </label>
            <label className="block space-y-1.5">
                <span className="text-sm font-medium">내용</span>
                <Textarea
                    className="min-h-40 border-border/70 bg-background"
                    value={draft.body}
                    maxLength={5000}
                    placeholder="고객에게 보낼 문구"
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
            </label>
            <div className="flex justify-end gap-2">
                <Button variant="outline" className="border-border/70" disabled={busy} onClick={() => setDraft(null)}>
                    취소
                </Button>
                <Button disabled={busy || !draft.name.trim() || !draft.body.trim()} onClick={() => void save()}>
                    {busy ? "저장 중…" : "저장"}
                </Button>
            </div>
        </div>
    );

    return (
        <SettingsSection
            title="매크로"
            description="답장 입력창에서 #을 치면 여기 등록한 문구를 골라 바로 넣을 수 있어요. 사업마다 따로 관리해요."
        >
            {confirmationDialog}
            {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
            {!data && !error && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
            {data && (
                <div className="space-y-3">
                    {canManage && !draft?.id && (draft ? editor : (
                        <Button variant="outline" className="border-border/70" onClick={() => setDraft({ name: "", body: "" })}>
                            <Plus className="h-4 w-4" />
                            매크로 추가
                        </Button>
                    ))}
                    {!data.length && !draft && <p className="text-sm text-muted-foreground">아직 등록한 매크로가 없어요.</p>}
                    {!!data.length && <ul className="divide-y divide-border/40 rounded-lg border border-border/40">
                        {data.map((m) =>
                            draft?.id === m.id ? (
                                <li key={m.id} className="p-3">{editor}</li>
                            ) : (
                                <li key={m.id} className="flex gap-4 p-4">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold">#{m.name}</p>
                                        <p className={cn("mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground")}>{m.body}</p>
                                    </div>
                                    {canManage && (
                                        <div className="flex shrink-0 items-start gap-1">
                                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft({ id: m.id, name: m.name, body: m.body })}>
                                                수정
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-700 hover:text-red-700"
                                                disabled={busy}
                                                onClick={() =>
                                                    confirm({
                                                        title: `#${m.name} 매크로를 삭제할까요?`,
                                                        description: "삭제하면 되돌릴 수 없어요.",
                                                        onConfirm: async () => {
                                                            await inboxRequest(`${url}&id=${m.id}`, { method: "DELETE" });
                                                            await mutate();
                                                        },
                                                    })
                                                }
                                            >
                                                삭제
                                            </Button>
                                        </div>
                                    )}
                                </li>
                            ),
                        )}
                    </ul>}
                </div>
            )}
        </SettingsSection>
    );
}
