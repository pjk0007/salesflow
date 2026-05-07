/**
 * 요청 origin이 등록된 도메인 목록과 매칭되는지 검사.
 * sendBeacon은 origin을 안 보낼 수 있으니 빈 origin은 통과시킴.
 */
export function matchesDomain(origin: string, domains: string[]): boolean {
    if (!origin) return true;
    try {
        const host = new URL(origin).hostname.toLowerCase();
        return domains.some((d) => {
            const domain = d.toLowerCase();
            return (
                host === domain ||
                host === `www.${domain}` ||
                `www.${host}` === domain
            );
        });
    } catch {
        return false;
    }
}
