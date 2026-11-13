"use client";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/inbox/ui/SettingsSection";
import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import { useStaffAccess } from "../hooks/useStaffAccess";

/**
 * 상담 설정 › 상담 담당자 — 이 사업에서 상담을 맡을 직원만 "상담권한"을 켠다 (조직 관리자 여부와 상관없이).
 * 켜진 직원만 담당자로 지정되고 답장하며, 담당자 없는 문의 알림을 받는다.
 */
export function ResponderToggles({ workspaceId, canManage, onSaved }: { workspaceId: number; canManage: boolean; onSaved: () => Promise<unknown> }) {
    const roster = useStaffAccess(workspaceId);
    const url = `/api/inbox/responders?workspaceId=${workspaceId}`;
    const responders = useSWR<string[]>(url, inboxRequest);
    const [busy, setBusy] = useState<string | null>(null);
    const members = (roster.data?.members ?? []).filter((m) => m.active === 1);
    const error = roster.error ?? responders.error;
    return (
        <SettingsSection title="상담 담당자" description="이 사업의 상담을 맡을 직원의 상담권한을 켜주세요. 켜진 직원만 담당자로 지정되고 답장할 수 있으며, 담당자 없는 문의 알림을 받아요.">
            {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
            {(!roster.data || !responders.data) && !error && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
            {roster.data && responders.data && (
                <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                        <tr className="border-b border-border/40">
                            <th className="py-3 font-medium">직원</th>
                            <th className="font-medium">이메일</th>
                            <th className="w-24 font-medium">상담권한</th>
                        </tr>
                    </thead>
                    <tbody>
                        {members.map((m) => (
                            <tr key={m.id} className="border-b border-border/40 last:border-0">
                                <td className="py-3 font-medium">{m.name}</td>
                                <td className="text-muted-foreground">{m.email}</td>
                                <td>
                                    <Switch
                                        aria-label={`${m.name} 상담권한`}
                                        checked={responders.data!.includes(m.id)}
                                        disabled={!canManage || busy !== null}
                                        onCheckedChange={async (enabled) => {
                                            setBusy(m.id);
                                            try {
                                                // 이 사업을 볼 수도 없는 일반 직원은 응대할 수 있게 사업 접근도 같이 연다
                                                if (enabled && m.orgRole === "member" && m.role !== "agent" && m.role !== "manager")
                                                    await roster.save(m.id, "agent", m.version);
                                                await inboxWrite(url, { userId: m.id, enabled });
                                                await Promise.all([responders.mutate(), roster.mutate()]);
                                                await onSaved();
                                                toast.success(enabled ? `${m.name}님 상담권한을 켰어요.` : `${m.name}님 상담권한을 껐어요.`);
                                            } catch (e) {
                                                toast.error((e as Error).message);
                                                await Promise.all([responders.mutate(), roster.mutate()]);
                                            } finally {
                                                setBusy(null);
                                            }
                                        }}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </SettingsSection>
    );
}
