import { serveDevPreviewAsset } from "@/lib/development-preview-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 개발 체험 자료는 지정된 개발 서비스에서만 제공한다 (UX-225).
async function handler(request: Request, context: { params: Promise<{ path?: string[] }> }) {
    const { path } = await context.params;
    return serveDevPreviewAsset(request, path);
}

export { handler as GET, handler as HEAD };
