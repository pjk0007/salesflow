"use client";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { inboxRequest, inboxWrite } from "../api";
import type { Conversation, InboxBootstrap } from "../types";
import type {
    Contact,
    Company,
    Deal,
    Task,
    Pipeline,
    Editor,
} from "@/components/customer-crm/types";
import { EntityEditor } from "@/components/customer-crm/ui/EntityEditor";
import { ActivityTimeline } from "@/components/customer-crm/ui/ActivityTimeline";
interface ContextData {
    workspaceId: number;
    contact: Contact | null;
    companies: Company[];
    editorCompanies: Company[];
    contacts: Contact[];
    pipelines: Pipeline[];
    deals: (Deal & {
        pipelineName: string;
        stageName: string;
        relation: "contact" | "company";
    })[];
    tasks: Task[];
}
export function CustomerCrmContext({
    chat,
    bootstrap,
}: {
    chat: Conversation;
    bootstrap: InboxBootstrap;
}) {
    const context = useSWR<ContextData>(
            chat.contactId
                ? `/api/inbox/conversations/${chat.id}/customer`
                : null,
            inboxRequest,
            { refreshInterval: 8000, refreshWhenHidden: false },
        ),
        { mutate } = useSWRConfig();
    const [editor, setEditor] = useState<Editor | null>(null),
        [expanded, setExpanded] = useState(false),
        [pending, setPending] = useState<string | null>(null);
    const data = context.data;
    const { respond: canRespond, manage: canManage } = workspaceAbilities(
        bootstrap,
        data?.workspaceId,
    );
    if (!chat.contactId) return null;
    async function refresh() {
        await Promise.all([
            context.mutate(),
            mutate(
                (key) =>
                    typeof key === "string" &&
                    !!data?.contact &&
                    key.includes(`/contacts/${data.contact.id}/activity`),
            ),
        ]);
    }
    async function save(body: unknown) {
        if (!editor) return;
        const continueToDeal = editor.resource === "pipelines";
        const edit = !!editor.item;
        await inboxWrite(
            `/api/customer-crm/${editor.resource}${edit ? "/" + editor.item!.id : ""}`,
            body,
            edit ? "PATCH" : "POST",
        );
        setEditor(null);
        await refresh();
        if (continueToDeal && data?.contact)
            setEditor({
                resource: "deals",
                defaults: {
                    contactId: data.contact.id,
                    companyId: data.companies[0]?.id ?? null,
                    ownerId: chat.assigneeId,
                },
            });
        toast.success("고객 타임라인에 기록했습니다.");
    }
    async function complete(task: Task) {
        if (pending || !data) return;
        setPending(task.id);
        try {
            await inboxWrite(
                `/api/customer-crm/tasks/${task.id}`,
                {
                    workspaceId: data.workspaceId,
                    version: task.version,
                    status: "done",
                },
                "PATCH",
            );
            await refresh();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setPending(null);
        }
    }
    return (
        <section className="space-y-5" aria-label="상담 고객 CRM">
            <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">고객 프로필</h3>
                {data?.contact && (
                    <button
                        className="text-xs text-[#635BFF]"
                        disabled={!canRespond || !!data.contact.archivedAt}
                        onClick={() =>
                            setEditor({
                                resource: "contacts",
                                item: data.contact!,
                            })
                        }
                    >
                        고객 정보 수정
                    </button>
                )}
            </div>
            {context.error ? (
                <p role="alert" className="text-xs text-red-600">
                    {context.error.message}
                    <button
                        className="ml-2 underline"
                        onClick={() => void context.mutate()}
                    >
                        다시 불러오기
                    </button>
                </p>
            ) : !data ? (
                <p className="text-xs text-muted-foreground">
                    고객 정보를 불러오는 중…
                </p>
            ) : data.contact ? (
                <>
                    <div className="space-y-1 text-xs">
                        <p className="text-sm font-semibold">
                            {data.contact.name}
                        </p>
                        <p className="break-all text-muted-foreground">
                            {data.contact.email || "이메일 미입력"}
                        </p>
                        <p className="text-muted-foreground">
                            {data.contact.phone || "전화번호 미입력"}
                        </p>
                    </div>
                    {data.contact.archivedAt && (
                        <p className="rounded border p-2 text-xs">
                            보관된 고객입니다. 기존 상담·거래 이력으로 응대할 수
                            있습니다.{" "}
                            <a
                                className="underline"
                                href={`/customer-crm?workspaceId=${data.workspaceId}&resource=contacts&archived=all&q=${encodeURIComponent(data.contact.name)}`}
                            >
                                고객 보관 정보 보기
                            </a>
                        </p>
                    )}
                    <div className="space-y-2 text-xs">
                        {data.companies.length ? (
                            data.companies.map((company) => (
                                <p
                                    key={company.id}
                                    className="rounded-lg bg-muted/50 px-3 py-2"
                                >
                                    {company.name}
                                    {company.archivedAt ? " · 보관됨" : ""}
                                    {company.domain && (
                                        <span className="mt-1 block text-muted-foreground">
                                            {company.domain}
                                        </span>
                                    )}
                                </p>
                            ))
                        ) : (
                            <p className="text-muted-foreground">
                                연결 회사 없음
                            </p>
                        )}
                        {data.contact.isInternal && (
                            <p className="text-muted-foreground">내부 구성원</p>
                        )}
                    </div>
                    <div>
                        <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-xs font-semibold">진행 거래</h4>
                            <button
                                className="text-xs text-[#635BFF]"
                                disabled={!canRespond || !data.pipelines.length}
                                onClick={() =>
                                    setEditor({
                                        resource: "deals",
                                        defaults: {
                                            contactId: data.contact!.id,
                                            companyId:
                                                data.companies[0]?.id ?? null,
                                            ownerId: chat.assigneeId,
                                        },
                                    })
                                }
                            >
                                딜 만들기
                            </button>
                        </div>
                        {!data.pipelines.length && (
                            <div className="rounded-lg bg-muted/50 p-3 text-xs">
                                <p className="mb-2 text-muted-foreground">
                                    거래 단계는 처음 한 번만 준비하면 됩니다.
                                </p>
                                {canManage ? (
                                    <button
                                        className="text-[#635BFF]"
                                        onClick={() =>
                                            setEditor({ resource: "pipelines" })
                                        }
                                    >
                                        이 화면에서 거래 단계 만들기
                                    </button>
                                ) : (
                                    <p>
                                        관리자에게 거래 단계 설정을
                                        요청해주세요. 후속 업무는 바로 추가할 수
                                        있습니다.
                                    </p>
                                )}
                            </div>
                        )}
                        {!data.deals.length ? (
                            <p className="text-xs text-muted-foreground">
                                진행 중인 거래가 없습니다.
                            </p>
                        ) : (
                            data.deals.map((deal) => (
                                <button
                                    key={deal.id}
                                    className="mb-2 block w-full rounded-lg border bg-background p-3 text-left text-xs"
                                    onClick={() =>
                                        setEditor({
                                            resource: "deals",
                                            item: deal,
                                        })
                                    }
                                >
                                    <span className="font-medium">
                                        {deal.title}
                                    </span>
                                    <span className="mt-1 block text-muted-foreground">
                                        {deal.stageName} ·{" "}
                                        {new Intl.NumberFormat("ko-KR", {
                                            style: "currency",
                                            currency: deal.currency,
                                        }).format(Number(deal.amount))}
                                        {deal.relation === "company"
                                            ? " · 회사 거래"
                                            : ""}
                                    </span>
                                </button>
                            ))
                        )}
                        {data.deals.length === 20 && (
                            <a
                                href={`/customer-crm?workspaceId=${data.workspaceId}`}
                                className="text-xs text-[#635BFF]"
                            >
                                거래 더 보기 ↗
                            </a>
                        )}
                    </div>
                    <div>
                        <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-xs font-semibold">후속 업무</h4>
                            <button
                                className="text-xs text-[#635BFF]"
                                disabled={!canRespond}
                                onClick={() =>
                                    setEditor({
                                        resource: "tasks",
                                        defaults: {
                                            contactId: data.contact!.id,
                                            companyId:
                                                data.companies[0]?.id ?? null,
                                            ownerId: chat.assigneeId,
                                        },
                                    })
                                }
                            >
                                후속 업무 만들기
                            </button>
                        </div>
                        {!data.tasks.length ? (
                            <p className="text-xs text-muted-foreground">
                                예정된 업무가 없습니다.
                            </p>
                        ) : (
                            data.tasks.map((task) => (
                                <div
                                    key={task.id}
                                    className="mb-2 flex gap-2 rounded-lg border bg-background p-3"
                                >
                                    <input
                                        type="checkbox"
                                        checked={false}
                                        aria-label={`${task.title} 완료`}
                                        disabled={
                                            !canRespond || pending !== null
                                        }
                                        onChange={() => void complete(task)}
                                    />
                                    <button
                                        className="min-w-0 flex-1 text-left text-xs"
                                        onClick={() =>
                                            setEditor({
                                                resource: "tasks",
                                                item: task,
                                            })
                                        }
                                    >
                                        <span className="block font-medium">
                                            {task.title}
                                        </span>
                                        <span className="mt-1 block text-muted-foreground">
                                            {task.dueAt
                                                ? new Date(
                                                      task.dueAt,
                                                  ).toLocaleString("ko-KR")
                                                : "일정 미정"}{" "}
                                            ·{" "}
                                            {bootstrap.members.find(
                                                (member) =>
                                                    member.id === task.ownerId,
                                            )?.name ?? "담당자 없음"}
                                        </span>
                                    </button>
                                </div>
                            ))
                        )}
                        {data.tasks.length === 20 && (
                            <a
                                href={`/customer-crm?workspaceId=${data.workspaceId}`}
                                className="text-xs text-[#635BFF]"
                            >
                                업무 더 보기 ↗
                            </a>
                        )}
                    </div>
                    <details
                        onToggle={(event) =>
                            setExpanded(event.currentTarget.open)
                        }
                    >
                        <summary className="cursor-pointer text-xs font-semibold">
                            고객 타임라인
                        </summary>
                        {expanded && (
                            <ActivityTimeline
                                workspaceId={data.workspaceId}
                                id={data.contact.id}
                                kind="contacts"
                            />
                        )}
                    </details>
                </>
            ) : (
                <p className="text-xs text-muted-foreground">
                    연결된 고객을 확인할 수 없습니다.
                </p>
            )}
            {editor && data && (
                <EntityEditor
                    readOnly={!canRespond}
                    key={
                        editor.resource +
                        (editor.item?.id ?? "new") +
                        (editor.item && "version" in editor.item
                            ? editor.item.version
                            : "")
                    }
                    editor={editor}
                    workspaceId={data.workspaceId}
                    pipelines={data.pipelines}
                    contacts={data.contacts}
                    companies={data.editorCompanies}
                    members={bootstrap.members.filter((m) =>
                        m.workspaceIds.includes(data?.workspaceId ?? 0),
                    )}
                    onClose={() => setEditor(null)}
                    onSave={save}
                    onReload={
                        editor.item
                            ? async () => {
                                  const id = editor.item!.id;
                                  try {
                                      const value = await inboxRequest<{
                                          item:
                                              | Deal
                                              | Task
                                              | Contact
                                              | Company
                                              | Pipeline;
                                      }>(
                                          `/api/customer-crm/${editor.resource}/${id}?workspaceId=${data.workspaceId}`,
                                      );
                                      setEditor((current) =>
                                          current?.item?.id === id
                                              ? { ...current, item: value.item }
                                              : current,
                                      );
                                  } catch (error) {
                                      toast.error((error as Error).message);
                                  }
                              }
                            : undefined
                    }
                >
                    {editor.item && editor.resource === "deals" && (
                        <ActivityTimeline
                            workspaceId={data.workspaceId}
                            id={editor.item.id}
                            kind="deals"
                        />
                    )}
                </EntityEditor>
            )}
        </section>
    );
}
