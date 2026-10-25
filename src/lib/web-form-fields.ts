import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { webFormFields } from "@/lib/db/schema";
import type { RecordDb } from "@/lib/record-create";

const inputSchema = z.array(z.object({
    id: z.number().int().positive().optional(),
    label: z.string().trim().min(1).max(200),
    description: z.string().nullish(),
    placeholder: z.string().nullish(),
    fieldType: z.string().min(1).max(30).default("text"),
    linkedFieldKey: z.string().nullish(),
    isRequired: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    options: z.array(z.string()).nullish(),
}));

export class InvalidFormFields extends Error {}

/** 호출자는 폼 행을 잠근 트랜잭션을 전달한다. 기존 질문의 ID를 바꾸지 않는다. */
export async function saveWebFormFields(tx: RecordDb, formId: number, input: unknown) {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new InvalidFormFields("질문 항목을 확인해주세요. 제목은 비워둘 수 없습니다.");
    const previous = await tx.select({ id: webFormFields.id }).from(webFormFields).where(eq(webFormFields.formId, formId));
    const existingIds = new Set(previous.map((f) => f.id));
    const keep = new Set<number>();
    for (const f of parsed.data) {
        if (f.id === undefined) continue;
        if (!existingIds.has(f.id) || keep.has(f.id)) {
            throw new InvalidFormFields("질문 구성이 변경되었습니다. 최신 폼을 다시 불러온 뒤 저장해주세요.");
        }
        keep.add(f.id);
    }
    const deleted = previous.filter((f) => !keep.has(f.id)).map((f) => f.id);
    if (deleted.length) await tx.delete(webFormFields).where(and(eq(webFormFields.formId, formId), inArray(webFormFields.id, deleted)));
    for (const [sortOrder, f] of parsed.data.entries()) {
        const data = { label: f.label, description: f.description || null, placeholder: f.placeholder || null,
            fieldType: f.fieldType, linkedFieldKey: f.linkedFieldKey || null, isRequired: f.isRequired ? 1 : 0,
            options: f.options ?? null, sortOrder };
        if (f.id === undefined) await tx.insert(webFormFields).values({ ...data, formId });
        else await tx.update(webFormFields).set(data).where(and(eq(webFormFields.formId, formId), eq(webFormFields.id, f.id)));
    }
    return tx.select().from(webFormFields).where(eq(webFormFields.formId, formId)).orderBy(asc(webFormFields.sortOrder));
}
