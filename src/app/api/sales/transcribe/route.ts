import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { uploadToR2 } from "@/lib/r2";
import { AUDIO_MAX_BYTES, AUDIO_TYPES, transcribeAudio } from "@/lib/sales/ai";
import { fail, ok, salesHandler } from "@/lib/sales/http";

// 1시간 넘는 녹음은 전사에 시간이 걸린다
export const maxDuration = 300;

// POST: 미팅 녹음 파일 → 저장 + 자동 전사(Gemini). form-data "file"
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return fail("녹음 파일을 선택해주세요.");
        const type = file.type || "audio/mpeg";
        if (!AUDIO_TYPES.includes(type)) return fail("mp3·m4a·wav·webm 같은 녹음 파일만 올릴 수 있습니다.");
        if (file.size > AUDIO_MAX_BYTES) return fail("녹음 파일은 100MB까지 올릴 수 있습니다.", 413);
        const bytes = Buffer.from(await file.arrayBuffer());
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        // 주의: 공개 저장소(R2) — 첨부파일과 같은 정책, 비공개 저장소 전환은 개발자 확인 후
        const key = `sales-recordings/${user.orgId}/${randomBytes(16).toString("hex")}${/^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : ""}`;
        const [audioUrl, result] = await Promise.all([
            uploadToR2(bytes, key, type),
            transcribeAudio(user.orgId, user.userId, { bytes, mimeType: type === "audio/mp3" ? "audio/mpeg" : type, name: file.name }),
        ]);
        return ok({ audioUrl, transcript: result.transcript });
    });
}
