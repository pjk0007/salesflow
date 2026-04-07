import { NextRequest } from "next/server";
import { resolveApiToken } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";
import { createMcpToolHandlers, TOOL_DEFINITIONS } from "@/lib/mcp/tools";

export async function POST(req: NextRequest) {
    // ── Auth ──
    const tokenStr = extractToken(req);
    if (!tokenStr) {
        return Response.json(
            { jsonrpc: "2.0", error: { code: -32000, message: "API 토큰이 필요합니다. Authorization: Bearer <token>" }, id: null },
            { status: 401 }
        );
    }

    const tokenInfo = await resolveApiToken(tokenStr);
    if (!tokenInfo) {
        return Response.json(
            { jsonrpc: "2.0", error: { code: -32000, message: "유효하지 않은 API 토큰입니다." }, id: null },
            { status: 401 }
        );
    }

    // ── JSON-RPC Dispatch ──
    try {
        const body = await req.json();
        const response = await handleJsonRpc(body, tokenInfo);
        return Response.json(response);
    } catch (error) {
        console.error("MCP request error:", error);
        return Response.json(
            { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
            { status: 500 }
        );
    }
}

export async function GET() {
    return Response.json({
        name: "SalesFlow MCP Server",
        version: "1.0.0",
        description: "SalesFlow CRM 데이터에 접근하는 MCP 서버입니다.",
        instructions: "API 토큰을 Authorization: Bearer <token> 헤더로 전달해주세요. 설정 > API 토큰에서 토큰을 발급받을 수 있습니다.",
    });
}

export async function DELETE() {
    return new Response(null, { status: 200 });
}

function extractToken(req: NextRequest): string | null {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) return authHeader.substring(7);
    return req.headers.get("x-api-key");
}

async function handleJsonRpc(body: unknown, tokenInfo: ApiTokenInfo) {
    const msg = body as { jsonrpc: string; method: string; params?: Record<string, unknown>; id?: unknown };

    switch (msg.method) {
        case "initialize":
            return {
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                    protocolVersion: "2025-03-26",
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "SalesFlow", version: "1.0.0" },
                    instructions: "SalesFlow CRM 데이터에 접근하는 MCP 서버입니다. 레코드 조회/생성/수정/삭제, 발송 이력 조회, 통계 조회가 가능합니다.",
                },
            };

        case "notifications/initialized":
        case "notifications/cancelled":
            return { jsonrpc: "2.0", id: msg.id, result: {} };

        case "ping":
            return { jsonrpc: "2.0", id: msg.id, result: {} };

        case "tools/list":
            return { jsonrpc: "2.0", id: msg.id, result: { tools: TOOL_DEFINITIONS } };

        case "tools/call": {
            const { name, arguments: args } = msg.params as { name: string; arguments?: Record<string, unknown> };
            const handlers = createMcpToolHandlers();
            const handler = handlers[name];

            if (!handler) {
                return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown tool: ${name}` } };
            }

            try {
                const result = await handler(args ?? {}, tokenInfo);
                return { jsonrpc: "2.0", id: msg.id, result };
            } catch (error) {
                console.error(`MCP tool ${name} error:`, error);
                return {
                    jsonrpc: "2.0", id: msg.id,
                    result: {
                        content: [{ type: "text", text: `도구 실행 오류: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    },
                };
            }
        }

        default:
            return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
}
