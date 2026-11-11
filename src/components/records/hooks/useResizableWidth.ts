import { useCallback, useEffect, useState } from "react";

/** 가장자리를 끌어 너비를 바꾸는 패널 — 너비는 localStorage에 기억한다 (실패해도 기본값으로 동작) */
export function useResizableWidth(storageKey: string, initial: number, min: number, max: number) {
    const [width, setWidth] = useState(initial);

    // 저장된 너비는 화면이 뜬 뒤 읽는다 (서버 렌더와 어긋나지 않게)
    useEffect(() => {
        try {
            const saved = Number(localStorage.getItem(storageKey));
            // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소 동기화
            if (saved >= min && saved <= max) setWidth(saved);
        } catch {
            /* 저장소를 못 쓰면 기본 너비 */
        }
    }, [storageKey, min, max]);

    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = width;
            let latest = startWidth;
            const move = (ev: PointerEvent) => {
                latest = Math.min(max, Math.max(min, startWidth + ev.clientX - startX));
                setWidth(latest);
            };
            const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                try {
                    localStorage.setItem(storageKey, String(latest));
                } catch {
                    /* 무시 */
                }
            };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
        },
        [width, min, max, storageKey],
    );

    // 두 번 누르면 기본 너비로
    const onDoubleClick = useCallback(() => {
        setWidth(initial);
        try {
            localStorage.removeItem(storageKey);
        } catch {
            /* 무시 */
        }
    }, [initial, storageKey]);

    return { width, handleProps: { onPointerDown, onDoubleClick } };
}
