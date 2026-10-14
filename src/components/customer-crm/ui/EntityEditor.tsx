"use client";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { X, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import type { Editor, Pipeline, Deal, Task, Contact, Company } from "../types";
const inputClass =
    "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block text-xs font-medium">
            {label}
            {children}
        </label>
    );
}
const text = (data: FormData, key: string) => String(data.get(key) ?? "");
export function EntityEditor({
    editor,
    workspaceId,
    pipelines,
    contacts,
    companies,
    members,
    onClose,
    onSave,
    onReload,
    children,
}: {
    editor: Editor;
    workspaceId: number;
    pipelines: Pipeline[];
    contacts: Contact[];
    companies: Company[];
    members: { id: string; name: string }[];
    onClose: () => void;
    onSave: (body: unknown) => Promise<void>;
    onReload?: () => Promise<void>;
    children?: ReactNode;
}) {
    const { resource, item } = editor,
        deal = item as Deal | undefined,
        task = (
            resource === "tasks" ? (item ?? editor.defaults) : undefined
        ) as Task | undefined,
        contact = item as Contact | undefined,
        company = item as Company | undefined;
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [newExternalId] = useState(() => `manual:${crypto.randomUUID()}`);
    const [pipelineId, setPipeline] = useState(
        deal?.pipelineId ?? pipelines[0]?.id ?? "",
    );
    const [stages, setStages] = useState<Pipeline["stages"]>(
        (item as Pipeline)?.stages ?? [
            { id: crypto.randomUUID(), name: "문의접수", category: "open" },
            { id: crypto.randomUUID(), name: "도입상담", category: "open" },
            { id: crypto.randomUUID(), name: "제안중", category: "open" },
            { id: crypto.randomUUID(), name: "계약완료", category: "won" },
            { id: crypto.randomUUID(), name: "보류·실패", category: "lost" },
        ],
    );
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        const data = new FormData(event.currentTarget),
            common = {
                workspaceId,
                ...(item && "version" in item
                    ? { version: item.version }
                    : {
                          externalId:
                              text(data, "externalId").trim() || newExternalId,
                      }),
            };
        let body: unknown;
        if (resource === "pipelines")
            body = { ...common, name: text(data, "name"), stages };
        else if (resource === "deals")
            body = {
                ...common,
                title: text(data, "title"),
                pipelineId,
                stageId: text(data, "stageId"),
                contactId: text(data, "contactId") || null,
                companyId: text(data, "companyId") || null,
                ownerId: text(data, "ownerId") || null,
                amount: text(data, "amount"),
                currency: text(data, "currency"),
                expectedCloseDate: text(data, "expectedCloseDate") || null,
                notes: text(data, "notes"),
            };
        else if (resource === "tasks")
            body = {
                ...common,
                title: text(data, "title"),
                body: text(data, "body"),
                contactId: text(data, "contactId") || null,
                companyId: text(data, "companyId") || null,
                ownerId: text(data, "ownerId") || null,
                dealId: task?.dealId ?? null,
                dueAt: text(data, "dueAt")
                    ? new Date(text(data, "dueAt")).toISOString()
                    : null,
                status: text(data, "status"),
            };
        else if (resource === "contacts")
            body = {
                workspaceId,
                externalId:
                    contact?.externalId ??
                    (text(data, "externalId").trim() || newExternalId),
                name: text(data, "name"),
                email: text(data, "email") || null,
                phone: text(data, "phone") || null,
                lifecycleStage: text(data, "lifecycleStage"),
                isInternal: data.get("isInternal") === "on",
                companyIds: data.getAll("companyIds").map(String),
            };
        else
            body = {
                workspaceId,
                externalId:
                    company?.externalId ??
                    (text(data, "externalId").trim() || newExternalId),
                name: text(data, "name"),
                domain: text(data, "domain") || null,
            };
        try {
            await onSave(body);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    function relationFields() {
        return (
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="고객">
                    <select
                        name="contactId"
                        className={inputClass}
                        defaultValue={deal?.contactId ?? task?.contactId ?? ""}
                    >
                        <option value="">연결 없음</option>
                        {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="회사">
                    <select
                        name="companyId"
                        className={inputClass}
                        defaultValue={deal?.companyId ?? task?.companyId ?? ""}
                    >
                        <option value="">연결 없음</option>
                        {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="담당자">
                    <select
                        name="ownerId"
                        className={inputClass}
                        defaultValue={deal?.ownerId ?? task?.ownerId ?? ""}
                    >
                        <option value="">담당자 없음</option>
                        {members.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </Field>
            </div>
        );
    }
    const title = {
        pipelines: "파이프라인",
        deals: "딜",
        tasks: "할 일",
        contacts: "고객",
        companies: "회사",
    }[resource];
    function moveStage(index: number, offset: number) {
        setStages((rows) => {
            const next = [...rows];
            [next[index], next[index + offset]] = [
                next[index + offset],
                next[index],
            ];
            return next;
        });
    }
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent
                showCloseButton={false}
                className="left-auto right-0 top-0 h-dvh max-w-xl translate-x-0 translate-y-0 overflow-y-auto rounded-none sm:max-w-xl block"
            >
                <header className="mb-6 flex items-center justify-between">
                    <DialogTitle className="text-xl font-semibold">
                        {title} {item ? "수정" : "추가"}
                    </DialogTitle>
                    <button aria-label="편집 닫기" onClick={onClose}>
                        <X size={20} />
                    </button>
                </header>
                <DialogDescription className="sr-only">
                    {title}의 내용을 확인하고 저장하세요.
                </DialogDescription>
                <form onSubmit={submit} className="space-y-5">
                    {!item && (
                        <details className="rounded-lg border p-3">
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                                외부 시스템 연결 (선택)
                            </summary>
                            <Field label="외부 번호 (선택)">
                                <input
                                    name="externalId"
                                    className={inputClass}
                                    placeholder="연동 시스템의 고유번호"
                                    maxLength={200}
                                />
                            </Field>
                        </details>
                    )}
                    {(resource === "pipelines" ||
                        resource === "contacts" ||
                        resource === "companies") && (
                        <Field label="이름">
                            <input
                                name="name"
                                className={inputClass}
                                defaultValue={
                                    (item as Pipeline | Contact | Company)
                                        ?.name ?? ""
                                }
                                required
                                maxLength={resource === "companies" ? 200 : 100}
                            />
                        </Field>
                    )}
                    {(resource === "deals" || resource === "tasks") && (
                        <Field label="제목">
                            <input
                                name="title"
                                className={inputClass}
                                defaultValue={deal?.title ?? task?.title ?? ""}
                                required
                                maxLength={200}
                            />
                        </Field>
                    )}
                    {resource === "pipelines" && (
                        <div className="space-y-3">
                            <p className="text-sm font-medium">
                                영업 단계 · 위에서 아래 순서
                            </p>
                            {stages.map((stage, index) => (
                                <div key={stage.id} className="flex gap-2">
                                    <input
                                        aria-label={`단계 ${index + 1} 이름`}
                                        className={inputClass}
                                        value={stage.name}
                                        maxLength={60}
                                        required
                                        onChange={(e) =>
                                            setStages((rows) =>
                                                rows.map((s) =>
                                                    s.id === stage.id
                                                        ? {
                                                              ...s,
                                                              name: e.target
                                                                  .value,
                                                          }
                                                        : s,
                                                ),
                                            )
                                        }
                                    />
                                    <select
                                        aria-label={`단계 ${index + 1} 구분`}
                                        className={inputClass}
                                        value={stage.category}
                                        onChange={(e) =>
                                            setStages((rows) =>
                                                rows.map((s) =>
                                                    s.id === stage.id
                                                        ? {
                                                              ...s,
                                                              category: e.target
                                                                  .value as typeof s.category,
                                                          }
                                                        : s,
                                                ),
                                            )
                                        }
                                    >
                                        <option value="open">진행</option>
                                        <option value="won">성사</option>
                                        <option value="lost">실패</option>
                                    </select>
                                    <button
                                        type="button"
                                        aria-label={`단계 ${index + 1} 삭제`}
                                        disabled={stages.length === 1}
                                        onClick={() =>
                                            setStages((rows) =>
                                                rows.filter(
                                                    (s) => s.id !== stage.id,
                                                ),
                                            )
                                        }
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`단계 ${index + 1} 위로`}
                                        disabled={index === 0}
                                        onClick={() => moveStage(index, -1)}
                                    >
                                        <ArrowUp size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`단계 ${index + 1} 아래로`}
                                        disabled={index === stages.length - 1}
                                        onClick={() => moveStage(index, 1)}
                                    >
                                        <ArrowDown size={14} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="flex items-center gap-1 text-sm text-violet-600"
                                disabled={stages.length >= 20}
                                onClick={() =>
                                    setStages((rows) => [
                                        ...rows,
                                        {
                                            id: crypto.randomUUID(),
                                            name: "새 단계",
                                            category: "open",
                                        },
                                    ])
                                }
                            >
                                <Plus size={16} />
                                단계 추가
                            </button>
                        </div>
                    )}
                    {resource === "deals" && (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="파이프라인">
                                    <select
                                        className={inputClass}
                                        value={pipelineId}
                                        onChange={(e) =>
                                            setPipeline(e.target.value)
                                        }
                                        required
                                    >
                                        <option value="">선택</option>
                                        {pipelines.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.name}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="단계">
                                    <select
                                        key={pipelineId}
                                        name="stageId"
                                        className={inputClass}
                                        defaultValue={
                                            pipelineId === deal?.pipelineId
                                                ? deal.stageId
                                                : undefined
                                        }
                                        required
                                    >
                                        {pipelines
                                            .find((p) => p.id === pipelineId)
                                            ?.stages.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
                                                </option>
                                            ))}
                                    </select>
                                </Field>
                                <Field label="금액">
                                    <input
                                        name="amount"
                                        className={inputClass}
                                        defaultValue={deal?.amount ?? "0"}
                                        required
                                        inputMode="decimal"
                                        pattern="[0-9]{1,15}(\.[0-9]{1,2})?"
                                    />
                                </Field>
                                <Field label="통화">
                                    <select
                                        name="currency"
                                        className={inputClass}
                                        defaultValue={deal?.currency ?? "KRW"}
                                    >
                                        <option value="KRW">KRW · 원</option>
                                        <option value="USD">USD · 달러</option>
                                        <option value="JPY">JPY · 엔</option>
                                    </select>
                                </Field>
                                <Field label="예상 계약일">
                                    <input
                                        name="expectedCloseDate"
                                        type="date"
                                        className={inputClass}
                                        defaultValue={
                                            deal?.expectedCloseDate ?? ""
                                        }
                                    />
                                </Field>
                            </div>
                            {relationFields()}
                            <Field label="메모">
                                <textarea
                                    name="notes"
                                    className={inputClass}
                                    defaultValue={deal?.notes ?? ""}
                                    maxLength={5000}
                                />
                            </Field>
                        </>
                    )}
                    {resource === "tasks" && (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="예정 시각">
                                    <input
                                        name="dueAt"
                                        type="datetime-local"
                                        className={inputClass}
                                        defaultValue={
                                            task?.dueAt
                                                ? new Date(
                                                      Date.parse(task.dueAt) -
                                                          new Date().getTimezoneOffset() *
                                                              60000,
                                                  )
                                                      .toISOString()
                                                      .slice(0, 16)
                                                : ""
                                        }
                                    />
                                </Field>
                                <Field label="상태">
                                    <select
                                        name="status"
                                        className={inputClass}
                                        defaultValue={task?.status ?? "open"}
                                    >
                                        <option value="open">진행중</option>
                                        <option value="done">완료</option>
                                        <option value="cancelled">취소</option>
                                    </select>
                                </Field>
                            </div>
                            {relationFields()}
                            {task?.dealId && (
                                <p className="text-xs text-muted-foreground">
                                    선택한 딜의 다음 행동으로 연결되어 있습니다.
                                </p>
                            )}
                            <Field label="업무 내용">
                                <textarea
                                    name="body"
                                    className={inputClass}
                                    defaultValue={task?.body ?? ""}
                                    maxLength={5000}
                                />
                            </Field>
                        </>
                    )}
                    {resource === "contacts" && (
                        <>
                            <Field label="이메일">
                                <input
                                    type="email"
                                    name="email"
                                    className={inputClass}
                                    defaultValue={contact?.email ?? ""}
                                />
                            </Field>
                            <Field label="전화">
                                <input
                                    name="phone"
                                    className={inputClass}
                                    defaultValue={contact?.phone ?? ""}
                                    maxLength={40}
                                />
                            </Field>
                            <fieldset className="rounded-lg border p-3">
                                <legend className="text-xs">연결 회사</legend>
                                <div className="max-h-40 space-y-2 overflow-y-auto">
                                    {companies.map((c) => (
                                        <label
                                            key={c.id}
                                            className="flex gap-2 text-sm"
                                        >
                                            <input
                                                type="checkbox"
                                                name="companyIds"
                                                value={c.id}
                                                defaultChecked={contact?.companyIds.includes(
                                                    c.id,
                                                )}
                                            />
                                            {c.name}
                                        </label>
                                    ))}
                                    {contact?.companyIds
                                        .filter(
                                            (id) =>
                                                !companies.some(
                                                    (c) => c.id === id,
                                                ),
                                        )
                                        .map((id) => (
                                            <input
                                                key={id}
                                                type="hidden"
                                                name="companyIds"
                                                value={id}
                                            />
                                        ))}
                                    {!companies.length && (
                                        <p className="text-xs text-muted-foreground">
                                            회사를 먼저 등록하면 연결할 수
                                            있습니다.
                                        </p>
                                    )}
                                </div>
                            </fieldset>
                            <Field label="고객 단계">
                                <select
                                    name="lifecycleStage"
                                    className={inputClass}
                                    defaultValue={
                                        contact?.lifecycleStage ?? "lead"
                                    }
                                >
                                    <option value="lead">리드</option>
                                    <option value="prospect">상담중</option>
                                    <option value="customer">고객</option>
                                    <option value="inactive">비활성</option>
                                </select>
                            </Field>
                            <label className="flex gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    name="isInternal"
                                    defaultChecked={contact?.isInternal}
                                />
                                내부 구성원
                            </label>
                        </>
                    )}
                    {resource === "companies" && (
                        <Field label="회사 도메인 (선택)">
                            <input
                                name="domain"
                                className={inputClass}
                                defaultValue={company?.domain ?? ""}
                                placeholder="example.com"
                            />
                        </Field>
                    )}
                    {error && (
                        <p
                            role="alert"
                            className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
                        >
                            {error}
                        </p>
                    )}
                    <div className="flex gap-3">
                        <button
                            className="rounded-lg bg-violet-600 px-5 py-2 text-sm text-white"
                            disabled={busy}
                        >
                            {busy ? "저장 중…" : "저장"}
                        </button>
                        {onReload && (
                            <button
                                type="button"
                                className="rounded-lg border px-4 py-2 text-sm"
                                onClick={() => void onReload()}
                            >
                                최신 내용 불러오기
                            </button>
                        )}
                        <button
                            type="button"
                            className="px-3 text-sm text-muted-foreground"
                            onClick={onClose}
                        >
                            취소
                        </button>
                    </div>
                </form>
                {children}
            </DialogContent>
        </Dialog>
    );
}
