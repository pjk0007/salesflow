import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Shield, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";
import type { UserListItem, UpdateUserInput, OrgRole } from "@/types";

interface UserTableProps {
    users: UserListItem[];
    currentUserId: string;
    currentUserRole: OrgRole;
    isLoading: boolean;
    onUpdateUser: (id: string, data: UpdateUserInput) => Promise<{ success: boolean; error?: string }>;
    onEditClick: (user: UserListItem) => void;
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}

const ROLE_LABELS: Record<OrgRole, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
};

const ROLE_VARIANTS: Record<OrgRole, "default" | "secondary" | "outline"> = {
    owner: "default",
    admin: "secondary",
    member: "outline",
};

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function UserTable({
    users,
    currentUserId,
    currentUserRole,
    isLoading,
    onUpdateUser,
    onEditClick,
    page,
    totalPages,
    total,
    pageSize,
    onPageChange,
}: UserTableProps) {
    const canModifyUser = (targetUser: UserListItem): boolean => {
        if (currentUserId === targetUser.id) return false;
        if (currentUserRole === "owner") return true;
        if (currentUserRole === "admin" && targetUser.role === "member") return true;
        return false;
    };

    const handleToggleActive = async (user: UserListItem) => {
        const newActive = user.isActive === 1 ? 0 : 1;
        const result = await onUpdateUser(user.id, { isActive: newActive });
        if (result.success) {
            toast.success(newActive === 1 ? "사용자가 활성화되었습니다." : "사용자가 비활성화되었습니다.");
        } else {
            toast.error(result.error || "수정에 실패했습니다.");
        }
    };

    const handleRoleChange = async (user: UserListItem, newRole: OrgRole) => {
        if (newRole === user.role) return;
        const result = await onUpdateUser(user.id, { role: newRole });
        if (result.success) {
            toast.success(`역할이 ${ROLE_LABELS[newRole]}(으)로 변경되었습니다.`);
        } else {
            toast.error(result.error || "역할 변경에 실패했습니다.");
        }
    };

    const getRoleOptions = (): OrgRole[] => {
        if (currentUserRole === "owner") return ["owner", "admin", "member"];
        return ["member"];
    };

    if (isLoading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                ))}
            </div>
        );
    }

    return (
        <div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>이름</TableHead>
                        <TableHead>이메일</TableHead>
                        <TableHead className="w-[120px]">역할</TableHead>
                        <TableHead className="w-[100px]">상태</TableHead>
                        <TableHead className="w-[120px]">가입일</TableHead>
                        <TableHead className="w-[80px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                사용자가 없습니다.
                            </TableCell>
                        </TableRow>
                    ) : (
                        users.map((u) => {
                            const isSelf = u.id === currentUserId;
                            const canModify = canModifyUser(u);

                            return (
                                <TableRow key={u.id}>
                                    <TableCell className="font-medium">
                                        {u.name}
                                        {isSelf && (
                                            <span className="ml-1.5 text-xs text-muted-foreground">(나)</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                                    <TableCell>
                                        <Badge variant={ROLE_VARIANTS[u.role as OrgRole]}>
                                            {ROLE_LABELS[u.role as OrgRole] ?? u.role}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Switch
                                            checked={u.isActive === 1}
                                            onCheckedChange={() => handleToggleActive(u)}
                                            disabled={isSelf || !canModify}
                                        />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {formatDate(u.createdAt)}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => onEditClick(u)}>
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    정보 수정
                                                </DropdownMenuItem>
                                                {!isSelf && canModify && (
                                                    <>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuSub>
                                                            <DropdownMenuSubTrigger>
                                                                <Shield className="h-4 w-4 mr-2" />
                                                                역할 변경
                                                            </DropdownMenuSubTrigger>
                                                            <DropdownMenuSubContent>
                                                                {getRoleOptions().map((role) => (
                                                                    <DropdownMenuItem
                                                                        key={role}
                                                                        onClick={() => handleRoleChange(u, role)}
                                                                    >
                                                                        {u.role === role && (
                                                                            <Check className="h-4 w-4 mr-2" />
                                                                        )}
                                                                        {u.role !== role && (
                                                                            <span className="w-4 mr-2" />
                                                                        )}
                                                                        {ROLE_LABELS[role]}
                                                                    </DropdownMenuItem>
                                                                ))}
                                                            </DropdownMenuSubContent>
                                                        </DropdownMenuSub>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-2 py-3 border-t">
                    <div className="text-sm text-muted-foreground">
                        전체 {total}명
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={page <= 1}
                            onClick={() => onPageChange(page - 1)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm">
                            {page} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={page >= totalPages}
                            onClick={() => onPageChange(page + 1)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
