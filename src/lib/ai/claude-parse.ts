import type { ContentBlock, Usage } from "@anthropic-ai/sdk/resources/messages";

export interface SearchSource {
    url: string;
    title: string;
}

// 검색 응답은 text 블록이 여러 개로 쪼개져 오므로 전부 이어붙인다.
// thinking·server_tool_use·web_search_tool_result 블록은 무시.
export function extractText(blocks: ContentBlock[]): string {
    return blocks
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
}

// web_search_tool_result의 content는 `에러 객체 | 결과 배열` union이다.
// 에러 갈래에 .map을 호출하면 TypeError가 나고 상위 catch가 이를 삼켜 조용히 전량 실패한다.
export function extractSearchSources(blocks: ContentBlock[]): SearchSource[] {
    const sources: SearchSource[] = [];
    const seen = new Set<string>();

    for (const block of blocks) {
        if (block.type !== "web_search_tool_result") continue;
        const content = block.content;
        if (!Array.isArray(content)) continue;

        for (const item of content) {
            if (item.type !== "web_search_result" || !item.url) continue;
            if (seen.has(item.url)) continue;
            seen.add(item.url);
            sources.push({ url: item.url, title: item.title || item.url });
        }
    }

    return sources;
}

// 웹검색 경로에서 모델이 인용 태그를 본문에 섞는다.
// 실측상 여는 태그가 `(cite index="21-1">` 또는 `<cite index="21-1">` 두 형태로 나온다.
// 그대로 두면 메일 본문·회사 설명에 태그가 노출되므로 파싱 전에 벗긴다.
export function stripCitationTags(text: string): string {
    return text.replace(/[(<]cite\b[^>]*>/g, "").replace(/<\/cite>/g, "");
}

export function toUsage(usage: Usage | undefined): { promptTokens: number; completionTokens: number } {
    return {
        promptTokens: usage?.input_tokens ?? 0,
        completionTokens: usage?.output_tokens ?? 0,
    };
}
