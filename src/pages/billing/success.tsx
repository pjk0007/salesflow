import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function BillingSuccessPage() {
    const router = useRouter();
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

    useEffect(() => {
        const { authKey, customerKey, planSlug } = router.query;

        if (!router.isReady) return;
        if (!authKey || !customerKey) {
            setStatus("error");
            return;
        }

        (async () => {
            try {
                // 1. 빌링키 발급
                const issueRes = await fetch("/api/billing/issue-billing-key", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        authKey: authKey as string,
                        customerKey: customerKey as string,
                    }),
                });
                const issueData = await issueRes.json();

                if (!issueData.success) {
                    toast.error(issueData.error || "빌링키 발급 실패");
                    setStatus("error");
                    return;
                }

                // 2. 플랜이 지정된 경우 구독 변경
                if (planSlug && planSlug !== "free") {
                    const subRes = await fetch("/api/billing/subscribe", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ planSlug }),
                    });
                    const subData = await subRes.json();

                    if (!subData.success) {
                        toast.error(subData.error || "플랜 변경 실패");
                        setStatus("error");
                        return;
                    }
                }

                setStatus("success");
                toast.success("결제 수단이 등록되었습니다.");

                // 3초 후 설정 페이지로 이동
                setTimeout(() => {
                    router.push("/settings?tab=billing");
                }, 2000);
            } catch {
                setStatus("error");
                toast.error("처리 중 오류가 발생했습니다.");
            }
        })();
    }, [router, router.isReady, router.query]);

    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="text-center space-y-4">
                {status === "loading" && (
                    <>
                        <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
                        <p className="text-lg font-medium">결제 수단을 등록하고 있습니다...</p>
                        <p className="text-sm text-muted-foreground">잠시만 기다려주세요.</p>
                    </>
                )}
                {status === "success" && (
                    <>
                        <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
                        <p className="text-lg font-medium">완료되었습니다!</p>
                        <p className="text-sm text-muted-foreground">
                            설정 페이지로 이동합니다...
                        </p>
                    </>
                )}
                {status === "error" && (
                    <>
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                            <span className="text-2xl">!</span>
                        </div>
                        <p className="text-lg font-medium">처리에 실패했습니다</p>
                        <button
                            onClick={() => router.push("/settings?tab=billing")}
                            className="text-sm text-primary underline-offset-4 hover:underline"
                        >
                            설정으로 돌아가기
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
