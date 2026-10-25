"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function OrgSwitcher() {
    const router = useRouter();
    const { user, switchOrg, createOrg, isSessionChanging } = useSession();
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [newOrgName, setNewOrgName] = useState("");
    const [creating, setCreating] = useState(false);
    const creatingRequest = useRef(false);

    if (!user || user.organizations.length === 0) {
        return null;
    }

    const currentOrg = user.organizations.find((o) => o.id === user.orgId);

    async function handleCreate() {
        if (!newOrgName.trim() || creatingRequest.current) return;

        creatingRequest.current = true;
        setCreating(true);
        try {
            const json = await createOrg(newOrgName.trim());

            if (json.success) {
                toast.success("조직이 생성되었습니다");
                setCreateDialogOpen(false);
                setNewOrgName("");
            } else {
                toast.error(json.error || "조직 생성에 실패했습니다.");
            }
        } catch {
            toast.error("서버 오류가 발생했습니다.");
        } finally {
            creatingRequest.current = false;
            setCreating(false);
        }
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={isSessionChanging}
                        className="w-full justify-between gap-2"
                    >
                        <span className="flex items-center gap-2 truncate">
                            <Building2 className="h-4 w-4 shrink-0" />
                            <span className="truncate">{currentOrg?.name ?? "조직"}</span>
                        </span>
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuLabel>조직</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {user.organizations.map((org) => (
                        <DropdownMenuItem
                            key={org.id}
                            onClick={async () => {
                                if (org.id !== user.orgId) {
                                    const result = await switchOrg(org.id);
                                    if (!result.success) toast.error(result.error || "조직 전환에 실패했습니다.");
                                }
                            }}
                            className="flex items-center justify-between"
                        >
                            <div className="flex flex-col">
                                <span className="truncate">{org.name}</span>
                                <span className="text-xs text-muted-foreground">{org.role}</span>
                            </div>
                            {org.id === user.orgId && (
                                <Check className="h-4 w-4 shrink-0 text-primary" />
                            )}
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setCreateDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        새 조직 만들기
                    </DropdownMenuItem>
                    {user.role !== "member" && (
                        <DropdownMenuItem onClick={() => router.push("/settings/organization")}>
                            <Settings className="mr-2 h-4 w-4" />
                            조직 설정
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>새 조직 만들기</DialogTitle>
                        <DialogDescription>
                            새로운 조직을 생성하고 팀원을 초대하세요.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="orgName">조직 이름</Label>
                            <Input
                                id="orgName"
                                placeholder="우리 회사"
                                value={newOrgName}
                                onChange={(e) => setNewOrgName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setCreateDialogOpen(false)}
                        >
                            취소
                        </Button>
                        <Button onClick={handleCreate} disabled={creating || !newOrgName.trim()}>
                            {creating ? "생성 중..." : "만들기"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
