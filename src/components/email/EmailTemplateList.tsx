"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useEmailCategories } from "@/hooks/useEmailCategories";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Send, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import EmailTestSendDialog from "@/components/email/EmailTestSendDialog";
import type { EmailTemplate } from "@/lib/db";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";

export default function EmailTemplateList() {
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const router = useRouter();
    const { categories } = useEmailCategories();
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [testSendTemplate, setTestSendTemplate] = useState<EmailTemplate | null>(null);
    // 검색·카테고리는 서버에서 적용한다 — 현재 페이지 배열만 거르면 21번째 이후 템플릿이 사라진다 (UX-146)
    const {
        templates, totalCount, page: servedPage, totalPages, isLoading, loadError, mutate, deleteTemplate,
    } = useEmailTemplates({
        page,
        q: search,
        categoryId: categoryFilter === "all" ? undefined : categoryFilter === "none" ? "none" : Number(categoryFilter),
    });

    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // 삭제 등으로 마지막 페이지가 비면 서버가 마지막 유효 페이지(servedPage)를 돌려준다 — 표시·이동은 그 값을 기준으로 한다

    const filtering = search !== "" || categoryFilter !== "all";

    const handleDelete = async (id: number) => {
        confirm({
            title: "이메일 템플릿 삭제",
            description: "이 템플릿을 삭제하시겠습니까?",
            onConfirm: async () => {
                const result = await deleteTemplate(id);
                if (result.success) toast.success("템플릿이 삭제되었습니다.");
                else throw new Error(result.error || "삭제에 실패했습니다.");
            },
        });
    };

    return (
        <div className="space-y-4">
            {confirmationDialog}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg font-medium whitespace-nowrap">이메일 템플릿</h3>
                    {categories.length > 0 && (
                        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
                            <SelectTrigger className="w-40 h-8 text-sm">
                                <SelectValue placeholder="카테고리" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">전체</SelectItem>
                                <SelectItem value="none">미분류</SelectItem>
                                {categories.map((cat) => (
                                    <SelectItem key={cat.categoryId} value={String(cat.categoryId)}>
                                        {cat.categoryName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    <Input
                        aria-label="템플릿 이름·제목 검색"
                        placeholder="이름·제목 검색"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="h-8 w-48 text-sm"
                    />
                </div>
                <Button onClick={() => router.push("/email/templates/new")} className="shrink-0">
                    <Plus className="h-4 w-4 mr-2" />
                    새 템플릿
                </Button>
            </div>

            {/* 검색·필터는 남겨 두고 목록 영역만 오류·로딩으로 바꾼다 */}
            {loadError ? (
                <QueryErrorState error={loadError} onRetry={() => mutate()} />
            ) : isLoading && templates.length === 0 ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                    ))}
                </div>
            ) : templates.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                    {filtering ? "조건에 맞는 템플릿이 없습니다." : "등록된 템플릿이 없습니다."}
                </div>
            ) : (
                <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>이름</TableHead>
                            <TableHead>제목</TableHead>
                            <TableHead>카테고리</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead className="w-[130px]">작업</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {templates.map((template) => (
                            <TableRow key={template.id}>
                                <TableCell className="font-medium">{template.name}</TableCell>
                                <TableCell className="text-muted-foreground max-w-[300px] truncate">
                                    {template.subject}
                                </TableCell>
                                <TableCell>
                                    {template.categoryId ? (
                                        <Badge variant="outline">
                                            {categories.find((c) => c.categoryId === template.categoryId)?.categoryName || "-"}
                                        </Badge>
                                    ) : null}
                                </TableCell>
                                <TableCell>
                                    {template.status === "draft" ? (
                                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                                            임시저장
                                        </Badge>
                                    ) : (
                                        <Badge variant={template.isActive ? "default" : "secondary"}>
                                            {template.isActive ? "활성" : "비활성"}
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            disabled={template.status === "draft"}
                                            onClick={() => setTestSendTemplate(template)}
                                            title="테스트 발송"
                                        >
                                            <Send className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => router.push(`/email/templates/${template.id}`)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(template.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </div>
            )}

            {!loadError && totalPages > 0 && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">총 {totalCount.toLocaleString()}건</p>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-1">
                            <Button
                                aria-label="이전 페이지"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                disabled={servedPage <= 1 || isLoading}
                                onClick={() => setPage(servedPage - 1)}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm px-2">{servedPage} / {totalPages}</span>
                            <Button
                                aria-label="다음 페이지"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                disabled={servedPage >= totalPages || isLoading}
                                onClick={() => setPage(servedPage + 1)}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {testSendTemplate && (
                <EmailTestSendDialog
                    open={!!testSendTemplate}
                    onOpenChange={(open) => { if (!open) setTestSendTemplate(null); }}
                    template={testSendTemplate}
                />
            )}
        </div>
    );
}
