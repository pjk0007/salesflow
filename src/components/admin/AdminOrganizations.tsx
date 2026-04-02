"use client";

import { useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function AdminOrganizations() {
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { data, isLoading } = useSWR(`/api/admin/organizations?search=${search}&page=${page}&limit=20`, fetcher);
    const { data: detail } = useSWR(selectedId ? `/api/admin/organizations/${selectedId}` : null, fetcher);

    const orgs = data?.data || [];
    const pagination = data?.pagination;

    if (selectedId && detail?.data) {
        const d = detail.data;
        return (
            <div className="space-y-6">
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> 목록으로
                </Button>
                <div className="bg-white rounded-xl border p-6">
                    <h3 className="text-lg font-bold mb-1">{d.organization.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{d.organization.slug} · {d.organization.id}</p>

                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="font-semibold mb-2">멤버 ({d.members.length})</h4>
                            <div className="space-y-1">
                                {d.members.map((m: { userId: string; email: string; name: string; role: string; isActive: number }) => (
                                    <div key={m.userId} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50">
                                        <div>
                                            <span className="font-medium">{m.name}</span>
                                            <span className="text-muted-foreground ml-2">{m.email}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">{m.role}</span>
                                            {m.isActive !== 1 && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">정지</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h4 className="font-semibold mb-2">워크스페이스 ({d.workspaces.length})</h4>
                            <div className="space-y-1">
                                {d.workspaces.map((w: { id: number; name: string }) => (
                                    <div key={w.id} className="text-sm py-1.5 border-b border-slate-50">{w.name}</div>
                                ))}
                            </div>
                            <h4 className="font-semibold mb-2 mt-4">구독</h4>
                            {d.subscriptions.length > 0 ? d.subscriptions.map((s: { id: number; planName: string; status: string }) => (
                                <div key={s.id} className="text-sm py-1.5">
                                    {s.planName} — <span className={s.status === "active" ? "text-green-600" : "text-slate-400"}>{s.status}</span>
                                </div>
                            )) : <p className="text-sm text-muted-foreground">구독 없음</p>}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="조직명 검색..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9"
                />
            </div>

            <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left">
                        <tr>
                            <th className="px-4 py-3 font-medium">조직명</th>
                            <th className="px-4 py-3 font-medium">Slug</th>
                            <th className="px-4 py-3 font-medium">멤버</th>
                            <th className="px-4 py-3 font-medium">플랜</th>
                            <th className="px-4 py-3 font-medium">생성일</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">로딩 중...</td></tr>
                        ) : orgs.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">조직이 없습니다.</td></tr>
                        ) : orgs.map((org: { id: string; name: string; slug: string; memberCount: number; planName: string | null; createdAt: string }) => (
                            <tr key={org.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedId(org.id)}>
                                <td className="px-4 py-3 font-medium">{org.name}</td>
                                <td className="px-4 py-3 text-muted-foreground">{org.slug}</td>
                                <td className="px-4 py-3">{org.memberCount}</td>
                                <td className="px-4 py-3">
                                    <span className={`text-xs px-2 py-0.5 rounded ${org.planName ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-500"}`}>
                                        {org.planName || "Free"}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">{new Date(org.createdAt).toLocaleDateString("ko")}</td>
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
