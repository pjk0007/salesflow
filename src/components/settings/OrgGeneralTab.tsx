import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRouter } from "next/router";
import { toast } from "sonner";
import { useOrgSettings } from "@/hooks/useOrgSettings";
import { useSession } from "@/contexts/SessionContext";
import { Copy, Trash2 } from "lucide-react";

export default function OrgGeneralTab() {
    const router = useRouter();
    const { user, logout, refreshSession } = useSession();
    const { org, isLoading, updateOrg } = useOrgSettings();
    const isOwner = user?.role === "owner";
    const canEdit = user?.role === "owner" || user?.role === "admin";

    const [name, setName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (org) {
            setName(org.name);
        }
    }, [org]);

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error("조직명을 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await updateOrg({
                name: name.trim(),
            });
            if (result.success) {
                toast.success("조직 설정이 저장되었습니다.");
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCopySlug = () => {
        if (org?.slug) {
            navigator.clipboard.writeText(org.slug);
            toast.success("복사되었습니다.");
        }
    };

    const handleDeleteOrg = async () => {
        setIsDeleting(true);
        try {
            const res = await fetch("/api/org/settings", {
                method: "DELETE",
            });
            const result = await res.json();
            if (result.success) {
                toast.success("조직이 삭제되었습니다.");
                if (result.noOrgsLeft) {
                    logout();
                } else {
                    await refreshSession();
                    router.push("/");
                }
            } else {
                toast.error(result.error || "삭제에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsDeleting(false);
        }
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>기본 정보</CardTitle>
                    <CardDescription>조직의 기본 정보를 관리합니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {!canEdit && (
                        <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                            조직 설정은 관리자 이상만 수정할 수 있습니다.
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label>
                            조직명 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={!canEdit}
                            placeholder="조직명"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>Slug</Label>
                        <div className="flex gap-2">
                            <Input
                                value={org?.slug ?? ""}
                                disabled
                                className="flex-1"
                            />
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handleCopySlug}
                                title="복사"
                            >
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">조직의 고유 식별자입니다.</p>
                    </div>

                    {canEdit && (
                        <Button onClick={handleSave} disabled={isSubmitting}>
                            {isSubmitting ? "저장 중..." : "저장"}
                        </Button>
                    )}
                </CardContent>
            </Card>

            {isOwner && (
                <Card className="border-destructive">
                    <CardHeader>
                        <CardTitle className="text-destructive">위험 영역</CardTitle>
                        <CardDescription>이 작업은 되돌릴 수 없습니다.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">조직 삭제</p>
                                <p className="text-sm text-muted-foreground">
                                    조직과 모든 데이터가 영구적으로 삭제됩니다.
                                </p>
                            </div>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="sm">
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        조직 삭제
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>정말로 삭제하시겠습니까?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            이 작업은 되돌릴 수 없습니다. 조직의 모든 데이터가 영구적으로 삭제됩니다.
                                            확인하려면 조직명 &quot;{org?.name}&quot;을 입력해주세요.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <Input
                                        value={deleteConfirmText}
                                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                                        placeholder={org?.name ?? ""}
                                    />
                                    <AlertDialogFooter>
                                        <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>
                                            취소
                                        </AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={handleDeleteOrg}
                                            disabled={deleteConfirmText !== org?.name || isDeleting}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                            {isDeleting ? "삭제 중..." : "삭제"}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
