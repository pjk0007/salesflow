import { NextRequest, NextResponse } from "next/server";
import { processRenewals, processRetries } from "@/lib/billing";

const CRON_SECRET = process.env.CRON_SECRET || "";

export async function POST(req: NextRequest) {
    const secretKey = req.headers.get("x-secret-key");
    if (!CRON_SECRET || secretKey !== CRON_SECRET) {
        return NextResponse.json(
            { success: false, error: "Unauthorized" },
            { status: 401 }
        );
    }

    try {
        const renewResult = await processRenewals();
        const retryResult = await processRetries();

        return NextResponse.json({
            success: true,
            data: {
                renewed: renewResult.renewed,
                renewFailed: renewResult.failed,
                retried: retryResult.retried,
                suspended: retryResult.suspended,
                errors: [...renewResult.errors, ...retryResult.errors],
            },
        });
    } catch (error) {
        console.error("Billing renew error:", error);
        return NextResponse.json(
            { success: false, error: "서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
