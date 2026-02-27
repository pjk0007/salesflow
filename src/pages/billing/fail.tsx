import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

export default function BillingFailPage() {
    const router = useRouter();
    const { code, message } = router.query;

    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="text-center space-y-4 max-w-md px-4">
                <XCircle className="mx-auto h-12 w-12 text-destructive" />
                <h1 className="text-lg font-medium">결제에 실패했습니다</h1>
                {message && (
                    <p className="text-sm text-muted-foreground">{message as string}</p>
                )}
                {code && (
                    <p className="text-xs text-muted-foreground">오류 코드: {code as string}</p>
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
