import { useState } from "react";
import { useEmailCategories } from "@/hooks/useEmailCategories";
import type { NhnCategory } from "@/hooks/useEmailCategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function EmailCategoryManager() {
    const { categories, isLoading, createCategory, updateCategory, deleteCategory } = useEmailCategories();
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState("");
    const [newDesc, setNewDesc] = useState("");
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const [editDesc, setEditDesc] = useState("");

    const handleCreate = async () => {
        if (!newName.trim()) return;
        const result = await createCategory({
            categoryName: newName.trim(),
            categoryDesc: newDesc.trim() || undefined,
        });
        if (result.success) {
            toast.success("카테고리가 생성되었습니다.");
            setNewName("");
            setNewDesc("");
            setAdding(false);
        } else {
            toast.error(result.error || "생성에 실패했습니다.");
        }
    };

    const handleEdit = (cat: NhnCategory) => {
        setEditingId(cat.categoryId);
        setEditName(cat.categoryName);
        setEditDesc(cat.categoryDesc || "");
    };

    const handleUpdate = async () => {
        if (!editingId || !editName.trim()) return;
        const result = await updateCategory(editingId, {
            categoryName: editName.trim(),
            categoryDesc: editDesc.trim() || undefined,
        });
        if (result.success) {
            toast.success("카테고리가 수정되었습니다.");
            setEditingId(null);
        } else {
            toast.error(result.error || "수정에 실패했습니다.");
        }
    };

    const handleDelete = async (categoryId: number) => {
        if (!confirm("이 카테고리를 삭제하시겠습니까?")) return;
        const result = await deleteCategory(categoryId);
        if (result.success) toast.success("카테고리가 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>이메일 카테고리</CardTitle>
                        <CardDescription>NHN Cloud에서 관리되는 이메일 카테고리입니다.</CardDescription>
                    </div>
                    <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
                        <Plus className="h-4 w-4 mr-1" />
                        추가
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>이름</TableHead>
                                <TableHead>설명</TableHead>
                                <TableHead className="w-[100px]">작업</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {adding && (
                                <TableRow>
                                    <TableCell>
                                        <Input
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            placeholder="카테고리 이름"
                                            className="h-8 text-sm"
                                            autoFocus
                                            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            value={newDesc}
                                            onChange={(e) => setNewDesc(e.target.value)}
                                            placeholder="설명 (선택)"
                                            className="h-8 text-sm"
                                            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="icon" onClick={handleCreate}>
                                                <Check className="h-4 w-4 text-green-600" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => { setAdding(false); setNewName(""); setNewDesc(""); }}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                            {categories.map((cat) => (
                                <TableRow key={cat.categoryId}>
                                    <TableCell>
                                        {editingId === cat.categoryId ? (
                                            <Input
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                className="h-8 text-sm"
                                                autoFocus
                                                onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                                            />
                                        ) : (
                                            <span className="font-medium">{cat.categoryName}</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === cat.categoryId ? (
                                            <Input
                                                value={editDesc}
                                                onChange={(e) => setEditDesc(e.target.value)}
                                                className="h-8 text-sm"
                                                onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                                            />
                                        ) : (
                                            <span className="text-muted-foreground">{cat.categoryDesc || "-"}</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1">
                                            {editingId === cat.categoryId ? (
                                                <>
                                                    <Button variant="ghost" size="icon" onClick={handleUpdate}>
                                                        <Check className="h-4 w-4 text-green-600" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" onClick={() => setEditingId(null)}>
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button variant="ghost" size="icon" onClick={() => handleEdit(cat)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" onClick={() => handleDelete(cat.categoryId)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {categories.length === 0 && !adding && (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                                        등록된 카테고리가 없습니다.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
