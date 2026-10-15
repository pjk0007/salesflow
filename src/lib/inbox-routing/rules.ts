import { z } from "zod";
const memberIds = z
    .array(z.string().uuid())
    .max(100, "팀원은 100명까지 선택할 수 있습니다.")
    .refine((v) => new Set(v).size === v.length, "팀원이 중복되었습니다.");
const fields = {
    name: z
        .string()
        .trim()
        .min(1, "팀 이름을 입력해주세요.")
        .max(100, "팀 이름은 100자까지 입력할 수 있습니다."),
    description: z
        .string()
        .trim()
        .max(500, "담당 업무는 500자까지 입력할 수 있습니다."),
    autoAssign: z.boolean(),
    requireAvailable: z.boolean(),
    requireBusinessHours: z.boolean(),
    enabled: z.boolean(),
    memberIds,
};
export const createTeamInput = z
    .object({
        channelId: z.number().int().positive(),
        name: fields.name,
        description: fields.description.default(""),
        autoAssign: fields.autoAssign.default(false),
        requireAvailable: fields.requireAvailable.default(false),
        requireBusinessHours: fields.requireBusinessHours.default(false),
        enabled: fields.enabled.default(true),
        memberIds: fields.memberIds.default([]),
    })
    .strict();
export const patchTeamInput = z
    .object({
        name: fields.name.optional(),
        description: fields.description.optional(),
        autoAssign: fields.autoAssign.optional(),
        requireAvailable: fields.requireAvailable.optional(),
        requireBusinessHours: fields.requireBusinessHours.optional(),
        enabled: fields.enabled.optional(),
        memberIds: fields.memberIds.optional(),
        version: z.number().int().positive(),
    })
    .strict()
    .refine(
        (v) => Object.keys(v).some((k) => k !== "version"),
        "변경할 내용을 선택해주세요.",
    );
