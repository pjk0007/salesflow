/**
 * 트래커 head 스크립트 스니펫 생성.
 */
export function buildEmbedScript(opts: { apiKey: string; baseUrl: string }): string {
    const collectEndpoint = `${opts.baseUrl}/api/tracker/collect`;
    const identifyEndpoint = `${opts.baseUrl}/api/tracker/identify`;
    return `<script src="${opts.baseUrl}/tracker.js"
        data-api-key="${opts.apiKey}"
        data-endpoint="${collectEndpoint}"
        data-identify-endpoint="${identifyEndpoint}"
        defer></script>`;
}
