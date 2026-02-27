"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, XCircle } from "lucide-react";

function BillingFailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const code = searchParams.get("code");
    const message = searchParams.get("message");

    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="text-center space-y-4 max-w-md px-4">
                <XCircle className="mx-auto h-12 w-12 text-destructive" />
                <h1 className="text-lg font-medium">결제에 실패했습니다</h1>
                {message && (
                    <p className="text-sm text-muted-foreground">{message}</p>
                )}
                {code && (
                    <p className="text-xs text-muted-foreground">오류 코드: {code}</p>
                )}
                <Button
                    onClick={() => router.push("/settings?tab=billing")}
                    className="mt-4"
                >
                    다시 시도
                </Button>
            </div>
        </div>
    );
}

export default function BillingFailPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                </div>
            }
        >
            <BillingFailContent />
        </Suspense>
    );
}
