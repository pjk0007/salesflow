import { z } from "zod";

// 단계 매칭 조건 — 3가지 타입
export const stageMatchSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("record_event"),
        eventType: z.string().min(1).max(50),
        label: z.string().max(100).optional(),
    }),
    z.object({
        type: z.literal("record_field"),
        field: z.string().min(1).max(100),
        value: z.string().min(1).max(200),
    }),
    z.object({
        type: z.literal("page_url"),
        pathPrefix: z.string().min(1).max(200),
    }),
]);

export const funnelStageSchema = z.object({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(100),
    match: stageMatchSchema,
});

export const funnelCreateSchema = z.object({
    siteId: z.number().int().positive(),
    name: z.string().min(1).max(200),
    stages: z.array(funnelStageSchema).min(1).max(20),
    isDefault: z.boolean().optional(),
});

export const funnelUpdateSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    stages: z.array(funnelStageSchema).min(1).max(20).optional(),
    isDefault: z.boolean().optional(),
});

export type FunnelCreatePayload = z.infer<typeof funnelCreateSchema>;
export type FunnelUpdatePayload = z.infer<typeof funnelUpdateSchema>;
