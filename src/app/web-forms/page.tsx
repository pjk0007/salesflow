"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WorkspaceLayout, { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useWebForms } from "@/hooks/useWebForms";
import EmbedCodeDialog from "@/components/web-forms/EmbedCodeDialog";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Pencil, Link2, Trash2, Eye, EyeOff } from "lucide-react";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";

export default function WebFormsPage() {
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const router = useRouter();
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);
    const { workspaces, isLoading: workspacesLoading, loadError: workspacesError, mutate: mutateWorkspaces } = useWorkspaces();
    const { partitionTree } = usePartitions(workspaceId);
    const { forms, isLoading: formsLoading, updateForm, deleteForm, loadError: formsError, mutate: mutateForms } = useWebForms(workspaceId);
    // 목록을 받기 전에는 빈 상태 대신 자리표시를 보인다 (UX-047)
    const listLoading = formsLoading || (!workspaceId && (workspacesLoading || workspaces.length > 0));

    // 임베드 다이얼로그
    const [embedSlug, setEmbedSlug] = useState<string | null>(null);

    // 첫 번째 워크스페이스 자동 선택
    useEffect(() => {
        if (!workspaceId && workspaces.length > 0) {
            setWorkspaceId(workspaces[0].id);
        }
    }, [workspaces, workspaceId]);

    const allPartitions = partitionTree
        ? [
              ...partitionTree.folders.flatMap((f) => f.partitions),
              ...partitionTree.ungrouped,
          ]
        : [];

    const handleDelete = useCallback(
        async (id: number) => {
            confirm({ title: "웹 폼 삭제", description: "정말 삭제하시겠습니까?", onConfirm: async () => {
                const result = await deleteForm(id);
                if (!result.success) throw new Error(result.error || "삭제에 실패했습니다.");
                toast.success("폼이 삭제되었습니다.");
            } });
        },
        [deleteForm, confirm]
    );

    const handleToggleActive = useCallback(
        async (id: number, name: string, currentActive: number) => {
            const change = async () => {
                let result;
                try {
                    result = await updateForm(id, { isActive: currentActive ? 0 : 1 });
                } catch {
                    throw new Error("서버에 연결할 수 없습니다. 공개 상태가 바뀌었는지 목록에서 확인해주세요.");
                }
                if (!result.success) throw new Error(result.error || "공개 상태를 바꾸지 못했습니다.");
                toast.success(currentActive ? "폼 공개를 중지했습니다." : "폼을 공개했습니다.");
            };
            // 공개 중지는 웹사이트의 리드 수집을 바로 멈추므로 확인을 받는다 (UX-047)
            if (currentActive) {
                confirm({
                    title: "폼 공개 중지",
                    description: `"${name}" 폼의 공개를 중지하면 웹사이트에 넣은 폼으로 더 이상 제출을 받지 않습니다.`,
                    confirmLabel: "공개 중지",
                    onConfirm: change,
                });
                return;
            }
            try {
                await change();
            } catch (cause) {
                toast.error(cause instanceof Error ? cause.message : "공개 상태를 바꾸지 못했습니다.");
            }
        },
        [updateForm, confirm]
    );

    if (workspacesError) {
        return <WorkspaceLayout><QueryErrorState error={workspacesError} onRetry={() => mutateWorkspaces()} /></WorkspaceLayout>;
    }

    return (
        <WorkspaceLayout>
            {confirmationDialog}
            <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">웹 폼</h1>
                    <div className="flex items-center gap-3">
                        {workspaces.length > 1 && (
                            <Select
                                value={workspaceId ? String(workspaceId) : ""}
                                onValueChange={(v) => setWorkspaceId(Number(v))}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="워크스페이스" />
                                </SelectTrigger>
                                <SelectContent>
                                    {workspaces.map((ws) => (
                                        <SelectItem key={ws.id} value={String(ws.id)}>
                                            {ws.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Button asChild>
                            <Link href="/web-forms/new">
                                <Plus className="h-4 w-4 mr-1" /> 새 폼 만들기
                            </Link>
                        </Button>
                    </div>
                </div>

                {formsError ? (
                    <QueryErrorState error={formsError} onRetry={() => mutateForms()} />
                ) : listLoading ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="웹 폼 목록을 불러오는 중">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-40 w-full" />
                        ))}
                    </div>
                ) : forms.length === 0 ? (
                    <div className="text-center py-20 text-muted-foreground">
                        <p className="text-lg mb-1">아직 웹 폼이 없습니다</p>
                        <p className="text-sm">
                            새 폼을 만들어 리드를 캡처하세요.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {forms.map((form) => (
                            <Card key={form.id}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between">
                                        <CardTitle className="text-base">
                                            {form.name}
                                        </CardTitle>
                                        <Badge
                                            variant={form.isActive ? "default" : "secondary"}
                                        >
                                            {form.isActive ? "활성" : "비활성"}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="pb-2">
                                    <p className="text-sm text-muted-foreground">
                                        파티션:{" "}
                                        {allPartitions.find(
                                            (p) => p.id === form.partitionId
                                        )?.name || "-"}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        필드: {form.fieldCount}개
                                    </p>
                                </CardContent>
                                <CardFooter className="gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => router.push(`/web-forms/${form.id}`)}
                                    >
                                        <Pencil className="h-3 w-3 mr-1" /> 편집
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setEmbedSlug(form.slug)}
                                    >
                                        <Link2 className="h-3 w-3 mr-1" /> 링크
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-label={form.isActive ? "공개 중지" : "공개"}
                                        title={form.isActive ? "공개 중지" : "공개"}
                                        onClick={() =>
                                            handleToggleActive(form.id, form.name, form.isActive)
                                        }
                                    >
                                        {form.isActive ? (
                                            <EyeOff className="h-3 w-3" />
                                        ) : (
                                            <Eye className="h-3 w-3" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive"
                                        aria-label="삭제"
                                        title="삭제"
                                        onClick={() => handleDelete(form.id)}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* 임베드 코드 다이얼로그 */}
            {embedSlug && (
                <EmbedCodeDialog
                    open={true}
                    onOpenChange={(open) => { if (!open) setEmbedSlug(null); }}
                    slug={embedSlug}
                />
            )}
        </WorkspaceLayout>
    );
}
