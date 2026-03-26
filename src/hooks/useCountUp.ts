import { useRef, useEffect, useState, useCallback } from "react";

interface UseCountUpOptions {
    end: number;
    duration?: number;
    start?: boolean;
    decimals?: number;
}

export function useCountUp({ end, duration = 2000, start = true, decimals = 0 }: UseCountUpOptions) {
    const [value, setValue] = useState(0);
    const rafRef = useRef<number>(0);

    const animate = useCallback(() => {
        const startTime = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            const current = eased * end;

            setValue(decimals > 0 ? parseFloat(current.toFixed(decimals)) : Math.floor(current));

            if (progress < 1) {
                rafRef.current = requestAnimationFrame(tick);
            }
        };

        rafRef.current = requestAnimationFrame(tick);
    }, [end, duration, decimals]);

    useEffect(() => {
        if (start) animate();
        return () => cancelAnimationFrame(rafRef.current);
    }, [start, animate]);

    return value;
}
