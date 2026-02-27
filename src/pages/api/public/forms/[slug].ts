import type { NextApiRequest, NextApiResponse } from "next";
import { db, webForms, webFormFields } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const slug = req.query.slug as string;
    if (!slug) {
        return res.status(400).json({ success: false, error: "slug가 필요합니다." });
    }

    try {
        const [form] = await db
            .select()
            .from(webForms)
            .where(and(eq(webForms.slug, slug), eq(webForms.isActive, 1)));

        if (!form) {
            return res.status(404).json({ success: false, error: "폼을 찾을 수 없습니다." });
        }

        const fields = await db
            .select()
            .from(webFormFields)
            .where(eq(webFormFields.formId, form.id))
            .orderBy(asc(webFormFields.sortOrder));

        return res.status(200).json({
            success: true,
            data: {
                id: form.id,
                title: form.title,
                description: form.description,
                completionTitle: form.completionTitle,
                completionMessage: form.completionMessage,
                completionButtonText: form.completionButtonText,
                completionButtonUrl: form.completionButtonUrl,
                fields: fields.map((f) => ({
                    id: f.id,
                    label: f.label,
                    description: f.description,
                    placeholder: f.placeholder,
                    fieldType: f.fieldType,
                    isRequired: f.isRequired,
                    options: f.options,
                    sortOrder: f.sortOrder,
                })),
            },
        });
    } catch (error) {
        console.error("Public form fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
