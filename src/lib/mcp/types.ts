import type { ApiTokenInfo } from "@/lib/auth";

/**
 * MCP 툴의 공용 타입. tools.ts와 tracker-tools.ts가 함께 쓴다.
 * tools.ts에서 export하면 순환 참조가 되므로 별 파일로 둔다.
 */

export type ToolResult = {
    content: { type: "text"; text: string }[];
    isError?: boolean;
};

export type ToolHandler = (
    args: Record<string, unknown>,
    tokenInfo: ApiTokenInfo
) => Promise<ToolResult>;

export function ok(data: unknown): ToolResult {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function err(message: string): ToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}
