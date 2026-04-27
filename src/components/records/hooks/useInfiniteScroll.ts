import { useEffect, useRef } from "react";

interface UseInfiniteScrollOptions {
    enabled: boolean;
    onLoadMore: () => void;
    rootMargin?: string;
}

/**
 * Sentinel 엘리먼트가 뷰포트에 진입하면 onLoadMore 호출.
 * enabled=false면 observer 비활성.
 */
export function useInfiniteScroll<T extends HTMLElement = HTMLDivElement>({
    enabled,
    onLoadMore,
    rootMargin = "200px",
}: UseInfiniteScrollOptions) {
    const sentinelRef = useRef<T | null>(null);
    const onLoadMoreRef = useRef(onLoadMore);

    // 최신 콜백 유지 (observer 재생성 방지)
    useEffect(() => {
        onLoadMoreRef.current = onLoadMore;
    }, [onLoadMore]);

    useEffect(() => {
        if (!enabled) return;
        const el = sentinelRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry?.isIntersecting) {
                    onLoadMoreRef.current();
                }
            },
            { rootMargin }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [enabled, rootMargin]);

    return sentinelRef;
}
