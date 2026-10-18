import { resolveComparisonPeriod } from "@/lib/tracker/comparison";
import type { ComparisonSelection, Range } from "../types/overview";

export function comparisonFromSearchParams(sp: URLSearchParams, range: Range, now = new Date()): ComparisonSelection {
    if (!sp.has("compareFrom") && !sp.has("compareTo")) return null;
    try {
        const period = resolveComparisonPeriod(range, sp.get("compareFrom"), sp.get("compareTo"), now);
        return { from: period.from, to: period.to };
    } catch {
        return null;
    }
}

export function comparisonSearchParams(selection: ComparisonSelection, current: URLSearchParams): URLSearchParams {
    const next = new URLSearchParams(current);
    if (selection) {
        next.set("compareFrom", selection.from);
        next.set("compareTo", selection.to);
    } else {
        next.delete("compareFrom");
        next.delete("compareTo");
    }
    return next;
}
