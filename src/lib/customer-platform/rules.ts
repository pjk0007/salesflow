import { z } from "zod";
export const attributesInput = z
    .record(z.string().max(100), z.unknown())
    .refine(
        (value) => JSON.stringify(value).length <= 12000,
        "고객 속성은 12,000자까지 저장할 수 있습니다.",
    );
export const companyInput = z
    .object({
        workspaceId: z.number().int().positive(),
        version: z.number().int().positive().optional(),
        externalId: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1).max(200),
        domain: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/)
            .max(253)
            .nullable()
            .optional(),
        attributes: attributesInput.optional(),
    })
    .strict();
export const contactInput = z
    .object({
        workspaceId: z.number().int().positive(),
        version: z.number().int().positive().optional(),
        externalId: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1).max(100),
        email: z
            .email()
            .transform((s) => s.toLowerCase())
            .nullable()
            .optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        recordId: z.number().int().positive().nullable().optional(),
        companyIds: z.array(z.string().uuid()).max(20).optional(),
        lifecycleStage: z
            .enum(["lead", "prospect", "customer", "inactive"])
            .optional(),
        isInternal: z.boolean().optional(),
        attributes: attributesInput.optional(),
    })
    .strict();
export const eventInput = z
    .object({
        eventId: z.string().uuid(),
        name: z.string().trim().min(1).max(100),
        properties: attributesInput.optional(),
        occurredAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict();
export type PlatformPermission = "read" | "create" | "update" | "delete";
export function canAccessWorkspace(
    scopes: readonly {
        scopeType: string;
        scopeId: number;
        permissions: Record<PlatformPermission, boolean>;
    }[],
    workspaceId: number,
    permission: PlatformPermission,
) {
    return scopes.some(
        (scope) =>
            scope.permissions[permission] &&
            (scope.scopeType === "org" ||
                (scope.scopeType === "workspace" &&
                    scope.scopeId === workspaceId)),
    );
}
