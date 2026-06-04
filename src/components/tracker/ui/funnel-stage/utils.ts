import type { StageMatch } from "../../types/funnel";

export function slugify(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

export function defaultMatchFor(type: StageMatch["type"]): StageMatch {
    if (type === "record_field") return { type, field: "", value: "" };
    if (type === "custom_event") return { type, eventName: "" };
    return { type: "page_url", pathPrefix: "" };
}
