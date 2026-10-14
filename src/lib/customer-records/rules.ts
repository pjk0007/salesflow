import { z } from "zod";
import { companyInput, contactInput } from "@/lib/customer-platform/rules";
export const customerResource = z.enum(["contacts", "companies"]);
export type CustomerResource = z.infer<typeof customerResource>;
export const objectListInput = z.object({
    archived: z.enum(["false", "true", "all"]).default("false"),
});
export const contactPatch = contactInput
    .omit({ workspaceId: true, externalId: true })
    .partial()
    .extend({ version: z.number().int().positive() })
    .strict();
export const companyPatch = companyInput
    .omit({ workspaceId: true, externalId: true })
    .partial()
    .extend({ version: z.number().int().positive() })
    .strict();
export const archiveInput = z
    .object({
        action: z.enum(["archive", "restore"]),
        version: z.number().int().positive(),
        reason: z.string().trim().max(500).default(""),
    })
    .strict();
export type CustomerChange = {
    before: unknown;
    after: unknown;
    beforePresent: boolean;
    afterPresent: boolean;
    beforeLabel?: string;
    afterLabel?: string;
};
export type CustomerChanges = Record<string, CustomerChange>;
