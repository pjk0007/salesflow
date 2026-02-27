import { useState, useCallback } from "react";
import Head from "next/head";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { GetServerSideProps } from "next";
import { db, webForms, webFormFields } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";

interface PublicField {
    id: number;
    label: string;
    description: string | null;
    placeholder: string | null;
    fieldType: string;
    isRequired: number;
    options: string[] | null;
}

interface PublicFormData {
    title: string;
    description: string | null;
    completionTitle: string | null;
    completionMessage: string | null;
    completionButtonText: string | null;
    completionButtonUrl: string | null;
    fields: PublicField[];
}

interface PageProps {
    form: PublicFormData | null;
    slug: string;
}

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
    const slug = ctx.params?.slug as string;

    try {
        const [form] = await db
            .select()
            .from(webForms)
            .where(and(eq(webForms.slug, slug), eq(webForms.isActive, 1)));

        if (!form) {
            return { props: { form: null, slug } };
        }

        const fields = await db
            .select()
            .from(webFormFields)
            .where(eq(webFormFields.formId, form.id))
            .orderBy(asc(webFormFields.sortOrder));

        return {
            props: {
                slug,
                form: {
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
                    })),
                },
            },
        };
    } catch {
        return { props: { form: null, slug } };
    }
};

export default function PublicFormPage({ form, slug }: PageProps) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState("");

    const handleChange = useCallback((fieldId: string, value: string) => {
        setValues((prev) => ({ ...prev, [fieldId]: value }));
    }, []);

    const formatPhone = useCallback((value: string) => {
        const digits = value.replace(/\D/g, "").slice(0, 11);
        if (digits.length <= 3) return digits;
        if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }, []);

    const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            if (!form) return;
            setError("");
            setSubmitting(true);

            try {
                const res = await fetch(`/api/public/forms/${slug}/submit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ data: values }),
                });
                const result = await res.json();
                if (result.success) {
                    setSubmitted(true);
                } else {
                    setError(result.error || "제출에 실패했습니다.");
                }
            } catch {
                setError("네트워크 오류가 발생했습니다.");
            } finally {
                setSubmitting(false);
            }
        },
        [form, slug, values]
    );

    if (!form) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h1 className="text-xl font-bold text-gray-900">
                        페이지를 찾을 수 없습니다
                    </h1>
                    <p className="text-gray-500 mt-2">
                        존재하지 않거나 비활성화된 폼입니다.
                    </p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <>
                <Head>
                    <title>{form.title}</title>
                </Head>
                <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
                    <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg
                                className="w-6 h-6 text-green-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold">
                            {form.completionTitle || "제출이 완료되었습니다"}
                        </h2>
                        {form.completionMessage && (
                            <p className="text-gray-600 mt-2">
                                {form.completionMessage}
                            </p>
                        )}
                        {form.completionButtonText && form.completionButtonUrl && (
                            <a
                                href={form.completionButtonUrl}
                                className="inline-block mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                {form.completionButtonText}
                            </a>
                        )}
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Head>
                <title>{form.title}</title>
                <meta name="description" content={form.description || ""} />
            </Head>
            <div className="min-h-screen bg-gray-50 py-10 px-4">
                <form
                    onSubmit={handleSubmit}
                    className="max-w-md mx-auto bg-white rounded-xl shadow-sm border p-8"
                >
                    <div className="mb-6">
                        <h1 className="text-xl font-bold">{form.title}</h1>
                        {form.description && (
                            <p className="text-sm text-gray-500 mt-1">
                                {form.description}
                            </p>
                        )}
                    </div>

                    <div className="space-y-5">
                        {form.fields.map((field) => (
                            <div key={field.id} className="space-y-1.5">
                                <label className="text-sm font-medium text-gray-700">
                                    {field.label}
                                    {field.isRequired ? (
                                        <span className="text-red-500 ml-1">*</span>
                                    ) : null}
                                </label>
                                {field.description && (
                                    <p className="text-xs text-gray-400">
                                        {field.description}
                                    </p>
                                )}
                                {renderField(field, values, handleChange, formatPhone)}
                            </div>
                        ))}
                    </div>

                    {error && (
                        <p className="text-sm text-red-500 mt-4">{error}</p>
                    )}

                    <Button
                        type="submit"
                        className="w-full mt-6"
                        disabled={submitting}
                    >
                        {submitting ? "제출 중..." : "제출"}
                    </Button>
                </form>
            </div>
        </>
    );
}

function renderField(
    field: PublicField,
    values: Record<string, string>,
    onChange: (id: string, value: string) => void,
    formatPhone: (value: string) => string
) {
    const id = String(field.id);
    const val = values[id] || "";

    switch (field.fieldType) {
        case "textarea":
            return (
                <Textarea
                    value={val}
                    onChange={(e) => onChange(id, e.target.value)}
                    placeholder={field.placeholder || ""}
                    rows={3}
                    required={!!field.isRequired}
                />
            );
        case "select":
            return (
                <Select
                    value={val}
                    onValueChange={(v) => onChange(id, v)}
                    required={!!field.isRequired}
                >
                    <SelectTrigger>
                        <SelectValue
                            placeholder={field.placeholder || "선택하세요"}
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {field.options?.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                                {opt}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        case "checkbox":
            return (
                <div className="flex items-center gap-2">
                    <Checkbox
                        checked={val === "true"}
                        onCheckedChange={(checked) =>
                            onChange(id, checked ? "true" : "false")
                        }
                    />
                    <span className="text-sm">
                        {field.placeholder || "동의합니다"}
                    </span>
                </div>
            );
        case "date":
            return (
                <Input
                    type="date"
                    value={val}
                    onChange={(e) => onChange(id, e.target.value)}
                    required={!!field.isRequired}
                />
            );
        case "phone":
            return (
                <Input
                    type="tel"
                    value={val}
                    onChange={(e) =>
                        onChange(id, formatPhone(e.target.value))
                    }
                    placeholder={field.placeholder || "010-0000-0000"}
                    required={!!field.isRequired}
                />
            );
        default:
            return (
                <Input
                    type={field.fieldType === "email" ? "email" : "text"}
                    value={val}
                    onChange={(e) => onChange(id, e.target.value)}
                    placeholder={field.placeholder || ""}
                    required={!!field.isRequired}
                />
            );
    }
}
