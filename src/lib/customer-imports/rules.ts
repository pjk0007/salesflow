import { createHash } from "node:crypto";
import Papa from "papaparse";
import { z } from "zod";
import { attributesInput } from "@/lib/customer-platform/rules";
import { InboxError } from "@/lib/inbox/errors";
export const kinds = [
    "companies",
    "contacts",
    "pipelines",
    "deals",
    "tasks",
    "conversations",
    "messages",
] as const;
export type ImportKind = (typeof kinds)[number];
export const importStepInput = z.object({
    cursor: z.number().int().min(0),
    batchSize: z.number().int().min(1).max(250).default(25),
}).strict();
export type ImportRow = {
    kind: ImportKind;
    sourceId: string;
    data: Record<string, unknown>;
    original: Record<string, unknown>;
};
export type ImportDependency = {
    kind: ImportKind;
    sourceId: string;
    targetId?: string;
    expected?: string;
};
export type ImportPlanRow = ImportRow & {
    index: number;
    operation: "create" | "link" | "reuse" | "update" | "error";
    targetId: string | null;
    expected: string;
    errors: string[];
    warnings: string[];
    dependencies: ImportDependency[];
};
const id = z.string().min(1).max(200),
    name = z.string().trim().min(1),
    time = z.iso.datetime({ offset: true }).optional();
const common = { externalId: id.optional(), createdAt: time, updatedAt: time };
const relation = { contactId: id.optional(), companyId: id.optional() };
const validators = {
    companies: z.object({
        ...common,
        name: name.max(200),
        domain: z
            .string()
            .trim()
            .toLowerCase()
            .regex(
                /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/,
                "회사 도메인을 확인해주세요.",
            )
            .max(253)
            .optional(),
        attributes: attributesInput.default({}),
    }),
    contacts: z.object({
        ...common,
        name: name.max(100),
        email: z.email().optional(),
        phone: z.string().max(40).optional(),
        companyIds: z.array(id).max(20).default([]),
        attributes: attributesInput.default({}),
        isInternal: z.boolean().default(false),
        lifecycleStage: z
            .enum(["lead", "prospect", "customer", "inactive"])
            .default("lead"),
    }),
    pipelines: z.object({
        ...common,
        name: name.max(100),
        stages: z
            .array(
                z.object({
                    id,
                    name: name.max(60),
                    category: z.enum(["open", "won", "lost"]),
                }),
            )
            .min(1)
            .max(20)
            .refine(
                (stages) =>
                    new Set(stages.map((s) => s.id)).size === stages.length,
                "단계 원본 ID를 구분해주세요.",
            ),
    }),
    deals: z.object({
        ...common,
        ...relation,
        title: name.max(200),
        pipelineId: id,
        stageId: id,
        amount: z
            .string()
            .regex(/^\d{1,15}(?:\.\d{1,2})?$/, "금액 형식을 확인해주세요.")
            .default("0"),
        currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .default("KRW"),
        notes: z.string().max(5000).default(""),
        expectedCloseDate: z.iso.date().optional(),
    }),
    tasks: z.object({
        ...common,
        ...relation,
        title: name.max(200),
        body: z.string().max(5000).default(""),
        dealId: id.optional(),
        status: z.enum(["open", "done", "cancelled"]).default("open"),
        dueAt: time,
    }),
    conversations: z.object({
        contactId: id.optional(),
        name: name.max(100),
        status: z.enum(["open", "closed", "snoozed"]).default("closed"),
        tags: z.array(z.string().min(1).max(30)).max(10).default([]),
        createdAt: time,
    }),
    messages: z.object({
        conversationId: id,
        body: z.string().max(100000).min(1),
        messageKind: z.enum(["customer", "reply", "note"]),
        authorName: name.max(100),
        createdAt: z.iso.datetime({ offset: true }),
        files: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
    }),
};
export const createImportInput = z
    .object({
        workspaceId: z.number().int().positive(),
        source: z.enum(["channel", "intercom", "hubspot", "portable"]),
        namespace: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .regex(
                /^[\p{L}\p{N} _.-]+$/u,
                "원본 계정 이름에는 문자·숫자·공백·점·밑줄만 사용해주세요.",
            ),
        format: z.enum(["json", "csv"]).default("json"),
        content: z.string().min(1).max(5000000),
        csvKind: z.enum(kinds).optional(),
        columns: z.record(z.string(), z.string().max(150)).default({}),
        updateImported: z.boolean().default(false),
        allowPartialHistory: z.boolean().default(false),
        verifiedCustomerHistory: z.boolean().default(false),
        expectedCounts: z
            .record(z.string(), z.number().int().min(0))
            .default({}),
    })
    .strict()
    .refine(
        (input) => !input.verifiedCustomerHistory || input.source === "channel",
        {
            path: ["verifiedCustomerHistory"],
            message: "고객 본인 공개 확인은 채널톡 원본에만 사용할 수 있습니다.",
        },
    );
export type ImportInput = z.infer<typeof createImportInput>;
export function fingerprint(value: unknown): string {
    function stable(v: unknown): unknown {
        if (v instanceof Date) return v.toISOString();
        if (Array.isArray(v)) return v.map(stable);
        if (v && typeof v === "object")
            return Object.fromEntries(
                Object.entries(v)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, x]) => [k, stable(x)]),
            );
        return v;
    }
    return createHash("sha256")
        .update(JSON.stringify(stable(value)))
        .digest("hex");
}
export function sourceExternalId(
    source: string,
    namespace: string,
    kind: ImportKind,
    sourceId: string,
) {
    return `import:${source}:${kind}:${fingerprint([namespace, sourceId])}`;
}
export function sourceUuid(namespace: string, sourceId: string) {
    const h = fingerprint([namespace, sourceId]);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}
export function array(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.map(object);
    const v = object(value);
    return Array.isArray(v.results)
        ? v.results.map(object)
        : Array.isArray(v.data)
          ? v.data.map(object)
          : [];
}
export function text(value: unknown): string | undefined {
    return typeof value === "string"
        ? value || undefined
        : typeof value === "number"
          ? String(value)
          : undefined;
}
export function date(value: unknown): string | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const d = new Date(
        typeof value === "number"
            ? value
            : /^\d{10,13}$/.test(String(value))
              ? Number(value)
              : String(value),
    );
    if (Number.isNaN(d.getTime())) return String(value);
    if (
        (typeof value === "number" || /^\d{10,13}$/.test(String(value))) &&
        Number(value) < 100000000000
    )
        d.setTime(Number(value) * 1000);
    return d.toISOString();
}
export function pathValue(row: Record<string, unknown>, path: string): unknown {
    let value: unknown = row;
    const parts = path.split(".");
    if (
        parts.length > 6 ||
        parts.some((p) => ["__proto__", "constructor", "prototype"].includes(p))
    )
        throw new InboxError("필드 경로를 확인해주세요.");
    for (const part of parts) {
        const next = object(value);
        value = Object.hasOwn(next, part) ? next[part] : undefined;
    }
    return value;
}
export function validateRows(rows: ImportRow[]) {
    return rows.map((row) => {
        const parsed = validators[row.kind].safeParse(row.data);
        return {
            ...row,
            data: parsed.success ? object(parsed.data) : row.data,
            errors: [
                ...(!row.sourceId || row.sourceId.length > 200
                    ? ["원본 ID가 없거나 너무 깁니다."]
                    : []),
                ...(!parsed.success
                    ? parsed.error.issues.map(
                          (i) =>
                              `${i.path.join(".")}: 입력 형식·길이를 확인해주세요.`,
                      )
                    : []),
            ],
        };
    });
}
export function parseCsv(input: ImportInput): ImportRow[] {
    if (!input.csvKind) throw new InboxError("CSV 자료 종류를 선택해주세요.");
    const content = input.content.replace(/^\uFEFF/, ""),
        parsed = Papa.parse<Record<string, string>>(content, {
            header: true,
            skipEmptyLines: "greedy",
        });
    if (
        parsed.errors.length ||
        Object.keys(parsed.meta.renamedHeaders ?? {}).length
    ) {
        // 파일의 줄 번호(머리글=1행)로 알려 준다. 따옴표 오류는 문자 위치(index)가 정확하고,
        // 열 개수 오류는 머리글을 뺀 0부터의 자료 번호(row)만 있다.
        const lines = [
            ...new Set(
                parsed.errors.flatMap((e) =>
                    typeof e.index === "number"
                        ? [content.slice(0, e.index).split("\n").length]
                        : typeof e.row === "number"
                          ? [e.row + 2]
                          : [],
                ),
            ),
        ].sort((a, b) => a - b);
        throw new InboxError(
            `CSV의 따옴표·열 개수·중복 열 이름을 확인해주세요.${
                lines.length
                    ? ` 문제 행: ${lines.slice(0, 10).join(", ")}행${lines.length > 10 ? ` 외 ${lines.length - 10}개` : ""}`
                    : Object.keys(parsed.meta.renamedHeaders ?? {}).length
                      ? ` 중복 열: ${Object.values(parsed.meta.renamedHeaders ?? {}).join(", ")}`
                      : ""
            }`,
        );
    }
    return parsed.data.map((original) => {
        const data: Record<string, unknown> = {};
        for (const [field, column] of Object.entries(input.columns)) {
            if (field === "id") continue;
            const value = column.includes(" + ")
                ? column
                      .split(" + ")
                      .map((part) => pathValue(original, part))
                      .filter(Boolean)
                      .join(" ")
                : pathValue(original, column);
            if (value !== "" && value !== undefined) data[field] = value;
        }
        if (input.csvKind === "contacts" && typeof data.companyIds === "string")
            data.companyIds = data.companyIds.split(";").filter(Boolean);
        if (input.csvKind === "conversations" && typeof data.tags === "string")
            data.tags = data.tags.split(";").filter(Boolean);
        for (const key of ["createdAt", "updatedAt", "dueAt"])
            if (data[key]) data[key] = date(data[key]);
        for (const key of ["stages", "attributes", "files"])
            if (typeof data[key] === "string") {
                try {
                    data[key] = JSON.parse(data[key] as string);
                } catch {
                    /* 형식 오류는 행 검증에서 표시한다. */
                }
            }
        if (data.isInternal === "true" || data.isInternal === "false")
            data.isInternal = data.isInternal === "true";
        return {
            kind: input.csvKind!,
            sourceId: String(
                pathValue(original, input.columns.id || "id") ?? "",
            ),
            data,
            original,
        };
    });
}
