import { z } from "zod";
const scope = {
    workspaceId: z.number().int().positive(),
    externalId: z.string().trim().min(1).max(200),
};
const relations = {
    contactId: z.string().uuid().nullable().optional(),
    companyId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
};
export const stagesInput = z
    .array(
        z
            .object({
                id: z.string().uuid(),
                name: z.string().trim().min(1).max(60),
                category: z.enum(["open", "won", "lost"]),
            })
            .strict(),
    )
    .min(1)
    .max(20)
    .refine(
        (rows) => new Set(rows.map((s) => s.id)).size === rows.length,
        "단계 번호는 중복될 수 없습니다.",
    );
export const pipelineInput = z
    .object({
        ...scope,
        name: z.string().trim().min(1).max(100),
        stages: stagesInput,
    })
    .strict();
const dealFields = {
    title: z.string().trim().min(1).max(200),
    pipelineId: z.string().uuid(),
    stageId: z.string().uuid(),
    ...relations,
    amount: z
        .string()
        .regex(
            /^\d{1,15}(?:\.\d{1,2})?$/,
            "금액은 0 이상의 소수 둘째 자리까지 입력해주세요.",
        ),
    currency: z.string().regex(/^[A-Z]{3}$/),
    expectedCloseDate: z.iso.date().nullable().optional(),
    notes: z.string().max(5000).optional(),
};
export const dealInput = z.object({ ...scope, ...dealFields }).strict();
export const dealPatch = z
    .object(dealFields)
    .partial()
    .extend({
        version: z.number().int().positive(),
        archived: z.boolean().optional(),
    })
    .strict();
const taskFields = {
    title: z.string().trim().min(1).max(200),
    body: z.string().max(5000).optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    ...relations,
    dealId: z.string().uuid().nullable().optional(),
    status: z.enum(["open", "done", "cancelled"]).optional(),
};
export const taskInput = z.object({ ...scope, ...taskFields }).strict();
export const taskPatch = z
    .object(taskFields)
    .partial()
    .extend({ version: z.number().int().positive() })
    .strict();
export const pipelinePatch = z
    .object({
        version: z.number().int().positive(),
        name: z.string().trim().min(1).max(100).optional(),
        stages: stagesInput.optional(),
    })
    .strict();
export const salesListInput = z.object({
    q: z.string().trim().max(200).default(""),
    before: z.string().uuid().optional(),
    pipelineId: z.string().uuid().optional(),
    status: z.enum(["open", "done", "cancelled"]).optional(),
    archived: z.enum(["true", "false"]).default("false"),
});
