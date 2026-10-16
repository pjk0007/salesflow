import { isDeepStrictEqual } from "node:util";
import type { CustomerChanges } from "./rules";
export function customerChanges(
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
): CustomerChanges {
    const changes: CustomerChanges = {};
    const compare = (
        path: string,
        old: unknown,
        value: unknown,
        beforePresent: boolean,
        afterPresent: boolean,
    ) => {
        if (beforePresent !== afterPresent || !isDeepStrictEqual(old, value))
            changes[path] = {
                before: old ?? null,
                after: value ?? null,
                beforePresent,
                afterPresent,
            };
    };
    for (const key of [
        "name",
        "email",
        "phone",
        "domain",
        "recordId",
        "lifecycleStage",
        "isInternal",
        "archivedAt",
        "companyIds",
    ])
        if (key in after || (before && key in before)) {
            const old = before?.[key],
                value = after[key];
            compare(
                key,
                key === "companyIds" && Array.isArray(old)
                    ? [...old].sort()
                    : old,
                key === "companyIds" && Array.isArray(value)
                    ? [...value].sort()
                    : value,
                !!before && key in before,
                key in after,
            );
        }
    const old = (before?.attributes ?? {}) as Record<string, unknown>,
        next = (after.attributes ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)]))
        compare(
            `attributes[${JSON.stringify(key)}]`,
            old[key],
            next[key],
            Object.hasOwn(old, key),
            Object.hasOwn(next, key),
        );
    return changes;
}
