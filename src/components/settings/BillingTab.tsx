import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { toast } from "sonner";
import { useSession } from "@/contexts/SessionContext";
import { Loader2, Check, AlertTriangle } from "lucide-react";

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
        retryCount: number;
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
    const [loadError, setLoadError] = useState<string | null>(null);
    const busy = useRef(false);
    const { confirm, confirmationDialog } = useAsyncConfirm();

    const fetchBilling = useCallback(async () => {
        setLoadError(null);
        try {
            const res = await fetch("/api/billing/status");
            const json = await res.json();
            if (res.ok && json.success) {
                setData(json.data);
            } else {
                setLoadError(json.error || "요금제 정보를 불러올 수 없습니다.");
            }
        } catch {
            setLoadError("요금제 정보를 불러올 수 없습니다.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBilling();
    }, [fetchBilling]);

    const handleSelectPlan = async (planSlug: string) => {
        if (planSlug === "free") return handleCancel();
        if (busy.current) return { success: false, error: "다른 결제를 처리 중입니다." };
        busy.current = true;
        setActionLoading(planSlug);
        try {
            if (!data?.subscription?.hasBillingKey) {
                await openTossPayment(planSlug);
                return;
            }
            const res = await fetch("/api/billing/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planSlug }),
            });
            const json = await res.json();

            if (res.ok && json.success) {
                toast.success("플랜이 변경되었습니다.");
                await fetchBilling();
            } else if (json.needBillingKey) {
                await openTossPayment(planSlug);
            } else {
                return { success: false, error: json.error || "플랜 변경에 실패했습니다." };
            }
        } catch {
            return { success: false, error: "결제 결과를 확인하지 못했습니다. 다시 결제하기 전에 요금제와 결제 내역을 확인해주세요." };
        } finally {
            busy.current = false;
            setActionLoading(null);
        }
    };

    const openTossPayment = async (planSlug: string) => {
        try {
            const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
            if (!clientKey) {
                throw new Error("결제 설정이 완료되지 않았습니다.");
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
        } catch (error) {
            throw new Error(error instanceof Error && /[가-힣]/.test(error.message) ? error.message : "결제창을 열 수 없습니다.");
        }
    };

    const handleCancel = async () => {
        if (busy.current) return { success: false, error: "다른 결제를 처리 중입니다." };
        busy.current = true;
        setActionLoading("cancel");
        try {
            const res = await fetch("/api/billing/cancel", { method: "POST" });
            const json = await res.json();

            if (res.ok && json.success) {
                toast.success("구독이 취소되었습니다. Free 플랜으로 변경되었습니다.");
                await fetchBilling();
            } else {
                return { success: false, error: json.error || "구독 취소에 실패했습니다." };
            }
        } catch {
            return { success: false, error: "구독 취소 결과를 확인하지 못했습니다. 구독 상태를 확인해주세요." };
        } finally {
            busy.current = false;
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

    if (!data) return <QueryErrorState error={loadError || "요금제 정보를 불러올 수 없습니다."} onRetry={fetchBilling} />;

    const currentSlug = data.plan?.slug ?? "free";
    const isPaid = currentSlug !== "free";
    const isSuspended = data.subscription?.status === "suspended";

    return (
        <div className="space-y-6">
            {confirmationDialog}
            {loadError && <QueryErrorState error={loadError} onRetry={fetchBilling} />}
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
                                {isSuspended && (
                                    <Badge variant="destructive">일시정지</Badge>
                                )}
                            </div>
                            {data.subscription?.currentPeriodEnd && !isSuspended && (
                                <p className="text-sm text-muted-foreground">
                                    다음 결제일: {formatDate(data.subscription.currentPeriodEnd)}
                                </p>
                            )}
                            {isSuspended && (
                                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
                                    <div className="flex items-center gap-2 text-sm text-destructive">
                                        <AlertTriangle className="h-4 w-4" />
                                        결제 실패로 구독이 일시정지되었습니다.
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        정지 중에는 Free 한도가 적용됩니다. 아래에서 복구할 플랜과 결제 금액을 확인해주세요.
                                    </p>
                                    <Button
                                        size="sm"
                                        onClick={() => document.getElementById("billing-plans")?.scrollIntoView({ behavior: "smooth" })}
                                        disabled={actionLoading !== null}
                                    >
                                        복구할 플랜 선택
                                    </Button>
                                </div>
                            )}
                            {isPaid && !isSuspended && user?.role === "owner" && (
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" disabled={actionLoading !== null}
                                        onClick={() => confirm({
                                            title: "구독을 취소하시겠습니까?", confirmLabel: "구독 취소",
                                            description: "Free 플랜으로 변경됩니다. 기존 데이터는 삭제되지 않지만 새로운 데이터 추가가 제한될 수 있습니다.",
                                            onConfirm: handleCancel,
                                        })}>구독 취소</Button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-muted-foreground">플랜 정보를 불러올 수 없습니다.</p>
                    )}
                </CardContent>
            </Card>

            {/* 플랜 변경 */}
            <Card id="billing-plans">
                <CardHeader>
                    <CardTitle className="text-lg">플랜 변경</CardTitle>
                    <CardDescription>팀 규모에 맞는 플랜을 선택하세요</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        {data.allPlans.map((plan) => {
                            const isCurrent = plan.slug === currentSlug && !isSuspended;
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
                                        disabled={isCurrent || actionLoading !== null || user?.role === "member" || (plan.price === 0 && user?.role !== "owner")}
                                        onClick={() => confirm({
                                            title: plan.price === 0 ? "Free 플랜으로 변경하시겠습니까?" : `${plan.name} 플랜으로 변경하시겠습니까?`,
                                            description: plan.price === 0
                                                ? "유료 구독이 취소됩니다. 기존 데이터는 삭제되지 않지만 새 데이터 추가가 제한될 수 있습니다."
                                                : `${formatPrice(plan.price)}이 지금 결제되며 새 이용 기간이 시작됩니다. 기존 이용 기간에 대한 일할 차감은 적용되지 않습니다.${!data.subscription?.hasBillingKey ? " 카드 등록 후 결제됩니다." : ""}`,
                                            confirmLabel: plan.price === 0 ? "구독 취소" : "확인 후 결제",
                                            onConfirm: () => handleSelectPlan(plan.slug),
                                        })}
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
                                                : payment.status === "pending"
                                                  ? "결과 확인 중"
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
