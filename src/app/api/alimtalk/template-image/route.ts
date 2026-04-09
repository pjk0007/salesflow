import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return NextResponse.json({ success: false, error: "알림톡 설정이 필요합니다." }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
        return NextResponse.json({ success: false, error: "파일이 없습니다." }, { status: 400 });
    }

    try {
        const type = req.nextUrl.searchParams.get("type") || formData.get("type") as string | null;
        const imageType = type === "item-highlight" ? "item-highlight" as const : "image" as const;
        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await client.uploadTemplateImage(buffer, file.name, file.type, imageType);

        if (!result.header.isSuccessful || !result.templateImage) {
            return NextResponse.json({ success: false, error: result.header.resultMessage || "이미지 업로드에 실패했습니다." });
        }

        return NextResponse.json({
            success: true,
            data: {
                url: result.templateImage.templateImageUrl,
                fileName: result.templateImage.templateImageName,
            },
        });
    } catch (error) {
        console.error("Template image upload error:", error);
        return NextResponse.json({ success: false, error: "이미지 업로드에 실패했습니다." }, { status: 500 });
    }
}
