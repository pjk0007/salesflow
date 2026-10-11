import { NextRequest, NextResponse } from "next/server";
import { processCustomerJourneyAlerts } from "@/lib/customer-journey-alert";

export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const token = req.headers.get("x-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    if (!secret || token !== secret) return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    try {
        return NextResponse.json({ success: true, data: await processCustomerJourneyAlerts() });
    } catch {
        return NextResponse.json({ success: false, error: "고객 여정 카드 처리에 실패했습니다." }, { status: 500 });
    }
}
