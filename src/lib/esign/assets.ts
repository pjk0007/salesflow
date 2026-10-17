import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { EsignError } from "./types";

/** Only installed, versioned PDF.js resources are public. No contract storage is reachable here. */
export function createEsignAssetReader(root = path.join(process.cwd(), ".esign-runtime", "pdfjs-assets")) {
    return async (version: string, group: string, filename: string): Promise<Response> => {
        const extension = path.extname(filename);
        const permitted = group === "cmaps" ? [".bcmap"] : group === "standard_fonts" ? [".pfb", ".ttf"] : group === "wasm" ? [".wasm", ".js"] : [];
        if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/.test(filename) || !permitted.includes(extension))
            throw new EsignError("PDF 표시 자료를 찾을 수 없습니다.", 404);
        try {
            const file = path.join(root, version, group, filename);
            const metadata = await stat(file);
            if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024) throw new Error("resource_limit");
            const bytes = await readFile(file);
            return new Response(bytes, { headers: {
                "Content-Type": extension === ".js" ? "text/javascript; charset=utf-8" : extension === ".wasm" ? "application/wasm" : "application/octet-stream",
                "Content-Length": String(bytes.length), "Cache-Control": "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
            } });
        } catch { throw new EsignError("PDF 표시 자료를 찾을 수 없습니다.", 404); }
    };
}
export const readEsignRendererAsset = createEsignAssetReader();
