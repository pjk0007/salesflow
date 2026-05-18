/**
 * 사용자 입력 도메인을 hostname만 남겨 정규화한다.
 * 트래커 도메인 검증은 URL().hostname 기준이라 프로토콜·포트·경로를 제거해야 한다.
 *
 * "http://localhost:3001/" → "localhost"
 * "https://www.example.com/foo" → "www.example.com"
 * "example.com" → "example.com"
 */
export function normalizeDomain(input: string): string {
    const raw = input.trim().toLowerCase();
    if (!raw) return "";

    const withProtocol = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
    try {
        return new URL(withProtocol).hostname;
    } catch {
        // URL 파싱 실패 시 수동 fallback: 프로토콜·경로·포트 제거
        return raw
            .replace(/^https?:\/\//, "")
            .split("/")[0]
            .split(":")[0];
    }
}
