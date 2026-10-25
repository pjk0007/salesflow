import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isDevelopmentPreviewRuntime } from "./development-runtime";

/**
 * 개발 체험 자료(`/dev-start/**`)는 public/ 밖(저장소 `dev-preview-assets/`)에 두고
 * 이 함수로만 내보낸다 — public/ 정적 제공은 미들웨어 판정보다 먼저 일어날 수 있다 (UX-225).
 */
export const DEV_PREVIEW_ASSET_DIR = "dev-preview-assets";

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
};

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };

function notFound(request: Request) {
    return new Response(request.method === "HEAD" ? null : "페이지를 찾을 수 없습니다.", { status: 404, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

/** URL 조각을 자료 폴더 안의 파일 경로로 바꾼다. 폴더 밖·숨김 파일·허용하지 않은 형식이면 null. */
export function resolveDevPreviewAsset(segments: readonly string[], root: string): string | null {
    if (!segments.length) return null;
    for (const segment of segments) {
        if (!segment || segment === "." || segment === ".." || segment.startsWith(".") || /[\\/\0:]/.test(segment)) return null;
    }
    if (!CONTENT_TYPES[path.extname(segments[segments.length - 1]).toLowerCase()]) return null;
    const base = path.resolve(root);
    const target = path.resolve(base, ...segments);
    return target.startsWith(base + path.sep) ? target : null;
}

export async function serveDevPreviewAsset(
    request: Request,
    segments: readonly string[] | undefined,
    options: { env?: Record<string, string | undefined>; root?: string } = {},
): Promise<Response> {
    if (!isDevelopmentPreviewRuntime(options.env ?? process.env)) return notFound(request);
    if (!segments?.length) {
        // 기존 링크 `/dev-start/index.html`을 기준으로 상대 경로가 맞도록 시작 화면으로 보낸다.
        return new Response(null, { status: 307, headers: { ...BASE_HEADERS, Location: "/dev-start/index.html" } });
    }
    const file = resolveDevPreviewAsset(segments, options.root ?? path.join(process.cwd(), DEV_PREVIEW_ASSET_DIR));
    if (!file) return notFound(request);
    try {
        if (!(await stat(file)).isFile()) return notFound(request);
        const body = await readFile(file);
        const headers = { ...BASE_HEADERS, "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()], "Content-Length": String(body.byteLength) };
        return new Response(request.method === "HEAD" ? null : new Uint8Array(body), { status: 200, headers });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return notFound(request);
        throw error;
    }
}
