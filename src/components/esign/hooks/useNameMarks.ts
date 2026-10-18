"use client";

import { useEffect, useState } from "react";
import { normalizeCompanySealName, normalizeMarkName, normalizeSealCenter, COMPANY_SEAL_STYLES, PERSONAL_SEAL_STYLES, SIGNATURE_STYLES, type NameMarkKind, type SealOptions } from "../utils/name-marks";
import { renderNameMark } from "../utils/render-name-mark";

export function useNameMarks(name: string, kind: NameMarkKind, options: SealOptions) {
    const [retry, setRetry] = useState(0);
    const [result, setResult] = useState<{ key: string; images: Record<string, string>; error: string }>({ key: "", images: {}, error: "" });
    const category = options.category, font = options.font;
    let normalized = "", centerText = "", validationError = "";
    try {
        normalized = kind === "seal" && category === "company" ? normalizeCompanySealName(name) : normalizeMarkName(name, kind);
        if (kind === "seal" && category === "company") centerText = normalizeSealCenter(options.centerText);
    } catch (cause) { validationError = (cause as Error).message; }
    const key = JSON.stringify([kind, normalized, category, font, centerText, retry]);
    useEffect(() => {
        if (!normalized || validationError) return;
        let current = true;
        const timer = setTimeout(() => {
            const styles = kind === "seal" ? category === "company" ? COMPANY_SEAL_STYLES : PERSONAL_SEAL_STYLES : SIGNATURE_STYLES;
            void Promise.all(styles.map(async style => [style.id, await renderNameMark(normalized, kind, style.id, { category, font, centerText })] as const))
                .then(entries => { if (current) setResult({ key, images: Object.fromEntries(entries), error: "" }); })
                .catch(cause => { if (current) setResult({ key, images: {}, error: cause instanceof Error ? cause.message : "미리보기를 만들지 못했습니다." }); });
        }, 250);
        return () => { current = false; clearTimeout(timer); };
    }, [key, normalized, kind, category, font, centerText, validationError]);
    const fresh = result.key === key && !validationError;
    return { images: fresh ? result.images : {}, error: validationError || (fresh ? result.error : ""), loading: !validationError && !fresh, canRetry: fresh && !!result.error, retry: () => setRetry(value => value + 1) };
}
