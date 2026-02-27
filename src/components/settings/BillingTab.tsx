import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { useSession } from "@/contexts/SessionContext";
import { Loader2, Check } from "lucide-react";

interface PlanInfo {
    name: string;
    slug: string;
    price: number;
    limits: { workspaces: number; records: number; members: number };
    features: string[];
}

interface BillingData {
    plan: PlanInfo | null;
    subscription: {
        status: string;
        currentPeriodStart: string | null;
        currentPeriodEnd: string | null;
        hasBillingKey: boolean;
        cardInfo: { cardCompany: string; cardNumber: string } | null;
        canceledAt: string | null;
    } | null;
    payments: Array<{
        id: number;
        amount: number;
        status: string;
        tossOrderId: string | null;
        paidAt: string | null;
        createdAt: string;
    }>;
    allPlans: PlanInfo[];
}

function formatPrice(price: number) {
    if (price === 0) return "무료";
    return `₩${price.toLocaleString()}`;
}

function formatDate(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function BillingTab() {
    const { user } = useSession();
    const [data, setData] = useState<BillingData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchBilling = useCallback(async () => {
        try {
            const res = await fetch("/api/billing/status");
            const json = await res.json();
            if (json.success) {
                setData(json.data);
            }
        } catch {
            toast.error("요금제 정보를 불러올 수 없습니다.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBilling();
    }, [fetchBilling]);

    const handleSelectPlan = async (planSlug: string) => {
        if (!data?.subscription?.hasBillingKey && planSlug !== "free") {
            // 빌링키 없으면 토스 결제창으로 이동
            await openTossPayment(planSlug);
            return;
        }

        setActionLoading(planSlug);
        try {
            const res = await fetch("/api/billing/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planSlug }),
            });
            const json = await res.json();

            if (json.success) {
                toast.success("플랜이 변경되었습니다.");
                await fetchBilling();
            } else if (json.needBillingKey) {
                await openTossPayment(planSlug);
            } else {
                toast.error(json.error || "플랜 변경에 실패했습니다.");
            }
        } catch {
            toast.error("서버 오류가 발생했습니다.");
        } finally {
            setActionLoading(null);
        }
    };

    const openTossPayment = async (planSlug: string) => {
        try {
            const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
            if (!clientKey) {
                toast.error("결제 설정이 완료되지 않았습니다.");
                return;
            }

            const { loadTossPayments } = await import("@tosspayments/tosspayments-sdk");
            const toss = await loadTossPayments(clientKey);
            const customerKey = `cust_${user?.orgId?.replace(/-/g, "").slice(0, 20)}`;

            const payment = toss.payment({ customerKey });
            await payment.requestBillingAuth({
                method: "CARD",
                successUrl: `${window.location.origin}/billing/success?planSlug=${planSlug}`,
                failUrl: `${window.location.origin}/billing/fail`,
                customerEmail: user?.email,
                customerName: user?.name,
            });
        } catch {
            toast.error("결제창을 열 수 없습니다.");
        }
    };

    const handleCancel = async () => {
        setActionLoading("cancel");
        try {
            const res = await fetch("/api/billing/cancel", { method: "POST" });
            const json = await res.json();

            if (json.success) {
                toast.success("구독이 취소되었습니다. Free 플랜으로 변경되었습니다.");
                await fetchBilling();
            } else {
                toast.error(json.error || "구독 취소에 실패했습니다.");
            }
        } catch {
            toast.error("서버 오류가 발생했습니다.");
        } finally {
            setActionLoading(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!data) return null;

    const currentSlug = data.plan?.slug ?? "free";
    const isPaid = currentSlug !== "free";

    return (
        <div className="space-y-6">
            {/* 현재 플랜 */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">현재 플랜</CardTitle>
                </CardHeader>
                <CardContent>
                    {data.plan ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <span className="text-2xl font-bold">{data.plan.name}</span>
                                <Badge variant={isPaid ? "default" : "secondary"}>
                                    {formatPrice(data.plan.price)}
                                    {isPaid && "/월"}
                                </Badge>
                            </div>
                            {data.subscription?.currentPeriodEnd && (
                                <p className="text-sm text-muted-foreground">
                                    다음 결제일: {formatDate(data.subscription.currentPeriodEnd)}
                                </p>
                            )}
                            {isPaid && (
                                <div className="flex gap-2">
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={actionLoading === "cancel"}
                                            >
                                                구독 취소
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>구독을 취소하시겠습니까?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Free 플랜으로 다운그레이드됩니다. 제한을 초과하는 데이터는 삭제되지 않지만,
                                                    새로운 데이터 추가가 제한될 수 있습니다.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>취소</AlertDialogCancel>
                                                <AlertDialogAction onClick={handleCancel}>
                                                    구독 취소
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-muted-foreground">플랜 정보를 불러올 수 없습니다.</p>
                    )}
                </CardContent>
            </Card>

            {/* 플랜 변경 */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">플랜 변경</CardTitle>
                    <CardDescription>팀 규모에 맞는 플랜을 선택하세요</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        {data.allPlans.map((plan) => {
                            const isCurrent = plan.slug === currentSlug;
                            const isUpgrade = plan.price > (data.plan?.price ?? 0);

                            return (
                                <div
                                    key={plan.slug}
                                    className={`rounded-lg border p-4 flex flex-col ${
                                        isCurrent
                                            ? "border-primary bg-primary/5"
                                            : ""
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-semibold">{plan.name}</h4>
                                        {isCurrent && (
                                            <Badge variant="outline">현재</Badge>
                                        )}
                                    </div>
                                    <div className="mt-2">
                                        <span className="text-2xl font-bold">
                                            {formatPrice(plan.price)}
                                        </span>
                                        {plan.price > 0 && (
                                            <span className="text-sm text-muted-foreground">/월</span>
                                        )}
                                    </div>
                                    <ul className="mt-3 flex-1 space-y-1.5">
                                        {plan.features.map((feature) => (
                                            <li
                                                key={feature}
                                                className="flex items-center gap-1.5 text-sm"
                                            >
                                                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                                                {feature}
                                            </li>
                                        ))}
                                    </ul>
                                    <Button
                                        className="mt-4 w-full"
                                        variant={isCurrent ? "outline" : isUpgrade ? "default" : "outline"}
                                        disabled={isCurrent || actionLoading !== null}
                                        onClick={() => handleSelectPlan(plan.slug)}
                                    >
                                        {actionLoading === plan.slug ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : isCurrent ? (
                                            "현재 플랜"
                                        ) : isUpgrade ? (
                                            "업그레이드"
                                        ) : (
                                            "다운그레이드"
                                        )}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* 결제 내역 */}
            {data.payments.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">결제 내역</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {data.payments.map((payment) => (
                                <div
                                    key={payment.id}
                                    className="flex items-center justify-between rounded-md border px-4 py-2.5 text-sm"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-muted-foreground">
                                            {formatDate(payment.paidAt || payment.createdAt)}
                                        </span>
                                        <span className="font-medium">
                                            {formatPrice(payment.amount)}
                                        </span>
                                    </div>
                                    <Badge
                                        variant={payment.status === "done" ? "default" : "secondary"}
                                    >
                                        {payment.status === "done"
                                            ? "완료"
                                            : payment.status === "canceled"
                                              ? "취소"
                                              : payment.status === "failed"
                                                ? "실패"
                                                : "대기"}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
