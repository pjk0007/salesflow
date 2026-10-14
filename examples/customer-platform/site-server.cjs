/* eslint-disable @typescript-eslint/no-require-imports -- Node.js에서 직접 실행하는 로컬 통합 예제 */
/* 로컬 통합 예제. 가상 로그인은 실제 서비스의 검증된 로그인 세션으로 교체합니다. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createMemberIdentityHandler } = require("../../sdk/server.ts");

function startSite({ client, workspaceId, channel, port, title, accent }) {
    const origin = `http://127.0.0.1:${port}`;
    const profiles = {
        a: {
            id: "member-1",
            name: `가상 ${title} 회원 A`,
            email: "member@example.test",
            company: { id: "company-1", name: `가상 ${title} 기업` },
        },
        b: {
            id: "member-2",
            name: `가상 ${title} 회원 B`,
            email: "member-b@example.test",
        },
    };
    function login(req) {
        const value = /(?:^|;\s*)qa-member=([^;]+)/.exec(
            req.headers.get("cookie") || "",
        )?.[1];
        return value === "anonymous" ? null : profiles[value] || profiles.a;
    }
    const identityHandler = createMemberIdentityHandler({
        client,
        workspaceId,
        channelId: channel.id,
        authenticate: async (req) => login(req),
    });
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, origin);
            let body = "";
            for await (const chunk of req) body += chunk;
            const request = new Request(url, {
                method: req.method,
                headers: req.headers,
                ...(body ? { body } : {}),
            });
            let response;
            if (url.pathname === "/" && req.method === "GET") {
                response = new Response(
                    fs.readFileSync(path.join(__dirname, "site.html")),
                    { headers: { "Content-Type": "text/html; charset=utf-8" } },
                );
            } else if (url.pathname === "/api/demo/config") {
                response = Response.json({
                    title,
                    accent,
                    channelKey: channel.publicKey,
                    apiBase: "http://127.0.0.1:3120",
                    profile: login(request),
                });
            } else if (url.pathname === "/api/chat-identity") {
                response = await identityHandler(request);
            } else if (
                url.pathname === "/api/demo/login" &&
                req.method === "POST"
            ) {
                if (request.headers.get("origin") !== origin)
                    response = new Response("허용되지 않은 요청", {
                        status: 403,
                    });
                else {
                    const member = JSON.parse(body).member;
                    if (!["a", "b", "anonymous"].includes(member))
                        response = new Response("잘못된 가상 회원", {
                            status: 400,
                        });
                    else
                        response = Response.json(
                            { success: true },
                            {
                                headers: {
                                    "Set-Cookie": `qa-member=${member}; HttpOnly; SameSite=Lax; Path=/`,
                                },
                            },
                        );
                }
            } else response = new Response("Not found", { status: 404 });
            res.writeHead(response.status, {
                ...Object.fromEntries(response.headers),
                "Cache-Control": "no-store",
            });
            res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
            console.error("로컬 사이트 예제 오류:", error.message);
            res.writeHead(500);
            res.end("로컬 예제를 처리하지 못했습니다.");
        }
    });
    server.listen(port, "127.0.0.1", () =>
        console.log(`${title} 격리 연동 예제: ${origin}`),
    );
    return server;
}
module.exports = { startSite };
