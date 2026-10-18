import type { NextRequest } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { isEsignPreviewRuntime } from "@/lib/esign/preview-config";
import { handleEsignPreviewRequest } from "@/lib/esign/preview";
import { EsignError } from "@/lib/esign/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = (request: NextRequest) => handleEsignPreviewRequest(request, {
    enabled: isEsignPreviewRuntime(process.env),
    async actor() { const user = getUserFromNextRequest(request); if (!user) throw new EsignError("로그인이 필요합니다.", 401); return { orgId: user.orgId, userId: user.userId, name: user.name }; },
});
export { handler as GET, handler as POST, handler as PATCH };
