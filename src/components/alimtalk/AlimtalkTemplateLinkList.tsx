import { useState } from "react";
import { useAlimtalkTemplateLinks } from "@/hooks/useAlimtalkTemplateLinks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AlimtalkTemplateLinkDialog from "./AlimtalkTemplateLinkDialog";
import type { AlimtalkTemplateLink } from "@/lib/db";
import type { FieldDefinition } from "@/types";

interface Partition {
    id: number;
    name: string;
}

interface AlimtalkTemplateLinkListProps {
    partitions: Partition[];
    fields: FieldDefinition[];
}

const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동",
    on_create: "생성 시",
    on_update: "수정 시",
};

export default function AlimtalkTemplateLinkList({ partitions, fields }: AlimtalkTemplateLinkListProps) {
    const [selectedPartitionId, setSelectedPartitionId] = useState<number | null>(
        partitions.length > 0 ? partitions[0].id : null
    );
    const { templateLinks, isLoading, deleteLink } = useAlimtalkTemplateLinks(selectedPartitionId);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingLink, setEditingLink] = useState<AlimtalkTemplateLink | null>(null);

    const handleCreate = () => {
        setEditingLink(null);
        setDialogOpen(true);
    };

    const handleEdit = (link: AlimtalkTemplateLink) => {
        setEditingLink(link);
        setDialogOpen(true);
    };

    const handleDelete = async (id: number) => {
        if (!confirm("이 연결을 삭제하시겠습니까?")) return;
        const result = await deleteLink(id);
        if (result.success) toast.success("연결이 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">연결 관리</h3>
                <Button onClick={handleCreate} disabled={!selectedPartitionId}>
                    <Plus className="h-4 w-4 mr-2" />
                    새 연결
                </Button>
            </div>

            <div className="space-y-2">
                <Label>파티션 선택</Label>
                <Select
                    value={selectedPartitionId ? String(selectedPartitionId) : ""}
                    onValueChange={(v) => setSelectedPartitionId(Number(v))}
                >
                    <SelectTrigger className="w-[250px]">
                        <SelectValue placeholder="파티션을 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                        {partitions.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                    ))}
                </div>
            ) : templateLinks.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                    등록된 연결이 없습니다.
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>이름</TableHead>
                            <TableHead>수신 필드</TableHead>
                            <TableHead>발송 방식</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead className="w-[100px]">작업</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {templateLinks.map((link) => (
                            <TableRow key={link.id}>
                                <TableCell className="font-medium">{link.name}</TableCell>
                                <TableCell className="text-muted-foreground">{link.recipientField}</TableCell>
                                <TableCell>
                                    <Badge variant={link.triggerType === "manual" ? "outline" : "default"}>
                                        {TRIGGER_LABELS[link.triggerType] || link.triggerType}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={link.isActive ? "default" : "secondary"}>
                                        {link.isActive ? "활성" : "비활성"}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(link)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(link.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}

            {selectedPartitionId && (
                <AlimtalkTemplateLinkDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    partitionId={selectedPartitionId}
                    link={editingLink}
                    fields={fields}
                />
            )}
        </div>
    );
}
