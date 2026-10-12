import { NextRequest, NextResponse } from "next/server";
import { processCustomerJourneyAlerts } from "@/lib/customer-journey-alert";
import { customerJourneySchedulerStatus } from "@/lib/customer-journey-scheduler";

function authorized(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const token = req.headers.get("x-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
    return Boolean(secret && token === secret);
}

export async function GET(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    return NextResponse.json({ success: true, data: customerJourneySchedulerStatus() });
}

export async function POST(req: NextRequest) {
    if (!authorized(req)) return NextResponse.json({ success: false, error: "인증에 실패했습니다." }, { status: 401 });
    try {
        return NextResponse.json({ success: true, data: await processCustomerJourneyAlerts() });
    } catch {
        return NextResponse.json({ success: false, error: "고객 여정 카드 처리에 실패했습니다." }, { status: 500 });
    }
}
