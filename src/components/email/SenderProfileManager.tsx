"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, CheckCircle, Send } from "lucide-react";
import type { SenderProfileManagerProps } from "./types/sender-profile";
import { useSenderProfileManager } from "./hooks/use-sender-profile-manager";
import SenderProfileList from "./ui/sender-profile-list";

export default function SenderProfileManager({
    profiles,
    createProfile,
    updateProfile,
    deleteProfile,
}: SenderProfileManagerProps) {
    const { isDialogOpen, setIsDialogOpen, editingId, form, isSaving, isVerifying, isVerified,
        handleOpenNew, handleOpenEdit, handleVerify, handleSave, handleDelete, handleSetDefault,
        handleNameChange, handleFromNameChange, handleEmailChange, handleClose,
    } = useSenderProfileManager({ profiles, createProfile, updateProfile, deleteProfile });

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>발신자 프로필 <span className="text-sm font-normal text-muted-foreground">{profiles.length}개</span></CardTitle>
                            <CardDescription>발신 이름과 이메일 쌍을 여러 개 관리합니다.</CardDescription>
                        </div>
                        <Button size="sm" onClick={handleOpenNew}>
                            <Plus className="h-4 w-4 mr-1" />
                            추가
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <SenderProfileList profiles={profiles} onEdit={handleOpenEdit}
                        onDelete={handleDelete} onSetDefault={handleSetDefault} />
                </CardContent>
            </Card>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingId ? "발신자 프로필 수정" : "발신자 프로필 추가"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>프로필 이름</Label>
                            <Input
                                value={form.name}
                                onChange={handleNameChange}
                                placeholder="예: 마케팅팀"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>발신 이름</Label>
                            <Input
                                value={form.fromName}
                                onChange={handleFromNameChange}
                                placeholder="예: Sendb 마케팅"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>발신 이메일</Label>
                            <div className="flex gap-2">
                                <Input
                                    type="email"
                                    value={form.fromEmail}
                                    onChange={handleEmailChange}
                                    placeholder="예: marketing@company.com"
                                    className="flex-1"
                                />
                                {!editingId && (
                                    <Button
                                        type="button"
                                        variant={isVerified ? "outline" : "secondary"}
                                        size="sm"
                                        className="shrink-0"
                                        onClick={handleVerify}
                                        disabled={isVerifying || isVerified || !form.fromEmail.includes("@")}
                                    >
                                        {isVerifying ? (
                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        ) : isVerified ? (
                                            <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
                                        ) : (
                                            <Send className="h-4 w-4 mr-1" />
                                        )}
                                        {isVerified ? "확인됨" : "테스트"}
                                    </Button>
                                )}
                            </div>
                            {!editingId && !isVerified && (
                                <p className="text-xs text-muted-foreground">
                                    NHN에 등록된 발신 주소인지 테스트 발송으로 확인합니다.
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={handleClose}>취소</Button>
                        <Button onClick={handleSave} disabled={isSaving || (!editingId && !isVerified)}>
                            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {editingId ? "수정" : "추가"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
