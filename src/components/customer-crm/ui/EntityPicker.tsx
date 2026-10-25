"use client";
import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { X } from "lucide-react";
import { crmRequest } from "../api";
type Option = {
    id: string;
    name: string;
    archivedAt?: string | null;
    email?: string | null;
    domain?: string | null;
};
const inputClass =
    "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
/** 선택한 항목 이름: 알려진 이름이 없으면 상세를 한 번 읽는다(불러온 100건 밖의 기존 연결). */
function SelectedName({
    kind,
    workspaceId,
    id,
    known,
}: {
    kind: "contacts" | "companies";
    workspaceId: number;
    id: string;
    known?: Option;
}) {
    const detail = useSWR<{ item: Option }>(
        known ? null : `/api/customer-crm/${kind}/${id}?workspaceId=${workspaceId}`,
        crmRequest,
    );
    const item = known ?? detail.data?.item;
    if (!item)
        return (
            <span className="text-muted-foreground">
                {detail.error ? "이름을 불러오지 못한 연결" : "불러오는 중…"}
            </span>
        );
    return (
        <span>
            {item.name}
            {item.archivedAt ? " · 보관됨" : ""}
        </span>
    );
}
/**
 * 고객·회사 검색 선택기(UX-088). 기존 목록 API의 q 검색으로 찾으므로 100건을 넘는 사업에서도 연결할 수 있다.
 * 폼에는 hidden input(name)으로 선택한 id를 보낸다. 보관된 기존 연결은 유지하되 새로 고를 때는 보관 항목을 숨긴다.
 */
export function EntityPicker({
    kind,
    workspaceId,
    name,
    label,
    initial,
    known,
    multiple = false,
}: {
    kind: "contacts" | "companies";
    workspaceId: number;
    name: string;
    label: string;
    initial: string[];
    known: Option[];
    multiple?: boolean;
}) {
    const [selected, setSelected] = useState<string[]>(initial),
        [labels, setLabels] = useState<Record<string, Option>>(() =>
            Object.fromEntries(known.map((o) => [o.id, o])),
        ),
        [query, setQuery] = useState(""),
        q = useDeferredValue(query.trim());
    const results = useSWR<Option[]>(
        q
            ? `/api/customer-crm/${kind}?${new URLSearchParams({ workspaceId: String(workspaceId), q, archived: "false" })}`
            : null,
        crmRequest,
    );
    function choose(option: Option) {
        setLabels((old) => ({ ...old, [option.id]: option }));
        setSelected((old) =>
            multiple
                ? old.includes(option.id)
                    ? old
                    : [...old, option.id]
                : [option.id],
        );
        setQuery("");
    }
    return (
        <div className="space-y-2">
            {selected.map((id) => (
                <input key={id} type="hidden" name={name} value={id} />
            ))}
            {!multiple && !selected.length && (
                <input type="hidden" name={name} value="" />
            )}
            <div className="flex flex-wrap gap-2 text-sm">
                {selected.length ? (
                    selected.map((id) => (
                        <span
                            key={id}
                            className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1"
                        >
                            <SelectedName
                                kind={kind}
                                workspaceId={workspaceId}
                                id={id}
                                known={labels[id]}
                            />
                            <button
                                type="button"
                                aria-label={`${label} 연결 해제`}
                                onClick={() =>
                                    setSelected((old) =>
                                        old.filter((v) => v !== id),
                                    )
                                }
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))
                ) : (
                    <span className="text-xs text-muted-foreground">
                        연결 없음
                    </span>
                )}
            </div>
            <input
                type="search"
                aria-label={`${label} 검색`}
                className={inputClass}
                placeholder={`${label} 이름·${kind === "contacts" ? "이메일" : "도메인"}·외부 번호로 검색`}
                value={query}
                maxLength={200}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                    // 검색 중 Enter로 편집 폼이 저장되지 않게 한다.
                    if (e.key === "Enter") e.preventDefault();
                }}
            />
            {q && (
                <ul
                    aria-label={`${label} 검색 결과`}
                    className="max-h-48 overflow-y-auto rounded-lg border text-sm"
                >
                    {results.isLoading && (
                        <li className="p-2 text-muted-foreground">검색 중…</li>
                    )}
                    {results.error && (
                        <li role="alert" className="p-2 text-red-700">
                            {(results.error as Error).message}
                        </li>
                    )}
                    {results.data && !results.data.length && (
                        <li className="p-2 text-muted-foreground">
                            검색 결과가 없습니다.
                        </li>
                    )}
                    {results.data?.slice(0, 20).map((option) => (
                        <li key={option.id}>
                            <button
                                type="button"
                                className="w-full p-2 text-left hover:bg-muted"
                                onClick={() => choose(option)}
                            >
                                {option.name}
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {option.email ?? option.domain ?? ""}
                                </span>
                                {selected.includes(option.id) && (
                                    <span className="ml-2 text-xs text-violet-700">
                                        선택됨
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                    {(results.data?.length ?? 0) > 20 && (
                        <li className="p-2 text-xs text-muted-foreground">
                            결과가 많습니다. 검색어를 더 구체적으로 입력해주세요.
                        </li>
                    )}
                </ul>
            )}
        </div>
    );
}
