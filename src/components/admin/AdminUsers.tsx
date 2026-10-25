"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, Shield, ShieldOff, UserX, UserCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { defaultFetcher, apiRequest } from "@/lib/swr-fetcher";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { useSession } from "@/contexts/SessionContext";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export default function AdminUsers() {
    const { user: me } = useSession();
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const pendingRef = useRef(false);
    const { confirm, confirmationDialog } = useAsyncConfirm();

    const query = new URLSearchParams({ search, page: String(page), limit: "20" });
    const { data, error, isLoading, mutate } = useSWR(`/api/admin/users?${query}`, defaultFetcher);
    const userList = data?.data || [];
    const pagination = data?.pagination;

    async function handleUpdate(userId: string, updates: { isActive?: number; isSuperAdmin?: number }) {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPendingId(userId);
        try {
            await apiRequest(`/api/admin/users/${userId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });
            toast.success("변경되었습니다.");
            void mutate();
        } finally {
            pendingRef.current = false;
            setPendingId(null);
        }
    }

    if (error && !data) return <QueryErrorState error={error} onRetry={() => mutate()} />;

    return (
        <div className="space-y-4">
            {confirmationDialog}
            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="이름 또는 이메일 검색..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9"
                />
            </div>

            <div className="bg-white rounded-xl border overflow-hidden">
                <Table tabIndex={0} aria-label="사용자 목록" className="w-full text-sm">
                    <TableHeader className="bg-slate-50 text-left">
                        <TableRow>
                            <TableHead className="px-4 py-3 font-medium">이름</TableHead>
                            <TableHead className="px-4 py-3 font-medium">이메일</TableHead>
                            <TableHead className="px-4 py-3 font-medium">조직 수</TableHead>
                            <TableHead className="px-4 py-3 font-medium">상태</TableHead>
                            <TableHead className="px-4 py-3 font-medium">관리</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</TableCell></TableRow>
                        ) : userList.length === 0 ? (
                            <TableRow><TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">사용자가 없습니다.</TableCell></TableRow>
                        ) : userList.map((u: { id: string; name: string; email: string; orgCount: number; isActive: number; isSuperAdmin: number; createdAt: string }) => (
                            <TableRow key={u.id} className="border-t hover:bg-slate-50">
                                <TableCell className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{u.name}</span>
                                        {u.isSuperAdmin === 1 && (
                                            <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">SUPER</span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="px-4 py-3 text-muted-foreground">{u.email}</TableCell>
                                <TableCell className="px-4 py-3">{u.orgCount}</TableCell>
                                <TableCell className="px-4 py-3">
                                    <span className={`text-xs px-2 py-0.5 rounded ${u.isActive === 1 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
                                        {u.isActive === 1 ? "활성" : "정지"}
                                    </span>
                                </TableCell>
                                <TableCell className="px-4 py-3">
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            title={u.isActive === 1 ? (u.id === me?.id ? "자신의 계정은 정지할 수 없습니다" : "계정 정지") : "계정 활성화"}
                                            aria-label={u.isActive === 1 ? `${u.name} 계정 정지` : `${u.name} 계정 활성화`}
                                            disabled={pendingId === u.id || (u.id === me?.id && u.isActive === 1)}
                                            onClick={() => confirm({ title: u.isActive === 1 ? "계정을 정지하시겠습니까?" : "계정을 활성화하시겠습니까?", description: `${u.name} (${u.email}) 계정의 모든 조직 접근에 적용됩니다.`, confirmLabel: "변경", onConfirm: () => handleUpdate(u.id, { isActive: u.isActive === 1 ? 0 : 1 }) })}
                                        >
                                            {u.isActive === 1 ? <UserX className="h-4 w-4 text-red-500" /> : <UserCheck className="h-4 w-4 text-green-500" />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            title={u.isSuperAdmin === 1 ? (u.id === me?.id ? "자신의 Super Admin 권한은 해제할 수 없습니다" : "Super Admin 해제") : "Super Admin 지정"}
                                            aria-label={u.isSuperAdmin === 1 ? `${u.name} 운영자 해제` : `${u.name} 운영자 지정`}
                                            disabled={pendingId === u.id || (u.id === me?.id && u.isSuperAdmin === 1)}
                                            onClick={() => confirm({ title: "운영자 권한을 변경하시겠습니까?", description: `${u.name} (${u.email}) 계정의 전체 조직 관리 권한을 ${u.isSuperAdmin === 1 ? "해제" : "부여"}합니다.`, confirmLabel: "변경", onConfirm: () => handleUpdate(u.id, { isSuperAdmin: u.isSuperAdmin === 1 ? 0 : 1 }) })}
                                        >
                                            {u.isSuperAdmin === 1 ? <ShieldOff className="h-4 w-4 text-violet-500" /> : <Shield className="h-4 w-4 text-slate-400" />}
                                        </Button>
                                        {pendingId === u.id && <span role="status" className="inline-flex items-center gap-1 text-xs"><Loader2 className="h-4 w-4 animate-spin" />처리 중...</span>}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">{page} / {pagination.totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}
