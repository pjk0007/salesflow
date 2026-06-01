// 광고 플랫폼 브랜드 심볼 — lucide에 브랜드 로고가 없어 인라인 SVG로 직접.

type Platform = "meta" | "google" | "naver";

export function PlatformIcon({ platform, className = "h-4 w-4" }: { platform: Platform; className?: string }) {
    if (platform === "google") {
        return (
            <svg viewBox="0 0 48 48" className={className} aria-label="Google">
                <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
                <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
                <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
                <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
            </svg>
        );
    }
    if (platform === "meta") {
        return (
            <svg viewBox="0 0 36 36" className={className} aria-label="Meta">
                <defs>
                    <linearGradient id="meta-g" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#0064E1" />
                        <stop offset="1" stopColor="#0082FB" />
                    </linearGradient>
                </defs>
                <path
                    fill="url(#meta-g)"
                    d="M6.9 9.2C8 7.5 9.6 6.2 11.7 6.2c1.7 0 3.1.8 4.6 2.6 1.3 1.5 2.5 3.3 3.9 5.6 1.3-2.2 2.6-4.1 3.9-5.6 1.5-1.8 2.9-2.6 4.6-2.6 3.4 0 6.1 3.6 6.1 9.4 0 4.4-1.8 7.6-4.9 7.6-1.9 0-3.3-1-4.9-3.4-.9-1.4-1.8-2.9-2.7-4.5-1 1.7-1.9 3.2-2.7 4.5-1.6 2.4-3 3.4-4.9 3.4-3.1 0-4.9-3.2-4.9-7.6 0-2 .3-3.8.9-5.3l-.001.001zm17.2 6.4c.8 1.4 1.5 2.5 2.1 3.3.9 1.2 1.5 1.5 2.2 1.5 1.2 0 1.9-1.2 1.9-3.9 0-3.4-1-5.5-2.7-5.5-.9 0-1.6.5-2.5 1.7-.5.6-1 1.4-1.6 2.4l.6.4zM12.6 9.5c-1.7 0-2.7 2.1-2.7 5.5 0 2.7.7 3.9 1.9 3.9.7 0 1.3-.3 2.2-1.5.6-.8 1.3-1.9 2.1-3.3l.6-.4c-.6-1-1.1-1.8-1.6-2.4-.9-1.2-1.6-1.7-2.5-1.7v-.1z"
                />
            </svg>
        );
    }
    // naver
    return (
        <svg viewBox="0 0 48 48" className={className} aria-label="Naver">
            <rect width="48" height="48" rx="8" fill="#03C75A" />
            <path fill="#fff" d="M27.6 24.3 19.9 13H13v22h7.4V23.7L28.1 35H35V13h-7.4v11.3z" />
        </svg>
    );
}
