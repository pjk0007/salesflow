import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { uploadToR2 } from "@/lib/r2";
import { randomBytes } from "crypto";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
        return NextResponse.json({ success: false, error: "파일이 없습니다." }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
            { success: false, error: "지원하지 않는 파일 형식입니다. (JPG, PNG, GIF, WebP)" },
            { status: 400 }
        );
    }

    if (file.size > MAX_SIZE) {
        return NextResponse.json(
            { success: false, error: "파일 크기는 5MB 이하여야 합니다." },
            { status: 400 }
        );
    }

    const ext = file.name.split(".").pop() || "png";
    const key = `alimtalk/${randomBytes(12).toString("hex")}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const url = await uploadToR2(buffer, key, file.type);

    return NextResponse.json({
        success: true,
        data: { url, fileName: file.name },
    });
}
