import { useState } from "react";
import { useRouter } from "next/router";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function EmailTemplateList() {
    const router = useRouter();
    const { templates, isLoading, deleteTemplate } = useEmailTemplates();
    const { categories } = useEmailCategories();
    const [categoryFilter, setCategoryFilter] = useState<string>("all");

    const filteredTemplates = categoryFilter === "all"
        ? templates
        : categoryFilter === "none"
            ? templates.filter((t) => !t.categoryId)
            : templates.filter((t) => t.categoryId === Number(categoryFilter));

    const handleDelete = async (id: number) => {
        if (!confirm("이 템플릿을 삭제하시겠습니까?")) return;
        const result = await deleteTemplate(id);
        if (result.success) toast.success("템플릿이 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    if (isLoading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium">이메일 템플릿</h3>
                    {categories.length > 0 && (
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
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
                </div>
                <Button onClick={() => router.push("/email/templates/new")}>
                    <Plus className="h-4 w-4 mr-2" />
                    새 템플릿
                </Button>
            </div>

            {templates.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                    등록된 템플릿이 없습니다.
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>이름</TableHead>
                            <TableHead>제목</TableHead>
                            <TableHead>카테고리</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead className="w-[100px]">작업</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredTemplates.map((template) => (
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
            )}
        </div>
    );
}
