import http from "node:http";
import { createEsignQaFixture, QA_ORG, QA_USER } from "./esign-qa-fixture";
import { handleEsignRequest } from "../src/lib/esign/http";
import { handleEsignPreviewRequest } from "../src/lib/esign/preview";

async function main() {
    if (process.env.NODE_ENV === "production" || process.env.ESIGN_QA_ALLOW_FAKE !== "yes") throw Error("Run only explicitly opted-in local isolated QA");
    const port = Number(process.env.ESIGN_QA_PORT || 3158), upstream = Number(process.env.ESIGN_QA_NEXT_PORT || 3159);
    if (![port, upstream].every(n => Number.isInteger(n) && n > 1024 && n < 65536)) throw Error("Invalid local port");
    const fixture = await createEsignQaFixture();
    const server = http.createServer(async (req, res) => {
        try {
            const pathname = new URL(req.url || "/", `http://127.0.0.1:${port}`).pathname;
            const json = (data: unknown) => { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
            if (pathname === "/__qa/outbox") return json(fixture.outbox);
            if (pathname === "/__qa/flush" && req.method === "POST") { await fixture.flush(); return json({ ok: true }); }
            if (pathname === "/__qa/fixture.pdf") { res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" }); res.end(fixture.pdfBytes); return; }
            if (pathname === "/api/auth/me") return json({ success: true, user: { userId: QA_USER, orgId: QA_ORG, name: "가상 검수 담당자", email: "operator@isolated.example.test", role: "admin", onboardingCompleted: true, organizations: [{ organizationId: QA_ORG, orgName: "전자서명 격리 검수", orgSlug: "isolated-qa", role: "admin" }] } });
            if (pathname === "/api/workspaces") return json({ success: true, data: [{ id: 101, name: "가상 디하 검수", description: "가상 자료", icon: null, defaultFieldTypeId: null }, { id: 102, name: "가상 백오랩 검수", description: "가상 자료", icon: null, defaultFieldTypeId: null }] });
            if (pathname.startsWith("/api/esign")) {
                const chunks: Buffer[] = []; let size = 0;
                for await (const bytes of req) { size += bytes.length; if (size > 12 * 1024 * 1024) { res.writeHead(413); res.end(); return; } chunks.push(Buffer.from(bytes)); }
                const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
                const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
                const response = pathname.startsWith("/api/esign-preview/")
                    ? await handleEsignPreviewRequest(request, { enabled: true, actor: async () => ({ orgId: QA_ORG, userId: QA_USER, name: "가상 검수 담당자" }) })
                    : await handleEsignRequest(request, fixture.dependencies);
                res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
            }
            if (pathname.startsWith("/api/")) return json({ success: true, data: [] });
            const forward = http.request({ hostname: "127.0.0.1", port: upstream, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${upstream}` } }, response => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
            forward.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("Local UI server is not ready"); }); req.pipe(forward);
        } catch { if (!res.headersSent) res.writeHead(500); res.end("Isolated QA request failed"); }
    });
    server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ isolated: true, url: `http://127.0.0.1:${port}/esign`, fixturePdf: `http://127.0.0.1:${port}/__qa/fixture.pdf`, actualExternalDelivery: false, actualCustomerDatabase: false })));
    const stop = () => { server.close(); void fixture.close().finally(() => process.exit(0)); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
main().catch(e => { console.error(e.name + ": " + e.message); process.exitCode = 1; });
