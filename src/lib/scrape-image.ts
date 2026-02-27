/**
 * 사이트 URL에서 대표 이미지를 추출합니다.
 * 우선순위: og:image > twitter:image > apple-touch-icon > favicon
 */
export async function scrapeImageUrl(siteUrl: string): Promise<string | null> {
    try {
        const res = await fetch(siteUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesBot/1.0)" },
            redirect: "follow",
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return fallbackFavicon(siteUrl);

        const html = await res.text();

        // og:image
        const ogImage = extractMeta(html, 'property="og:image"') || extractMeta(html, "property='og:image'");
        if (ogImage) return resolveUrl(siteUrl, ogImage);

        // twitter:image
        const twImage = extractMeta(html, 'name="twitter:image"') || extractMeta(html, "name='twitter:image'");
        if (twImage) return resolveUrl(siteUrl, twImage);

        // apple-touch-icon
        const appleIcon = extractLink(html, 'rel="apple-touch-icon"') || extractLink(html, "rel='apple-touch-icon'");
        if (appleIcon) return resolveUrl(siteUrl, appleIcon);

        // favicon link
        const favicon = extractLink(html, 'rel="icon"') || extractLink(html, "rel='icon'")
            || extractLink(html, 'rel="shortcut icon"');
        if (favicon) return resolveUrl(siteUrl, favicon);

        return fallbackFavicon(siteUrl);
    } catch {
        return fallbackFavicon(siteUrl);
    }
}

function extractMeta(html: string, attr: string): string | null {
    const regex = new RegExp(`<meta[^>]*${attr.replace(/"/g, '["\']')}[^>]*content=["']([^"']+)["']`, "i");
    const match = html.match(regex);
    if (match) return match[1];
    // content가 앞에 올 수도 있음
    const regex2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attr.replace(/"/g, '["\']')}`, "i");
    const match2 = html.match(regex2);
    return match2?.[1] ?? null;
}

function extractLink(html: string, attr: string): string | null {
    const regex = new RegExp(`<link[^>]*${attr.replace(/"/g, '["\']')}[^>]*href=["']([^"']+)["']`, "i");
    const match = html.match(regex);
    if (match) return match[1];
    const regex2 = new RegExp(`<link[^>]*href=["']([^"']+)["'][^>]*${attr.replace(/"/g, '["\']')}`, "i");
    const match2 = html.match(regex2);
    return match2?.[1] ?? null;
}

function resolveUrl(base: string, path: string): string {
    if (path.startsWith("http")) return path;
    try {
        return new URL(path, base).href;
    } catch {
        return path;
    }
}

function fallbackFavicon(siteUrl: string): string | null {
    try {
        const origin = new URL(siteUrl).origin;
        return `${origin}/favicon.ico`;
    } catch {
        return null;
    }
}
