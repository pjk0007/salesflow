import { z } from "zod";
import { createHash } from "node:crypto";
import { webhookEventTypes } from "../customer-platform/webhook-rules";
export const workflowEventTypes = webhookEventTypes.filter(
    (t) =>
        t !== "platform.test" &&
        t !== "ai.draft.ready" &&
        t !== "pipeline.created" &&
        t !== "pipeline.updated",
);
const scalar = z.union([
    z.string().max(500),
    z.number().finite(),
    z.boolean(),
    z.null(),
]);
const path = z
    .string()
    .max(140)
    .regex(
        /^(?:event|contact|company|conversation|deal|task)(?:\.[\p{L}\p{N}_ -]+){1,6}$/u,
        "고객 조건의 필드 경로를 확인해주세요.",
    )
    .refine(
        (p) =>
            !p
                .split(".")
                .some((s) =>
                    ["__proto__", "prototype", "constructor"].includes(s),
                ),
        "조건 필드 경로를 확인해주세요.",
    );
export const conditionSchema = z
    .object({
        path,
        op: z.enum([
            "eq",
            "neq",
            "contains",
            "exists",
            "missing",
            "gte",
            "lte",
        ]),
        value: scalar.default(null),
    })
    .strict();
export const groupSchema = z
    .object({
        mode: z.enum(["all", "any"]),
        rules: z.array(conditionSchema).max(12),
    })
    .strict();
const common = {
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(100),
    when: groupSchema,
};
export const workflowStepSchema = z.discriminatedUnion("kind", [
    z
        .object({
            ...common,
            kind: z.literal("wait"),
            minutes: z.number().int().min(1).max(43200),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("tag"),
            tag: z.string().trim().min(1).max(40),
            remove: z.boolean(),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("assign"),
            assigneeId: z.string().uuid().nullable(),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("team"),
            teamId: z.string().uuid("배정할 상담팀을 선택해주세요."),
            onlyUnassigned: z.boolean().default(true),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("status"),
            status: z.enum(["open", "snoozed", "closed"]),
        })
        .strict(),
    z.object({ ...common, kind: z.literal("handoff") }).strict(),
    z
        .object({
            ...common,
            kind: z.literal("task"),
            title: z.string().trim().min(1).max(200),
            body: z.string().max(2000),
            ownerId: z.string().uuid().nullable(),
            dueMinutes: z.number().int().min(0).max(43200),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("contact_stage"),
            stage: z.enum(["lead", "prospect", "customer", "inactive"]),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("deal_stage"),
            pipelineId: z.string().uuid(),
            stageId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("reply"),
            body: z.string().trim().min(1).max(2500),
        })
        .strict(),
    z
        .object({
            ...common,
            kind: z.literal("event"),
            name: z.string().trim().min(1).max(100),
        })
        .strict(),
]);
export const definitionSchema = z
    .object({
        trigger: z
            .object({
                types: z
                    .array(z.enum(webhookEventTypes))
                    .min(1)
                    .max(15)
                    .refine((v) =>
                        v.every((t) =>
                            workflowEventTypes.includes(
                                t as (typeof workflowEventTypes)[number],
                            ),
                        ),
                    ),
                eventName: z.string().trim().max(100),
                when: groupSchema,
            })
            .strict(),
        steps: z
            .array(workflowStepSchema)
            .min(1)
            .max(20)
            .refine(
                (s) => new Set(s.map((v) => v.id)).size === s.length,
                "단계 번호는 중복될 수 없습니다.",
            ),
    })
    .strict()
    .superRefine((v, c) => {
        if (
            v.steps.some((s) => s.kind === "reply") &&
            (v.trigger.types.length !== 1 ||
                v.trigger.types[0] !== "message.created")
        )
            c.addIssue({
                code: "custom",
                message:
                    "자동 안내 답변은 고객 메시지 이벤트에서만 사용할 수 있습니다.",
            });
    });
export type WorkflowDefinition = z.infer<typeof definitionSchema>;
export function matchesTriggerEvent(
    trigger: WorkflowDefinition["trigger"],
    event: { type: string; data: Record<string, unknown> },
) {
    return (
        trigger.types.some((t) => t === event.type) &&
        (event.type !== "customer.event" ||
            !trigger.eventName ||
            (event.data.event as { name?: unknown } | undefined)?.name ===
                trigger.eventName)
    );
}
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowGroup = z.infer<typeof groupSchema>;
export type WorkflowContext = Record<string, unknown>;
export const emptyGroup: WorkflowGroup = { mode: "all", rules: [] };
export const templatePaths = [
    "contact.name",
    "company.name",
    "conversation.name",
    "deal.title",
    "task.title",
];
export const workflowInput = z
    .object({
        workspaceId: z.number().int().positive(),
        version: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(100),
        description: z.string().max(1000),
        definition: definitionSchema,
    })
    .strict();
function canonical(v: unknown): unknown {
    return Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === "object"
          ? Object.fromEntries(
                Object.entries(v)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, x]) => [k, canonical(x)]),
            )
          : v;
}
export const workflowFingerprint = (v: unknown) =>
    createHash("sha256")
        .update(JSON.stringify(canonical(v)))
        .digest("hex");
export function conditionValue(context: WorkflowContext, path: string) {
    let value: unknown = context;
    for (const p of path.split(".")) {
        if (
            ["__proto__", "constructor", "prototype"].includes(p) ||
            !value ||
            typeof value !== "object" ||
            !Object.hasOwn(value, p)
        )
            return undefined;
        value = (value as Record<string, unknown>)[p];
    }
    return value;
}
const norm = (v: string) => v.normalize("NFKC").toLowerCase();
const numeric = (v: unknown) =>
    typeof v === "number"
        ? v
        : typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v)
          ? Number(v)
          : NaN;
export function matchesGroup(group: WorkflowGroup, context: WorkflowContext) {
    const evaluate = (c: z.infer<typeof conditionSchema>) => {
        const got = conditionValue(context, c.path);
        if (c.op === "exists") return got !== undefined && got !== null;
        if (c.op === "missing") return got === undefined || got === null;
        if (got === undefined) return false;
        if (c.op === "eq") return got === c.value;
        if (c.op === "neq") return got !== c.value;
        if (c.op === "contains")
            return typeof got === "string" && typeof c.value === "string"
                ? norm(got).includes(norm(c.value))
                : Array.isArray(got) && got.includes(c.value);
        const n = numeric(got),
            want = numeric(c.value);
        return (
            Number.isFinite(n) &&
            Number.isFinite(want) &&
            (c.op === "gte" ? n >= want : n <= want)
        );
    };
    return (
        !group.rules.length ||
        (group.mode === "all"
            ? group.rules.every(evaluate)
            : group.rules.some(evaluate))
    );
}
export const stepNames: Record<WorkflowStep["kind"], string> = {
    wait: "예약 대기",
    tag: "상담 태그",
    assign: "담당자 배정",
    team: "상담팀 배정",
    status: "상담 상태",
    handoff: "사람에게 이관",
    task: "후속 업무 생성",
    contact_stage: "고객 단계 변경",
    deal_stage: "딜 단계 변경",
    reply: "고객 자동 안내",
    event: "고객 이벤트 기록",
};
export const workflowWorkerEnabled = () =>
    process.env.NODE_ENV === "production" &&
    process.env.CUSTOMER_WORKFLOW_WORKER === "on";
