import { z } from "zod";

// 단계 매칭 조건 — 2가지 타입.
// record_field는 시스템이 자동으로 현재 상태(records.data) + 변경 이력(record_events) 합집합 매칭.
export const stageMatchSchema = z.discriminatedUnion("type", [
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
