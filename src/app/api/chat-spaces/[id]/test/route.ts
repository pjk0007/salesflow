import { NextRequest, NextResponse } from "next/server";
import { db, chatSpaces } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";
import { postGoogleChatText } from "@/lib/google-chat";

/** 등록한 웹훅 주소가 맞는지 시험 메시지 한 통을 보낸다 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const spaceId = Number((await params).id);
    if (!Number.isSafeInteger(spaceId) || spaceId <= 0) {
        return NextResponse.json({ success: false, error: "잘못된 스페이스 ID입니다." }, { status: 400 });
    }
    const [space] = await db
        .select({ name: chatSpaces.name, webhookUrl: chatSpaces.webhookUrl })
        .from(chatSpaces)
        .where(and(eq(chatSpaces.id, spaceId), eq(chatSpaces.orgId, auth.user.orgId)));
    if (!space) {
        return NextResponse.json({ success: false, error: "스페이스를 찾을 수 없습니다." }, { status: 404 });
    }

    const result = await postGoogleChatText(
        space.webhookUrl,
        `샌드비 레코드 알림 시험 메시지입니다. (${space.name} · ${auth.user.name})`
    );
    if (!result.ok) {
        // 오류 글에는 웹훅 주소가 가려져 있다 (google-chat.ts scrub)
        return NextResponse.json({ success: false, error: `시험 메시지를 보내지 못했습니다. ${result.error}` }, { status: 502 });
    }
    return NextResponse.json({ success: true });
}
