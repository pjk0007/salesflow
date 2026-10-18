"use client";

import { useEffect, useState } from "react";
import { normalizeMarkName, SEAL_STYLES, SIGNATURE_STYLES, type NameMarkKind } from "../utils/name-marks";
import { renderNameMark } from "../utils/render-name-mark";

export function useNameMarks(name: string, kind: NameMarkKind) {
    const [retry, setRetry] = useState(0);
    const [result, setResult] = useState<{ key: string; images: Record<string, string>; error: string }>({ key: "", images: {}, error: "" });
    let normalized = "", validationError = "";
    try { normalized = normalizeMarkName(name, kind); } catch (cause) { validationError = (cause as Error).message; }
    const key = JSON.stringify([kind, normalized, retry]);
    useEffect(() => {
        if (!normalized) return;
        let current = true;
        const timer = setTimeout(() => {
            const styles = kind === "seal" ? SEAL_STYLES : SIGNATURE_STYLES;
            void Promise.all(styles.map(async style => [style.id, await renderNameMark(normalized, kind, style.id)] as const))
                .then(entries => { if (current) setResult({ key, images: Object.fromEntries(entries), error: "" }); })
                .catch(cause => { if (current) setResult({ key, images: {}, error: cause instanceof Error ? cause.message : "미리보기를 만들지 못했습니다." }); });
        }, 250);
        return () => { current = false; clearTimeout(timer); };
    }, [key, normalized, kind]);
    const fresh = result.key === key && !validationError;
    return { images: fresh ? result.images : {}, error: validationError || (fresh ? result.error : ""), loading: !validationError && !fresh, canRetry: fresh && !!result.error, retry: () => setRetry(value => value + 1) };
}
