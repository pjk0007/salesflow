import { useState } from "react";
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSession } from "@/contexts/SessionContext";
import { useOrgMembers } from "@/hooks/useOrgMembers";
import { useOrgInvitations } from "@/hooks/useOrgInvitations";
import {
    Crown,
    Shield,
    UserCircle,
    MoreHorizontal,
    UserPlus,
    Trash2,
    Copy,
    X,
} from "lucide-react";
import type { OrgRole, MemberItem } from "@/types";

const roleConfig: Record<OrgRole, { icon: typeof Crown; label: string; color: string }> = {
    owner: { icon: Crown, label: "소유자", color: "text-yellow-500" },
    admin: { icon: Shield, label: "관리자", color: "text-blue-500" },
    member: { icon: UserCircle, label: "멤버", color: "text-green-500" },
};

export default function OrgTeamTab() {
    const { user } = useSession();
    const { members, isLoading: membersLoading, updateRole, removeMember } = useOrgMembers();
    const { invitations, isLoading: invitationsLoading, createInvitation, cancelInvitation } = useOrgInvitations();

    const isOwner = user?.role === "owner";
    const canManageTeam = user?.role === "owner" || user?.role === "admin";

    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<OrgRole>("member");
    const [inviting, setInviting] = useState(false);

    const [memberToRemove, setMemberToRemove] = useState<MemberItem | null>(null);

    const activeMembers = members.filter((m) => m.isActive === 1);

    const handleInvite = async () => {
        if (!inviteEmail.trim()) {
            toast.error("이메일을 입력해주세요.");
            return;
        }

        setInviting(true);
        try {
            const result = await createInvitation(inviteEmail.trim(), inviteRole);
            if (result.success) {
                const inviteUrl = `${window.location.origin}/invite?token=${result.data.token}`;
                await navigator.clipboard.writeText(inviteUrl);
                toast.success("초대가 생성되었습니다. 링크가 클립보드에 복사되었습니다.");
                setInviteDialogOpen(false);
                setInviteEmail("");
                setInviteRole("member");
            } else {
                toast.error(result.error || "초대 생성에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setInviting(false);
        }
    };

    const handleRoleChange = async (userId: string, role: OrgRole) => {
        const result = await updateRole(userId, role);
        if (result.success) {
            toast.success("역할이 변경되었습니다.");
        } else {
            toast.error(result.error || "역할 변경에 실패했습니다.");
        }
    };

    const handleRemoveMember = async () => {
        if (!memberToRemove) return;
        const result = await removeMember(memberToRemove.id);
        if (result.success) {
            toast.success("멤버가 제거되었습니다.");
        } else {
            toast.error(result.error || "멤버 제거에 실패했습니다.");
        }
        setMemberToRemove(null);
    };

    const handleCancelInvitation = async (id: number) => {
        const result = await cancelInvitation(id);
        if (result.success) {
            toast.success("초대가 취소되었습니다.");
        } else {
            toast.error(result.error || "초대 취소에 실패했습니다.");
        }
    };

    const handleCopyInviteLink = (token: string) => {
        const url = `${window.location.origin}/invite?token=${token}`;
        navigator.clipboard.writeText(url);
        toast.success("초대 링크가 복사되었습니다.");
    };

    if (membersLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            {/* 멤버 목록 */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>팀 멤버</CardTitle>
                        <CardDescription>{activeMembers.length}명의 멤버</CardDescription>
                    </div>
                    {canManageTeam && (
                        <Button onClick={() => setInviteDialogOpen(true)} size="sm">
                            <UserPlus className="h-4 w-4 mr-2" />
                            초대하기
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>멤버</TableHead>
                                <TableHead>역할</TableHead>
                                <TableHead>가입일</TableHead>
                                {canManageTeam && <TableHead className="w-[50px]" />}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {activeMembers.map((member) => {
                                const config = roleConfig[member.role];
                                const Icon = config.icon;
                                const canModify =
                                    canManageTeam &&
                                    member.id !== user?.id &&
                                    member.role !== "owner" &&
                                    (isOwner || member.role === "member");

                                return (
                                    <TableRow key={member.id}>
                                        <TableCell>
                                            <div>
                                                <p className="font-medium">{member.name}</p>
                                                <p className="text-sm text-muted-foreground">{member.email}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1.5">
                                                <Icon className={`h-4 w-4 ${config.color}`} />
                                                <span className="text-sm">{config.label}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {new Date(member.createdAt).toLocaleDateString("ko-KR")}
                                        </TableCell>
                                        {canManageTeam && (
                                            <TableCell>
                                                {canModify && (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            {isOwner && (
                                                                <>
                                                                    <DropdownMenuItem
                                                                        disabled={member.role === "admin"}
                                                                        onClick={() => handleRoleChange(member.id, "admin")}
                                                                    >
                                                                        <Shield className="h-4 w-4 mr-2 text-blue-500" />
                                                                        관리자로 변경
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem
                                                                        disabled={member.role === "member"}
                                                                        onClick={() => handleRoleChange(member.id, "member")}
                                                                    >
                                                                        <UserCircle className="h-4 w-4 mr-2 text-green-500" />
                                                                        멤버로 변경
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuSeparator />
                                                                </>
                                                            )}
                                                            <DropdownMenuItem
                                                                className="text-destructive"
                                                                onClick={() => setMemberToRemove(member)}
                                                            >
                                                                <Trash2 className="h-4 w-4 mr-2" />
                                                                멤버 제거
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
                                            </TableCell>
                                        )}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* 대기 중인 초대 */}
            {canManageTeam && invitations.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>대기 중인 초대</CardTitle>
                        <CardDescription>{invitations.length}건의 초대</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>이메일</TableHead>
                                    <TableHead>역할</TableHead>
                                    <TableHead>만료일</TableHead>
                                    <TableHead className="w-[100px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invitations.map((inv) => {
                                    const config = roleConfig[inv.role];
                                    const Icon = config.icon;
                                    return (
                                        <TableRow key={inv.id}>
                                            <TableCell className="font-medium">{inv.email}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5">
                                                    <Icon className={`h-4 w-4 ${config.color}`} />
                                                    <span className="text-sm">{config.label}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {new Date(inv.expiresAt).toLocaleDateString("ko-KR")}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => handleCopyInviteLink(inv.token)}
                                                        title="링크 복사"
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-destructive"
                                                        onClick={() => handleCancelInvitation(inv.id)}
                                                        title="취소"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* 역할 안내 */}
            <Card>
                <CardHeader>
                    <CardTitle>역할별 권한</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {(Object.entries(roleConfig) as [OrgRole, typeof roleConfig.owner][]).map(([role, config]) => {
                            const Icon = config.icon;
                            const permissions: Record<OrgRole, string[]> = {
                                owner: ["모든 권한", "조직 삭제", "역할 변경", "관리자 초대"],
                                admin: ["멤버 초대", "멤버 제거", "설정 수정"],
                                member: ["데이터 조회/편집"],
                            };
                            return (
                                <Card key={role} className="p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Icon className={`h-5 w-5 ${config.color}`} />
                                        <span className="font-medium">{config.label}</span>
                                    </div>
                                    <ul className="text-sm text-muted-foreground space-y-1">
                                        {permissions[role].map((p) => (
                                            <li key={p}>- {p}</li>
                                        ))}
                                    </ul>
                                </Card>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* 초대 다이얼로그 */}
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>멤버 초대</DialogTitle>
                        <DialogDescription>이메일로 새 멤버를 초대합니다.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>이메일</Label>
                            <Input
                                type="email"
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                placeholder="user@example.com"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>역할</Label>
                            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="member">멤버</SelectItem>
                                    {isOwner && <SelectItem value="admin">관리자</SelectItem>}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                            취소
                        </Button>
                        <Button onClick={handleInvite} disabled={inviting}>
                            {inviting ? "초대 중..." : "초대"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 멤버 제거 확인 */}
            <AlertDialog open={memberToRemove !== null} onOpenChange={(open) => { if (!open) setMemberToRemove(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>멤버 제거</AlertDialogTitle>
                        <AlertDialogDescription>
                            {memberToRemove?.name}({memberToRemove?.email})을(를) 제거하시겠습니까?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRemoveMember}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            제거
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
