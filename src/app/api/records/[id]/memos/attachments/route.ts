import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, records } from "@/lib/db";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { uploadToR2 } from "@/lib/r2";

const MAX_SIZE = 20 * 1024 * 1024; // 20MB
// 실행 파일 등은 막는다
const BLOCKED_EXT = new Set(["exe", "bat", "cmd", "sh", "js", "msi", "dll", "app", "html", "htm", "svg"]);

/**
 * POST: 리드 댓글 첨부파일 올리기 — 저장한 주소를 돌려주고, 댓글 등록 때 함께 보낸다.
 * 주의: 지금은 공개 저장소(R2 공개 주소)라 주소를 아는 사람은 열 수 있다. 비공개 저장소 전환은 개발자 확인 후 (2026-11-11 주희님)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const recordId = Number((await params).id);
    const [record] = recordId
        ? await db.select({ id: records.id }).from(records).where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)))
        : [];
    if (!record) {
        return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
        return NextResponse.json({ success: false, error: "파일이 없습니다." }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
        return NextResponse.json({ success: false, error: "파일은 20MB 이하만 올릴 수 있습니다." }, { status: 400 });
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (BLOCKED_EXT.has(ext)) {
        return NextResponse.json({ success: false, error: "올릴 수 없는 파일 형식입니다." }, { status: 400 });
    }

    const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
    const key = `memo-attachments/${user.orgId}/${randomBytes(16).toString("hex")}${safeExt}`;
    const url = await uploadToR2(Buffer.from(await file.arrayBuffer()), key, file.type || "application/octet-stream");

    return NextResponse.json({
        success: true,
        data: { url, name: file.name, type: file.type || "application/octet-stream", size: file.size },
    });
}
