"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import Papa from "papaparse";
import { toast } from "sonner";
import type { InboxBootstrap } from "@/components/inbox/types";
import {
    importErrorMessage,
    importLongWrite,
    importRequest,
    importWrite,
    isUncertainImportWrite,
} from "../api";
import { SCREEN_IMPORT_BATCH, useImportRun } from "../hooks/useImportRun";
import type { ImportForm, ImportJob, ImportSummary } from "../types";
import {
    kindNames,
    stateNames,
    operationNames,
    csvFields,
    fieldNames,
    sourceNames,
    actionNames,
    importMessageLabel,
} from "../utils/labels";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { exampleBundle } from "../utils/example";
import { ImportFilesPanel } from "@/components/customer-import-files/ui/ImportFilesPanel";
/** 아직 매핑하지 않은 필드만, 필드명과 같은 CSV 열(대소문자 무시)로 채운다. 사용자 입력은 덮어쓰지 않는다. */
function autoColumns(
    kind: string,
    found: string[],
    current: Record<string, string>,
) {
    const next = { ...current };
    for (const field of csvFields[kind] || []) {
        if (next[field]) continue;
        const column = found.find(
            (c) => c.trim().toLowerCase() === field.toLowerCase(),
        );
        if (column) next[field] = column;
    }
    return next;
}
/** 분할 도구 manifest의 expectedCounts(또는 그 객체를 담은 JSON)를 종류별 건수로 읽는다. */
function parseExpectedCounts(text: string): Record<string, number> | null {
    try {
        const value = JSON.parse(text) as Record<string, unknown>;
        const counts = (
            value && typeof value.expectedCounts === "object"
                ? value.expectedCounts
                : value
        ) as Record<string, unknown>;
        if (!counts || typeof counts !== "object" || Array.isArray(counts))
            return null;
        const result: Record<string, number> = {};
        for (const [kind, n] of Object.entries(counts)) {
            if (!(kind in kindNames)) return null;
            if (!Number.isSafeInteger(n) || (n as number) < 0) return null;
            result[kind] = n as number;
        }
        return result;
    } catch {
        return null;
    }
}
const STALE_MINUTES = 5;
const box = "rounded-xl border bg-background p-4",
    button = "rounded-lg border px-3 py-2 text-sm disabled:opacity-40",
    inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm";
export function ImportsPage({ role }: { role: string }) {
    void role;
    const params = useSearchParams(),
        bootstrap = useSWR<InboxBootstrap>("/api/inbox", importRequest);
    const availableWorkspaces =
        bootstrap.data?.workspaces.filter((w) => w.abilities.manage) ?? [];
    const [chosen, setWorkspace] = useState(
            Number(params.get("workspaceId")) || 0,
        ),
        chosenAllowed = availableWorkspaces.some((w) => w.id === chosen),
        // 주소의 사업이 운영 관리 권한 밖이면 관리 가능한 첫 사업으로 연다(UX-102).
        workspaceId = (chosenAllowed ? chosen : availableWorkspaces[0]?.id) || 0,
        warnedWorkspace = useRef(false);
    useEffect(() => {
        if (
            !bootstrap.data ||
            !chosen ||
            chosenAllowed ||
            !availableWorkspaces.length ||
            warnedWorkspace.current
        )
            return;
        warnedWorkspace.current = true;
        toast.info(
            "주소의 사업은 운영 관리 권한이 없어 관리할 수 있는 첫 사업으로 열었습니다.",
        );
    }, [bootstrap.data, chosen, chosenAllowed, availableWorkspaces.length]);
    const [form, setForm] = useState<ImportForm>({
            workspaceId: 0,
            source: "portable",
            namespace: "",
            format: "json",
            content: "",
            columns: {},
            updateImported: false,
            allowPartialHistory: false,
            verifiedCustomerHistory: false,
            expectedCounts: {},
        }),
        [columns, setColumns] = useState<string[]>([]),
        [job, setJob] = useState<ImportJob | null>(null),
        [busy, setBusy] = useState(false),
        [ack, setAck] = useState(false),
        [offset, setOffset] = useState(0),
        [view, setView] = useState({ issues: false, fileAudit: false }),
        [countsText, setCountsText] = useState(""),
        [now, setNow] = useState(() => Date.now());
    const { confirm, confirmationDialog } = useAsyncConfirm();
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    const list = useSWR<{ rows: ImportSummary[]; hasMore: boolean }>(
        workspaceId ? `/api/customer-imports?workspaceId=${workspaceId}` : null,
        importRequest,
        { refreshInterval: 5000 },
    );
    const runner = useImportRun(
        (next) => {
            setJob(next);
            setOffset(0);
            void list.mutate();
        },
        (error, current) => {
            toast.error(error.message);
            // 결과를 모르는 실패 뒤에는 저장된 처리 위치를 다시 읽어 보여 준다(UX-089).
            void load(current.id);
            void list.mutate();
        },
    );
    useEffect(() => {
        if (!runner.busy) return;
        // 실행은 이 화면이 열려 있을 때만 진행된다. 닫기 전에 알린다(UX-107).
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [runner.busy]);
    const locked = busy || runner.busy,
        change = (part: Partial<ImportForm>) => {
            if (locked) return;
            setForm((old) => ({
                ...old,
                ...part,
                verifiedCustomerHistory:
                    (part.source ?? old.source) === "channel" &&
                    (part.format ?? old.format) === "json" &&
                    (part.verifiedCustomerHistory ??
                        ("namespace" in part || "workspaceId" in part || "source" in part || "content" in part || "format" in part || "csvKind" in part || "columns" in part
                            ? false
                            : old.verifiedCustomerHistory === true)),
            }));
            setJob(null);
            setAck(false);
            setOffset(0);
        };
    async function preview() {
        if (!workspaceId) return;
        setBusy(true);
        try {
            const next = await importLongWrite<ImportJob>(
                "/api/customer-imports",
                { ...form, workspaceId, verifiedCustomerHistory: form.source === "channel" && form.format === "json" && form.verifiedCustomerHistory === true },
            );
            setJob(next);
            setAck(false);
            setOffset(0);
            setView({ issues: false, fileAudit: false });
            await list.mutate();
        } catch (error) {
            toast.error(
                importErrorMessage(
                    error,
                    "미리보기 결과 확인이 지연되고 있습니다. 서버에서 계속 처리 중일 수 있으니 아래 '최근 이전 작업'에 새 작업이 생겼는지 확인한 뒤 다시 만들어주세요.",
                ),
            );
            if (isUncertainImportWrite(error)) void list.mutate();
        } finally {
            setBusy(false);
        }
    }
    async function load(id: string, page = 0, nextView = view) {
        setBusy(true);
        try {
            const query = new URLSearchParams({ offset: String(page) });
            if (nextView.issues) query.set("issues", "1");
            if (nextView.fileAudit) query.set("fileAudit", "1");
            setJob(
                await importRequest<ImportJob>(
                    `/api/customer-imports/${id}?${query}`,
                ),
            );
            setOffset(page);
            setView(nextView);
            setAck(false);
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function stop(action: "pause" | "cancel") {
        if (!job) return;
        if (runner.busy) {
            runner.stop(action);
            return;
        }
        setBusy(true);
        try {
            setJob(
                await importWrite<ImportJob>(
                    `/api/customer-imports/${job.id}`,
                    { action, version: job.version },
                    "POST",
                ),
            );
            await list.mutate();
        } catch (error) {
            // 중단은 확인창 안에서 실행하므로 오류를 확인창에 그대로 보여 준다.
            if (action === "cancel") throw error;
            toast.error((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    function confirmCancel() {
        if (!job) return;
        const left = Math.max(0, job.total - job.cursor);
        confirm({
            title: "이전 작업 중단",
            description: `남은 ${left.toLocaleString("ko-KR")}행은 가져오지 않습니다.\n중단한 작업은 다시 이어서 실행할 수 없고, 원본을 불러와 새 미리보기·승인부터 다시 해야 합니다.\n이미 가져온 ${job.cursor.toLocaleString("ko-KR")}행은 보존됩니다. 잠시 멈추려면 '일시 중지'를 사용하세요.`,
            confirmLabel: "중단",
            onConfirm: () => stop("cancel"),
        });
    }
    async function repreview() {
        if (!job) return;
        setBusy(true);
        try {
            const source = await importRequest<{ input: ImportForm }>(
                `/api/customer-imports/${job.id}?source=1`,
            );
            setForm({
                ...source.input,
                verifiedCustomerHistory: source.input.source === "channel" && source.input.format === "json" && source.input.verifiedCustomerHistory === true,
            });
            setJob(null);
            setColumns(
                source.input.format === "csv"
                    ? Papa.parse(source.input.content, { header: true }).meta
                          .fields || []
                    : [],
            );
            setAck(false);
            toast.info(
                "원본을 편집 영역에 불러왔습니다. 매핑을 확인한 뒤 새 미리보기를 만들어주세요.",
            );
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function fileSelected(file: File | undefined) {
        if (!file) return;
        if (file.size > 20000000) {
            toast.error("파일은 20MB 이하로 나눠주세요.");
            return;
        }
        const content = await file.text();
        if (content.length > 5000000) {
            toast.error("한 자료는 500만자 이하로 나눠주세요.");
            return;
        }
        const format = file.name.toLowerCase().endsWith(".csv")
            ? "csv"
            : "json";
        const kind =
            format === "csv" ? form.csvKind || "contacts" : form.csvKind;
        const found =
            format === "csv"
                ? Papa.parse(content, { header: true, preview: 1 }).meta
                      .fields || []
                : [];
        change({
            content,
            format,
            csvKind: kind,
            ...(format === "csv"
                ? { columns: autoColumns(kind!, found, form.columns) }
                : {}),
        });
        if (format === "csv") setColumns(found);
    }
    function setExpectedCount(kind: string, value: string) {
        const next = { ...form.expectedCounts };
        if (value === "") delete next[kind];
        else next[kind] = Math.max(0, Math.floor(Number(value)));
        change({ expectedCounts: next });
    }
    function pasteExpectedCounts() {
        const counts = parseExpectedCounts(countsText);
        if (!counts) {
            toast.error(
                '예상 건수 JSON을 확인해주세요. 예: {"contacts": 120, "messages": 3400}',
            );
            return;
        }
        change({ expectedCounts: counts });
        setCountsText("");
    }
    if (bootstrap.error && !bootstrap.data)
        return (
            <QueryErrorState
                error={bootstrap.error}
                onRetry={() => bootstrap.mutate()}
            />
        );
    if (!bootstrap.data)
        return (
            <div className="mx-auto max-w-[1400px] space-y-4 p-6" aria-busy="true">
                <p className="text-sm text-muted-foreground">
                    가져올 사업을 불러오는 중…
                </p>
                <Skeleton className="h-10 max-w-sm" />
                <Skeleton className="h-64" />
            </div>
        );
    if (!availableWorkspaces.length)
        return (
            <div className="p-8">
                운영 관리 권한이 있는 사업이 없습니다. 조직 관리자에게 사업의
                운영 관리 권한을 요청해주세요.
            </div>
        );
    const failedAt = (() => {
        if (!job || job.state !== "failed") return null;
        const position = job.audit.find((a) => a.action === "failed")?.detail
            ?.position;
        return typeof position === "number" ? position : null;
    })();
    const idleMinutes = (item: { state: string; updatedAt: string }) =>
        item.state === "running"
            ? Math.floor((now - Date.parse(item.updatedAt)) / 60000)
            : 0;
    return (
        <main className="mx-auto max-w-[1400px] space-y-6 p-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">
                        기존 고객 자료 이전
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        원본 확인 → 필드·관계 매핑 → 미리보기 → 사람이 실행 →
                        결과 확인
                    </p>
                </div>
                <a
                    className={button}
                    href={`/customer-crm?workspaceId=${workspaceId}`}
                >
                    고객 관리로
                </a>
            </header>
            <label className="block max-w-sm space-y-2 text-sm">
                가져올 사업
                <select
                    className={inputClass}
                    value={workspaceId}
                    disabled={locked}
                    onChange={(e) => {
                        setWorkspace(Number(e.target.value));
                        change({ workspaceId: Number(e.target.value), verifiedCustomerHistory: false });
                    }}
                >
                    {availableWorkspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </select>
            </label>
            {bootstrap.error && (
                <p role="alert" className="text-sm text-red-700">
                    {bootstrap.error.message}
                </p>
            )}
            <section className={box + " space-y-4"}>
                <h2 className="font-semibold">1. 원본과 매핑</h2>
                <p className="text-sm text-muted-foreground">
                    원본 계정 이름은 재이전할 때도 같게 입력합니다. 이메일로
                    고객을 합치지 않습니다. 외부 ID가 같은 기존 고객은 필드를
                    보존하고 이력만 연결합니다.
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                    <label className="space-y-1 text-sm">
                        원본 서비스
                        <select
                            className={inputClass}
                            value={form.source}
                            disabled={locked}
                            onChange={(e) =>
                                change({
                                    source: e.target
                                        .value as ImportForm["source"],
                                })
                            }
                        >
                            <option value="portable">공통 이전 형식</option>
                            <option value="channel">채널톡 API 내보내기</option>
                            <option value="intercom">
                                인터컴 API 내보내기
                            </option>
                            <option value="hubspot">
                                허브스팟 CRM 내보내기
                            </option>
                        </select>
                    </label>
                    <label className="space-y-1 text-sm">
                        원본 계정 이름
                        <input
                            className={inputClass}
                            value={form.namespace}
                            disabled={locked}
                            onChange={(e) =>
                                change({ namespace: e.target.value })
                            }
                            placeholder="예: 디하 채널톡 계정"
                        />
                    </label>
                    <label className="space-y-1 text-sm">
                        자료 형식
                        <select
                            className={inputClass}
                            value={form.format}
                            disabled={locked}
                            onChange={(e) =>
                                change({
                                    format: e.target.value as "json" | "csv",
                                    csvKind: form.csvKind || "contacts",
                                })
                            }
                        >
                            <option value="json">JSON 묶음</option>
                            <option value="csv">CSV 한 종류</option>
                        </select>
                    </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label className={button + " cursor-pointer"}>
                        JSON·CSV 파일 선택
                        <input
                            type="file"
                            accept=".json,.csv"
                            disabled={locked}
                            className="sr-only"
                            onChange={(e) =>
                                void fileSelected(e.target.files?.[0])
                            }
                        />
                    </label>
                    <button
                        className={button}
                        disabled={locked}
                        onClick={() => {
                            change({
                                source: "portable",
                                format: "json",
                                namespace: `가상 이전 ${crypto.randomUUID().slice(0, 8)}`,
                                content: JSON.stringify(
                                    exampleBundle(),
                                    null,
                                    2,
                                ),
                            });
                        }}
                    >
                        가상 예제 자료 불러오기
                    </button>
                    <span className="text-xs text-muted-foreground">
                        원본 서비스의 API 키를 붙여넣지 마세요.
                    </span>
                </div>
                <label className="block space-y-2 text-sm">
                    원본 자료
                    <textarea
                        aria-label="원본 자료"
                        className={inputClass + " font-mono text-xs"}
                        rows={9}
                        disabled={locked}
                        value={form.content}
                        onChange={(e) => change({ content: e.target.value })}
                    />
                </label>
                {form.format === "csv" && (
                    <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                        <label className="block max-w-sm space-y-1 text-sm">
                            CSV 자료 종류
                            <select
                                className={inputClass}
                                value={form.csvKind || "contacts"}
                                onChange={(e) =>
                                    change({
                                        csvKind: e.target
                                            .value as ImportForm["csvKind"],
                                        columns: autoColumns(
                                            e.target.value,
                                            columns,
                                            {},
                                        ),
                                    })
                                }
                            >
                                {Object.entries(kindNames).map(
                                    ([key, name]) => (
                                        <option key={key} value={key}>
                                            {name}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                        <button
                            className={button}
                            onClick={() => {
                                const found =
                                    Papa.parse(form.content, {
                                        header: true,
                                        preview: 1,
                                    }).meta.fields || [];
                                setColumns(found);
                                change({
                                    csvKind: form.csvKind || "contacts",
                                    columns: autoColumns(
                                        form.csvKind || "contacts",
                                        found,
                                        form.columns,
                                    ),
                                });
                            }}
                        >
                            CSV 열 읽기
                        </button>
                        <p className="text-xs text-muted-foreground">
                            관계에는 원본 ID를 지정합니다. companies·pipelines
                            등 관계 자료를 먼저 이전할 수 있습니다. 날짜는 ISO
                            형식, 이름은 firstname + lastname 형태도 지원합니다.
                        </p>
                        <div className="grid gap-3 md:grid-cols-3">
                            {(csvFields[form.csvKind || "contacts"] || []).map(
                                (field) => (
                                    <label
                                        className="space-y-1 text-xs"
                                        key={field}
                                    >
                                        {fieldNames[field] || field}
                                        <input
                                            className={inputClass}
                                            list="import-columns"
                                            value={form.columns[field] || ""}
                                            onChange={(e) =>
                                                change({
                                                    columns: {
                                                        ...form.columns,
                                                        [field]: e.target.value,
                                                    },
                                                })
                                            }
                                            placeholder="원본 열 이름"
                                        />
                                    </label>
                                ),
                            )}
                            <datalist id="import-columns">
                                {columns.map((c) => (
                                    <option key={c} value={c} />
                                ))}
                            </datalist>
                        </div>
                    </div>
                )}
                <details className="rounded-lg border p-3 text-sm">
                    <summary className="cursor-pointer">
                        분할 자료 예상 건수 (선택)
                        {Object.keys(form.expectedCounts).length
                            ? ` · ${Object.entries(form.expectedCounts)
                                  .map(([k, n]) => `${kindNames[k] ?? k} ${n}`)
                                  .join(", ")}`
                            : ""}
                    </summary>
                    <p className="mt-2 text-xs text-muted-foreground">
                        채널톡 수집 도구가 만든 분할 파일은 manifest의 파일별
                        expectedCounts를 입력하면 읽은 건수와 다를 때 실행을
                        막습니다. 빈 칸은 대조하지 않습니다.
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                        {Object.entries(kindNames).map(([kind, name]) => (
                            <label key={kind} className="space-y-1 text-xs">
                                {name}
                                <input
                                    type="number"
                                    min={0}
                                    inputMode="numeric"
                                    className={inputClass}
                                    disabled={locked}
                                    value={form.expectedCounts[kind] ?? ""}
                                    onChange={(e) =>
                                        setExpectedCount(kind, e.target.value)
                                    }
                                />
                            </label>
                        ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                        <label className="min-w-[260px] flex-1 space-y-1 text-xs">
                            manifest의 expectedCounts JSON 붙여넣기
                            <input
                                className={inputClass + " font-mono"}
                                disabled={locked}
                                value={countsText}
                                onChange={(e) => setCountsText(e.target.value)}
                                placeholder='{"contacts": 120, "messages": 3400}'
                            />
                        </label>
                        <button
                            className={button}
                            disabled={locked || !countsText.trim()}
                            onClick={pasteExpectedCounts}
                        >
                            건수 채우기
                        </button>
                    </div>
                </details>
                <div className="space-y-2 text-sm">
                    {form.source === "channel" && form.format === "json" && (
                        <label className="flex gap-2">
                            <input
                                type="checkbox"
                                aria-label="확인된 회원 ID 기준 과거 상담 공개 확인"
                                checked={form.verifiedCustomerHistory === true}
                                disabled={locked}
                                onChange={(e) => change({ verifiedCustomerHistory: e.target.checked })}
                            />
                            이 원본 계정의 회원 ID가 이 사업 사이트의 확인된 회원 ID와 같은 체계임을 확인했으며, 고객 본인에게 공개 대화 이력을 제공합니다.
                        </label>
                    )}
                    {form.source === "channel" && form.format === "csv" && (
                        <p className="text-xs text-muted-foreground">CSV는 회원 원본 확인 근거가 없어 직원 보관용으로 가져옵니다.</p>
                    )}
                    <label className="flex gap-2">
                        <input
                            type="checkbox"
                            checked={form.updateImported}
                            disabled={locked}
                            onChange={(e) =>
                                change({ updateImported: e.target.checked })
                            }
                        />
                        이전에 가져온 자료의 원본 변경도 검토 · 샌드비에서
                        수정한 값은 덮어쓰지 않음
                    </label>
                    <label className="flex gap-2">
                        <input
                            type="checkbox"
                            checked={form.allowPartialHistory}
                            disabled={locked}
                            onChange={(e) =>
                                change({
                                    allowPartialHistory: e.target.checked,
                                })
                            }
                        />
                        인터컴의 500개 제한에 걸린 상담을 부분 자료로 이전하는
                        것에 동의
                    </label>
                </div>
                <button
                    className={button + " bg-[#635BFF] text-white"}
                    disabled={locked || !form.namespace || !form.content}
                    onClick={() => void preview()}
                >
                    매핑·중복 미리보기 만들기
                </button>
            </section>
            {job && (
                <section className={box + " space-y-4"}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="font-semibold">
                            2. 검토와 실행 ·{" "}
                            {stateNames[job.state] || job.state}
                        </h2>
                        <span className="text-sm">
                            {job.cursor} / {job.total}행 처리
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        원본 {sourceNames[job.source] ?? job.source} ·{" "}
                        {job.namespace} · 작업 {job.id}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(job.counts).map(([k, n]) => (
                            <span
                                key={k}
                                className="rounded-lg bg-muted px-3 py-2 text-xs"
                            >
                                {kindNames[k]} {n}행
                            </span>
                        ))}
                    </div>
                    {!!job.errors.length && (
                        <div
                            role="alert"
                            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
                        >
                            <p className="font-semibold">
                                오류 {job.errors.length}개 · 실행할 수 없습니다
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                {job.errors.slice(0, 30).map((e, i) => (
                                    <li key={i}>{importMessageLabel(e)}</li>
                                ))}
                            </ul>
                            {job.errors.length > 30 && (
                                <p className="mt-2 text-xs">
                                    외 {job.errors.length - 30}개 · 아래
                                    &apos;오류·확인 행만 보기&apos;로 모두 확인할
                                    수 있습니다.
                                </p>
                            )}
                        </div>
                    )}
                    {!!job.warnings.length && (
                        <details
                            open
                            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
                        >
                            <summary>
                                확인할 내용 {job.warnings.length}개
                            </summary>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                                {job.warnings.slice(0, 30).map((w, i) => (
                                    <li key={i}>{importMessageLabel(w)}</li>
                                ))}
                            </ul>
                            {job.warnings.length > 30 && (
                                <p className="mt-2 text-xs">
                                    외 {job.warnings.length - 30}개 · 아래
                                    &apos;오류·확인 행만 보기&apos;로 모두 확인할
                                    수 있습니다.
                                </p>
                            )}
                        </details>
                    )}
                    {job.reason && (
                        <p
                            role="alert"
                            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
                        >
                            {importMessageLabel(job.reason)}
                            {failedAt !== null && (
                                <button
                                    className="ml-3 underline"
                                    disabled={locked}
                                    onClick={() =>
                                        void load(
                                            job.id,
                                            Math.floor(failedAt / 100) * 100,
                                            { ...view, issues: false },
                                        )
                                    }
                                >
                                    해당 행 보기
                                </button>
                            )}
                        </p>
                    )}
                    {job.state === "running" &&
                        !runner.busy &&
                        idleMinutes(job) >= STALE_MINUTES && (
                            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                                최근 {idleMinutes(job)}분 동안 진행이 없습니다.
                                실행은 화면이 열려 있을 때만 진행됩니다.
                                &apos;저장된 위치에서 계속 가져오기&apos;로 이어서
                                실행해주세요.
                            </p>
                        )}
                    <p className="text-sm text-muted-foreground">
                        {job.source === "channel" && job.input.format === "json" && job.input.verifiedCustomerHistory === true
                            ? "저장된 공개 선택: 확인된 고객 본인에게 공개 대화와 공개 첨부파일을 읽기 전용으로 제공합니다. 내부 메모는 직원만 볼 수 있으며, 과거 상담으로 메시지를 발송하지 않습니다."
                            : "저장된 공개 선택: 직원 전용입니다. 확인된 회원 ID 체계의 공개를 승인하려면 원본을 불러와 확인한 뒤 새 미리보기로 재이전해야 합니다."}
                        {" "}과거 상담은 ‘이전 상담 기록’에 저장합니다. 첨부파일은 상담 정보 저장
                        후 아래 ‘과거 상담 첨부파일 원본’에서 따로 가져옵니다.
                        이 화면을 열어둔 동안 {SCREEN_IMPORT_BATCH}행씩 진행하며, 닫은 뒤에도
                        완료한 행은 남아 나중에 계속할 수 있습니다.
                    </p>
                    {job.state === "ready" && (
                        <label className="flex gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={ack}
                                disabled={locked}
                                onChange={(e) => setAck(e.target.checked)}
                            />
                            사업·원본 계정·건수·기존 연결·첨부 누락을 확인했고
                            이 자료를 가져오겠습니다.
                        </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {job.state === "ready" && (
                            <button
                                className={button + " bg-[#635BFF] text-white"}
                                disabled={locked || !ack || !!job.errors.length}
                                onClick={() => void runner.run(job, "start")}
                            >
                                검토한 자료 가져오기
                            </button>
                        )}
                        {["running", "paused", "failed"].includes(job.state) &&
                            !runner.busy && (
                                <button
                                    className={button}
                                    disabled={busy}
                                    onClick={() =>
                                        void runner.run(
                                            job,
                                            job.state === "running"
                                                ? undefined
                                                : "resume",
                                        )
                                    }
                                >
                                    저장된 위치에서 계속 가져오기
                                </button>
                            )}
                        {job.state === "running" && (
                            <button
                                className={button}
                                disabled={busy || !!runner.requested}
                                onClick={() => void stop("pause")}
                            >
                                {runner.requested
                                    ? "현재 묶음 처리 후 중지…"
                                    : "일시 중지"}
                            </button>
                        )}
                        {!["completed", "cancelled"].includes(job.state) && (
                            <button
                                className={button}
                                disabled={busy || !!runner.requested}
                                onClick={confirmCancel}
                            >
                                이전 중단 · 완료 행은 보존
                            </button>
                        )}
                        <button
                            className={button}
                            disabled={locked}
                            onClick={() => void repreview()}
                        >
                            원본 불러와 새 미리보기 준비
                        </button>
                    </div>
                    {(job.issueRows > 0 || view.issues) && (
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={view.issues}
                                disabled={locked}
                                onChange={(e) =>
                                    void load(job.id, 0, {
                                        ...view,
                                        issues: e.target.checked,
                                    })
                                }
                            />
                            오류·확인 행만 보기 ({job.issueRows}행)
                        </label>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-2">자료</th>
                                    <th>원본 ID · 이름</th>
                                    <th>적용</th>
                                    <th>결과·원본 확인</th>
                                </tr>
                            </thead>
                            <tbody>
                                {job.rows.map((row) => {
                                    const saved = job.results.find(
                                        (r) => r.position === row.index,
                                    );
                                    return (
                                        <tr
                                            key={row.index}
                                            className={`border-b align-top ${row.index === failedAt ? "bg-red-50" : ""}`}
                                        >
                                            <td className="p-2">
                                                {row.index + 1}.{" "}
                                                {kindNames[row.kind]}
                                            </td>
                                            <td className="p-2">
                                                {row.sourceId}
                                                <br />
                                                {String(
                                                    row.data.name ||
                                                        row.data.title ||
                                                        row.data.body ||
                                                        "",
                                                ).slice(0, 120)}
                                            </td>
                                            <td className="p-2">
                                                {operationNames[row.operation]}
                                                {row.errors.map((e, i) => (
                                                    <p
                                                        key={i}
                                                        className="mt-1 text-red-700"
                                                    >
                                                        {importMessageLabel(e)}
                                                    </p>
                                                ))}
                                                {row.warnings.map((w, i) => (
                                                    <p
                                                        key={`w${i}`}
                                                        className="mt-1 text-amber-800"
                                                    >
                                                        {importMessageLabel(w)}
                                                    </p>
                                                ))}
                                            </td>
                                            <td className="p-2">
                                                {saved ? (
                                                    <>
                                                        <p>
                                                            완료 ·{" "}
                                                            {saved.targetId}
                                                        </p>
                                                        {row.kind ===
                                                            "conversations" && (
                                                            <a
                                                                className="text-violet-700 underline"
                                                                href={`/inbox?channelId=${bootstrap.data?.channels.find((c) => c.workspaceId === job.workspaceId)?.id || ""}&conversation=${saved.targetId}&filter=history`}
                                                            >
                                                                가져온 과거 상담
                                                                열기
                                                            </a>
                                                        )}
                                                    </>
                                                ) : (
                                                    <p>미처리</p>
                                                )}
                                                <details className="mt-2">
                                                    <summary className="cursor-pointer">
                                                        필드·관계·원본
                                                    </summary>
                                                    <pre className="mt-2 max-h-64 max-w-[500px] overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
                                                        {JSON.stringify(
                                                            {
                                                                data: row.data,
                                                                dependencies:
                                                                    row.dependencies,
                                                                original:
                                                                    row.original,
                                                            },
                                                            null,
                                                            2,
                                                        )}
                                                    </pre>
                                                </details>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex gap-2">
                        <button
                            className={button}
                            disabled={locked || offset === 0}
                            onClick={() =>
                                void load(job.id, Math.max(0, offset - 100))
                            }
                        >
                            이전 100행
                        </button>
                        <button
                            className={button}
                            disabled={locked || !job.hasMore}
                            onClick={() => void load(job.id, offset + 100)}
                        >
                            다음 100행
                        </button>
                    </div>
                    <details>
                        <summary className="cursor-pointer text-sm">
                            검토·실행·중단 이력
                        </summary>
                        <label className="mt-2 flex items-center gap-2 text-xs">
                            <input
                                type="checkbox"
                                checked={view.fileAudit}
                                disabled={locked}
                                onChange={(e) =>
                                    void load(job.id, offset, {
                                        ...view,
                                        fileAudit: e.target.checked,
                                    })
                                }
                            />
                            첨부 파일 기록도 보기
                        </label>
                        {job.audit.map((a) => (
                            <p
                                key={a.id}
                                className="mt-2 text-xs text-muted-foreground"
                            >
                                {new Date(a.createdAt).toLocaleString("ko-KR")}{" "}
                                · {a.actorName} ·{" "}
                                {actionNames[a.action] ?? a.action}
                                {a.action === "failed" &&
                                typeof a.detail?.reason === "string"
                                    ? ` · ${importMessageLabel(a.detail.reason)}`
                                    : ""}
                            </p>
                        ))}
                    </details>
                </section>
            )}
            {job && job.cursor > 0 && (
                <ImportFilesPanel key={job.id} jobId={job.id} />
            )}
            <section className={box + " space-y-3"}>
                <h2 className="font-semibold">최근 이전 작업</h2>
                {list.error && !list.data && (
                    <QueryErrorState
                        error={list.error}
                        onRetry={() => list.mutate()}
                    />
                )}
                {list.isLoading && (
                    <div aria-busy="true" className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                            최근 작업을 불러오는 중…
                        </p>
                        <Skeleton className="h-12" />
                    </div>
                )}
                {list.data && !list.data.rows.length && (
                    <p className="text-sm text-muted-foreground">
                        아직 이전 작업이 없습니다. 위에서 원본을 불러와
                        미리보기를 만들면 여기에 표시됩니다.
                    </p>
                )}
                {list.data?.rows.map((item) => (
                    <button
                        key={item.id}
                        className="flex w-full flex-wrap justify-between gap-2 rounded-lg border p-3 text-left text-sm"
                        disabled={locked}
                        onClick={() => void load(item.id, 0, { issues: false, fileAudit: false })}
                    >
                        <span>
                            {sourceNames[item.source] ?? item.source} ·{" "}
                            {item.namespace}
                        </span>
                        <span>
                            {stateNames[item.state] ?? item.state} ·{" "}
                            {item.cursor}행 처리
                            {!(runner.busy && job?.id === item.id) &&
                                idleMinutes(item) >= STALE_MINUTES && (
                                    <span className="ml-2 text-amber-700">
                                        최근 {idleMinutes(item)}분 진행 없음 ·
                                        계속하기
                                    </span>
                                )}
                        </span>
                    </button>
                ))}
                {list.data?.hasMore && (
                    <p className="text-xs text-muted-foreground">
                        최근 50개 작업입니다. API 커서로 이전 목록을 더 조회할
                        수 있습니다.
                    </p>
                )}
            </section>
            {confirmationDialog}
        </main>
    );
}
