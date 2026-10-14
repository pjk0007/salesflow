"use client";
import { useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import {
    Plus,
    Building2,
    UserRound,
    BriefcaseBusiness,
    ListTodo,
    Settings2,
    Archive,
} from "lucide-react";
import { toast } from "sonner";
import type { InboxBootstrap } from "@/components/inbox/types";
import { crmRequest, crmWrite } from "../api";
import { useCrmList } from "../hooks/useCustomerCrm";
import type {
    Pipeline,
    Deal,
    Task,
    Contact,
    Company,
    Resource,
    Editor,
} from "../types";
import { EntityEditor } from "./EntityEditor";
import { ActivityTimeline } from "./ActivityTimeline";
const names: Record<Resource, string> = {
    deals: "딜",
    tasks: "할 일",
    contacts: "고객",
    companies: "회사",
    pipelines: "파이프라인",
};
export function CustomerCrmPage({ role }: { role: string }) {
    const params = useSearchParams(),
        bootstrap = useSWR<InboxBootstrap>("/api/inbox", crmRequest);
    const [chosen, setWorkspace] = useState<number | null>(
            Number(params.get("workspaceId")) || null,
        ),
        [resource, setResource] = useState<Resource>(
            params.get("q") ? "contacts" : "deals",
        ),
        [query, setQuery] = useState(params.get("q") ?? ""),
        [archived, setArchived] = useState(false),
        [editor, setEditor] = useState<Editor | null>(null);
    const workspaceId = chosen ?? bootstrap.data?.workspaces[0]?.id ?? null;
    const [pending, setPending] = useState<string[]>([]);
    const pipelines = useCrmList<Pipeline>(workspaceId, "pipelines"),
        contacts = useCrmList<Contact>(workspaceId, "contacts"),
        companies = useCrmList<Company>(workspaceId, "companies");
    const current = useCrmList<Pipeline | Deal | Task | Contact | Company>(
        workspaceId,
        resource,
        {
            q: query,
            ...(resource === "deals" ? { archived: String(archived) } : {}),
        },
    );
    const allLists = [pipelines, contacts, companies, current],
        error = bootstrap.error ?? allLists.find((list) => list.error)?.error;
    async function refresh() {
        await Promise.all(allLists.map((list) => list.mutate()));
    }
    async function save(body: unknown) {
        if (!editor || !workspaceId) return;
        const mutable =
                editor.item &&
                ["pipelines", "deals", "tasks"].includes(editor.resource),
            path = `/api/customer-crm/${editor.resource}${mutable ? "/" + editor.item!.id : ""}`;
        await crmWrite(path, body, mutable ? "PATCH" : "POST");
        setEditor(null);
        await refresh();
        toast.success("저장했습니다.");
    }
    async function quick(
        resource: "tasks" | "deals",
        item: Task | Deal,
        change: unknown,
    ) {
        if (pending.includes(item.id)) return;
        setPending((ids) => [...ids, item.id]);
        try {
            await crmWrite(
                `/api/customer-crm/${resource}/${item.id}`,
                { workspaceId, version: item.version, ...(change as object) },
                "PATCH",
            );
            await refresh();
        } catch (e) {
            toast.error((e as Error).message);
            await refresh();
        } finally {
            setPending((ids) => ids.filter((id) => id !== item.id));
        }
    }
    const menus = [
        { id: "deals" as const, icon: BriefcaseBusiness },
        { id: "tasks" as const, icon: ListTodo },
        { id: "contacts" as const, icon: UserRound },
        { id: "companies" as const, icon: Building2 },
        { id: "pipelines" as const, icon: Settings2 },
    ];
    return (
        <main className="flex h-full min-h-[650px] flex-col">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
                <div>
                    <h1 className="text-xl font-semibold">고객 관리</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        상담에서 다음 행동과 계약까지 이어가세요.
                    </p>
                </div>
                <label className="text-xs">
                    사업
                    <select
                        aria-label="고객 관리 사업"
                        className="ml-3 rounded-lg border bg-background px-3 py-2 text-sm"
                        value={workspaceId ?? ""}
                        onChange={(e) => {
                            setWorkspace(Number(e.target.value));
                            setEditor(null);
                            setQuery("");
                        }}
                    >
                        {bootstrap.data?.workspaces.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.name}
                            </option>
                        ))}
                    </select>
                </label>
            </header>
            <nav
                aria-label="고객 관리 메뉴"
                className="flex gap-2 overflow-x-auto border-b px-5 py-3"
            >
                {menus.map((m) => (
                    <button
                        key={m.id}
                        aria-pressed={resource === m.id}
                        className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${resource === m.id ? "bg-violet-100 font-medium text-violet-800" : "text-muted-foreground"}`}
                        onClick={() => {
                            setResource(m.id);
                            setQuery("");
                        }}
                    >
                        <m.icon size={16} />
                        {names[m.id]}
                    </button>
                ))}
            </nav>
            {error && (
                <div
                    role="alert"
                    className="mx-5 mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                    {error.message}
                    <button
                        className="ml-3 underline"
                        onClick={() => void refresh()}
                    >
                        다시 불러오기
                    </button>
                </div>
            )}
            {!workspaceId ? (
                <p className="p-8 text-muted-foreground">
                    {bootstrap.isLoading
                        ? "고객 관리를 불러오는 중…"
                        : "고객 관리를 사용할 사업을 먼저 만들어주세요."}
                </p>
            ) : (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                        <div className="flex gap-3">
                            <input
                                aria-label="고객 관리 검색"
                                className="rounded-lg border bg-background px-3 py-2 text-sm"
                                placeholder={`${names[resource]} 이름 검색`}
                                value={query}
                                maxLength={200}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                            {resource === "deals" && (
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={archived}
                                        onChange={(e) =>
                                            setArchived(e.target.checked)
                                        }
                                    />
                                    보관된 딜
                                </label>
                            )}
                        </div>
                        <button
                            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                            disabled={
                                resource === "pipelines" && role === "member"
                            }
                            onClick={() => setEditor({ resource })}
                        >
                            <Plus size={16} />
                            {names[resource]} 추가
                        </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto px-5 pb-8">
                        {current.isLoading ? (
                            <p className="p-8 text-sm text-muted-foreground">
                                불러오는 중…
                            </p>
                        ) : !current.rows.length ? (
                            <div className="rounded-xl border border-dashed p-12 text-center">
                                <p className="text-muted-foreground">
                                    {query
                                        ? "검색 결과가 없습니다."
                                        : `아직 ${names[resource]} 항목이 없습니다.`}
                                </p>
                                {resource === "deals" &&
                                    !pipelines.rows.length &&
                                    role !== "member" && (
                                        <button
                                            className="mt-4 rounded-lg border px-4 py-2 text-sm"
                                            onClick={() =>
                                                setEditor({
                                                    resource: "pipelines",
                                                })
                                            }
                                        >
                                            첫 파이프라인 만들기
                                        </button>
                                    )}
                            </div>
                        ) : resource === "deals" ? (
                            <div className="flex min-w-max gap-4">
                                {pipelines.rows.flatMap((p) =>
                                    p.stages.map((stage) => {
                                        const deals = (
                                            current.rows as Deal[]
                                        ).filter(
                                            (d) =>
                                                d.pipelineId === p.id &&
                                                d.stageId === stage.id,
                                        );
                                        return (
                                            <section
                                                key={p.id + stage.id}
                                                className="w-[270px] rounded-xl bg-muted/40 p-3"
                                            >
                                                <header className="mb-3">
                                                    <p className="text-[10px] text-muted-foreground">
                                                        {p.name}
                                                    </p>
                                                    <h2 className="mt-1 flex items-center justify-between text-sm font-semibold">
                                                        {stage.name}
                                                        <span className="text-xs text-muted-foreground">
                                                            {deals.length}
                                                        </span>
                                                    </h2>
                                                </header>
                                                {deals.map((d) => (
                                                    <article
                                                        key={d.id}
                                                        className="mb-3 space-y-3 rounded-xl border bg-background p-4 shadow-sm"
                                                    >
                                                        <button
                                                            className="block w-full text-left text-sm font-medium"
                                                            onClick={() =>
                                                                setEditor({
                                                                    resource:
                                                                        "deals",
                                                                    item: d,
                                                                })
                                                            }
                                                        >
                                                            {d.title}
                                                        </button>
                                                        <p className="text-sm text-violet-700">
                                                            {new Intl.NumberFormat(
                                                                "ko-KR",
                                                                {
                                                                    style: "currency",
                                                                    currency:
                                                                        d.currency,
                                                                },
                                                            ).format(
                                                                Number(
                                                                    d.amount,
                                                                ),
                                                            )}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {contacts.rows.find(
                                                                (c) =>
                                                                    c.id ===
                                                                    d.contactId,
                                                            )?.name ??
                                                                "고객 미연결"}{" "}
                                                            ·{" "}
                                                            {bootstrap.data?.members.find(
                                                                (m) =>
                                                                    m.id ===
                                                                    d.ownerId,
                                                            )?.name ?? "미배정"}
                                                        </p>
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                className="text-xs text-violet-600"
                                                                onClick={() =>
                                                                    setEditor({
                                                                        resource:
                                                                            "tasks",
                                                                        defaults:
                                                                            {
                                                                                dealId: d.id,
                                                                                contactId:
                                                                                    d.contactId,
                                                                                companyId:
                                                                                    d.companyId,
                                                                                ownerId:
                                                                                    d.ownerId,
                                                                            },
                                                                    })
                                                                }
                                                            >
                                                                다음 할 일 추가
                                                            </button>
                                                            <button
                                                                aria-label={`${d.title} ${archived ? "복원" : "보관"}`}
                                                                disabled={pending.includes(
                                                                    d.id,
                                                                )}
                                                                className="ml-auto text-muted-foreground"
                                                                onClick={() =>
                                                                    void quick(
                                                                        "deals",
                                                                        d,
                                                                        {
                                                                            archived:
                                                                                !archived,
                                                                        },
                                                                    )
                                                                }
                                                            >
                                                                <Archive
                                                                    size={14}
                                                                />
                                                            </button>
                                                        </div>
                                                    </article>
                                                ))}
                                            </section>
                                        );
                                    }),
                                )}
                            </div>
                        ) : (
                            <div className="divide-y rounded-xl border">
                                {current.rows.map((row) => (
                                    <article
                                        key={row.id}
                                        className="flex items-center gap-4 p-4"
                                    >
                                        {resource === "tasks" && (
                                            <input
                                                type="checkbox"
                                                disabled={pending.includes(
                                                    row.id,
                                                )}
                                                aria-label={`${(row as Task).title} 완료`}
                                                checked={
                                                    (row as Task).status ===
                                                    "done"
                                                }
                                                onChange={(e) =>
                                                    void quick(
                                                        "tasks",
                                                        row as Task,
                                                        {
                                                            status: e.target
                                                                .checked
                                                                ? "done"
                                                                : "open",
                                                        },
                                                    )
                                                }
                                            />
                                        )}
                                        <button
                                            className="min-w-0 flex-1 text-left"
                                            disabled={
                                                (resource === "pipelines" &&
                                                    role === "member") ||
                                                pending.includes(row.id)
                                            }
                                            onClick={() =>
                                                setEditor({
                                                    resource,
                                                    item: row,
                                                })
                                            }
                                        >
                                            <p className="font-medium">
                                                {"title" in row
                                                    ? row.title
                                                    : row.name}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {resource === "tasks"
                                                    ? `${{ open: "진행중", done: "완료", cancelled: "취소" }[(row as Task).status] ?? ""} · ${(row as Task).dueAt ? new Date((row as Task).dueAt!).toLocaleString("ko-KR") : "예정 시각 없음"}`
                                                    : resource === "contacts"
                                                      ? ((row as Contact)
                                                            .email ??
                                                        "이메일 없음")
                                                      : resource === "companies"
                                                        ? ((row as Company)
                                                              .domain ??
                                                          "도메인 없음")
                                                        : (
                                                              row as Pipeline
                                                          ).stages
                                                              .map(
                                                                  (s) => s.name,
                                                              )
                                                              .join(" → ")}
                                            </p>
                                        </button>
                                        {resource === "contacts" &&
                                            (row as Contact).isInternal && (
                                                <span className="rounded bg-muted px-2 py-1 text-xs">
                                                    내부 구성원
                                                </span>
                                            )}
                                    </article>
                                ))}
                            </div>
                        )}
                        {current.hasMore && (
                            <button
                                className="mt-5 rounded-lg border px-5 py-2 text-sm"
                                disabled={current.loadingMore}
                                onClick={() => void current.loadMore()}
                            >
                                {current.loadingMore
                                    ? "불러오는 중…"
                                    : "다음 항목 더 보기"}
                            </button>
                        )}
                        <p className="mt-4 text-xs text-muted-foreground">
                            불러온 {names[resource]} {current.rows.length}건
                        </p>
                    </div>
                </>
            )}
            {editor && workspaceId && (
                <EntityEditor
                    key={
                        editor.resource +
                        workspaceId +
                        (editor.item?.id ?? "new") +
                        ("version" in (editor.item ?? {})
                            ? (editor.item as Deal).version
                            : "")
                    }
                    editor={editor}
                    workspaceId={workspaceId}
                    pipelines={pipelines.rows}
                    contacts={contacts.rows}
                    companies={companies.rows}
                    members={bootstrap.data?.members ?? []}
                    onClose={() => setEditor(null)}
                    onSave={save}
                    onReload={
                        editor.item &&
                        ["deals", "tasks", "pipelines"].includes(
                            editor.resource,
                        )
                            ? async () => {
                                  try {
                                      const value = await crmRequest<{
                                          item: Deal | Task | Pipeline;
                                      }>(
                                          `/api/customer-crm/${editor.resource}/${editor.item!.id}?workspaceId=${workspaceId}`,
                                      );
                                      setEditor({
                                          ...editor,
                                          item: value.item,
                                      });
                                  } catch (e) {
                                      toast.error((e as Error).message);
                                  }
                              }
                            : undefined
                    }
                >
                    {editor.item &&
                        (editor.resource === "deals" ||
                            editor.resource === "contacts") && (
                            <ActivityTimeline
                                workspaceId={workspaceId}
                                id={editor.item.id}
                                kind={editor.resource}
                            />
                        )}
                </EntityEditor>
            )}
        </main>
    );
}
