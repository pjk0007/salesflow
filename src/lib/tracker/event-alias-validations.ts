import { z } from "zod";

const allowedTypes = ["SECTION_VIEW", "CLICK", "CUSTOM"] as const;

export const eventAliasCreateSchema = z.object({
    siteId: z.number().int().positive(),
    eventType: z.enum(allowedTypes),
    eventName: z.string().min(1).max(100),
    // Plan 결정 2: 빈 문자열도 허용 (저장은 되지만 UI에선 raw로 fallback).
    label: z.string().max(200),
});

export const eventAliasUpdateSchema = z.object({
    label: z.string().max(200),
});

export type EventAliasCreatePayload = z.infer<typeof eventAliasCreateSchema>;
export type EventAliasUpdatePayload = z.infer<typeof eventAliasUpdateSchema>;
