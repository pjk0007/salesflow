import { useState, useEffect, useCallback } from "react";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useSession } from "@/contexts/SessionContext";
import { Loader2, CreditCard, RefreshCw, Trash2 } from "lucide-react";

interface ProfileData {
    id: string;
    email: string;
    name: string;
    phone: string | null;
}

interface PaymentMethodData {
    hasBillingKey: boolean;
    cardInfo: { cardCompany: string; cardNumber: string } | null;
}

export default function ProfileTab() {
    const { user, refreshSession } = useSession();
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // 프로필 폼
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");

    // 비밀번호 폼
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    // 결제 수단
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethodData | null>(null);
    const [paymentLoading, setPaymentLoading] = useState(false);

    const fetchProfile = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/profile");
            const json = await res.json();
            if (json.success) {
                setProfile(json.data);
                setName(json.data.name);
                setPhone(json.data.phone ?? "");
            }
        } catch {
            toast.error("프로필을 불러올 수 없습니다.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchPaymentMethod = useCallback(async () => {
        try {
            const res = await fetch("/api/billing/status");
            const json = await res.json();
            if (json.success && json.data.subscription) {
                setPaymentMethod({
                    hasBillingKey: json.data.subscription.hasBillingKey,
                    cardInfo: json.data.subscription.cardInfo,
                });
            }
        } catch {
            // 조용히 실패
        }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchPaymentMethod();
    }, [fetchProfile, fetchPaymentMethod]);

    const handleSaveProfile = async () => {
        if (!name.trim()) {
            toast.error("이름을 입력해주세요.");
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch("/api/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    phone: phone.trim() || undefined,
                }),
            });
            const json = await res.json();

            if (json.success) {
                setProfile(json.data);
                await refreshSession();
                toast.success("프로필이 저장되었습니다.");
            } else {
                toast.error(json.error || "저장에 실패했습니다.");
            }
        } catch {
            toast.error("서버 오류가 발생했습니다.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleChangePassword = async () => {
        if (!currentPassword) {
            toast.error("현재 비밀번호를 입력해주세요.");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("새 비밀번호는 6자 이상이어야 합니다.");
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error("새 비밀번호가 일치하지 않습니다.");
            return;
        }

        setIsChangingPassword(true);
        try {
            const res = await fetch("/api/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const json = await res.json();

            if (json.success) {
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
                toast.success("비밀번호가 변경되었습니다.");
            } else {
                toast.error(json.error || "비밀번호 변경에 실패했습니다.");
            }
        } catch {
            toast.error("서버 오류가 발생했습니다.");
        } finally {
            setIsChangingPassword(false);
        }
    };

    const handleRegisterCard = async () => {
        const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
        if (!clientKey) {
            toast.error("결제 설정이 완료되지 않았습니다.");
            return;
        }

        setPaymentLoading(true);
        try {
            const { loadTossPayments } = await import("@tosspayments/tosspayments-sdk");
            const toss = await loadTossPayments(clientKey);
            const customerKey = `cust_${user?.orgId?.replace(/-/g, "").slice(0, 20)}`;

            const payment = toss.payment({ customerKey });
            await payment.requestBillingAuth({
                method: "CARD",
                successUrl: `${window.location.origin}/billing/success`,
                failUrl: `${window.location.origin}/billing/fail`,
                customerEmail: user?.email,
                customerName: user?.name,
            });
        } catch {
            toast.error("결제창을 열 수 없습니다.");
        } finally {
            setPaymentLoading(false);
        }
    };

    const handleDeleteCard = async () => {
        setPaymentLoading(true);
        try {
            const res = await fetch("/api/billing/delete-billing-key", { method: "POST" });
            const json = await res.json();

            if (json.success) {
                toast.success("결제 수단이 삭제되었습니다.");
                await fetchPaymentMethod();
            } else {
                toast.error(json.error || "결제 수단 삭제에 실패했습니다.");
            }
        } catch {
            toast.error("서버 오류가 발생했습니다.");
        } finally {
            setPaymentLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!profile) return null;

    const profileChanged = name.trim() !== profile.name || (phone.trim() || "") !== (profile.phone ?? "");

    return (
        <div className="space-y-6">
            {/* 기본 정보 */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">기본 정보</CardTitle>
                    <CardDescription>이름과 연락처를 수정할 수 있습니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email">이메일</Label>
                        <Input
                            id="email"
                            value={profile.email}
                            disabled
                            className="bg-muted"
                        />
                        <p className="text-xs text-muted-foreground">이메일은 변경할 수 없습니다.</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="name">이름</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="이름을 입력하세요"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="phone">전화번호</Label>
                        <Input
                            id="phone"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="전화번호를 입력하세요"
                        />
                    </div>

                    <div className="flex justify-end">
                        <Button
                            onClick={handleSaveProfile}
                            disabled={!profileChanged || isSaving}
                        >
                            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                            저장
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Separator />

            {/* 비밀번호 변경 */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">비밀번호 변경</CardTitle>
                    <CardDescription>보안을 위해 주기적으로 비밀번호를 변경하세요.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="currentPassword">현재 비밀번호</Label>
                        <Input
                            id="currentPassword"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="현재 비밀번호"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="newPassword">새 비밀번호</Label>
                        <Input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="새 비밀번호 (6자 이상)"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
                        <Input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="새 비밀번호 확인"
                        />
                    </div>

                    <div className="flex justify-end">
                        <Button
                            onClick={handleChangePassword}
                            disabled={!currentPassword || !newPassword || !confirmPassword || isChangingPassword}
                            variant="outline"
                        >
                            {isChangingPassword && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                            비밀번호 변경
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Separator />

            {/* 결제 수단 */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <CreditCard className="h-5 w-5" />
                        결제 수단
                    </CardTitle>
                    <CardDescription>정기결제에 사용할 카드를 등록하세요.</CardDescription>
                </CardHeader>
                <CardContent>
                    {paymentMethod?.cardInfo ? (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                                    <CreditCard className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="font-medium">{paymentMethod.cardInfo.cardCompany}</p>
                                    <p className="text-sm text-muted-foreground">{paymentMethod.cardInfo.cardNumber}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleRegisterCard}
                                    disabled={paymentLoading}
                                >
                                    <RefreshCw className="mr-1.5 h-4 w-4" />
                                    카드 변경
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={paymentLoading}
                                        >
                                            <Trash2 className="mr-1.5 h-4 w-4" />
                                            삭제
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>결제 수단 삭제</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                등록된 카드를 삭제하시겠습니까? 유료 플랜을 이용하려면 다시 결제 수단을 등록해야 합니다.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>취소</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleDeleteCard}>
                                                삭제
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-center">
                            <CreditCard className="h-10 w-10 text-muted-foreground" />
                            <p className="mt-3 text-sm text-muted-foreground">
                                등록된 결제 수단이 없습니다.
                            </p>
                            <Button
                                className="mt-4"
                                onClick={handleRegisterCard}
                                disabled={paymentLoading}
                            >
                                {paymentLoading ? (
                                    <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                                ) : (
                                    <CreditCard className="mr-1.5 h-4 w-4" />
                                )}
                                결제 수단 등록
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
