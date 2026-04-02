"use client";

import { useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, Shield, ShieldOff, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function AdminUsers() {
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);

    const { data, isLoading, mutate } = useSWR(`/api/admin/users?search=${search}&page=${page}&limit=20`, fetcher);
    const userList = data?.data || [];
    const pagination = data?.pagination;

    async function handleUpdate(userId: string, updates: { isActive?: number; isSuperAdmin?: number }) {
        const res = await fetch(`/api/admin/users/${userId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.success) {
            toast.success("변경되었습니다.");
            mutate();
        } else {
            toast.error(data.error || "변경 실패");
        }
    }

    return (
        <div className="space-y-4">
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
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left">
                        <tr>
                            <th className="px-4 py-3 font-medium">이름</th>
                            <th className="px-4 py-3 font-medium">이메일</th>
                            <th className="px-4 py-3 font-medium">조직 수</th>
                            <th className="px-4 py-3 font-medium">상태</th>
                            <th className="px-4 py-3 font-medium">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td></tr>
                        ) : userList.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">사용자가 없습니다.</td></tr>
                        ) : userList.map((u: { id: string; name: string; email: string; orgCount: number; isActive: number; isSuperAdmin: number; createdAt: string }) => (
                            <tr key={u.id} className="border-t hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{u.name}</span>
                                        {u.isSuperAdmin === 1 && (
                                            <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">SUPER</span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                                <td className="px-4 py-3">{u.orgCount}</td>
                                <td className="px-4 py-3">
                                    <span className={`text-xs px-2 py-0.5 rounded ${u.isActive === 1 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
                                        {u.isActive === 1 ? "활성" : "정지"}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            title={u.isActive === 1 ? "계정 정지" : "계정 활성화"}
                                            onClick={() => handleUpdate(u.id, { isActive: u.isActive === 1 ? 0 : 1 })}
                                        >
                                            {u.isActive === 1 ? <UserX className="h-4 w-4 text-red-500" /> : <UserCheck className="h-4 w-4 text-green-500" />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            title={u.isSuperAdmin === 1 ? "Super Admin 해제" : "Super Admin 지정"}
                                            onClick={() => handleUpdate(u.id, { isSuperAdmin: u.isSuperAdmin === 1 ? 0 : 1 })}
                                        >
                                            {u.isSuperAdmin === 1 ? <ShieldOff className="h-4 w-4 text-violet-500" /> : <Shield className="h-4 w-4 text-slate-400" />}
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
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
