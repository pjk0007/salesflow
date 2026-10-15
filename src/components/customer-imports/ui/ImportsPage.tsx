"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import Papa from "papaparse";
import { toast } from "sonner";
import type { InboxBootstrap } from "@/components/inbox/types";
import { importRequest, importWrite } from "../api";
import { useImportRun } from "../hooks/useImportRun";
import type { ImportForm, ImportJob, ImportSummary } from "../types";
import {
    kindNames,
    stateNames,
    operationNames,
    csvFields,
    fieldNames,
} from "../utils/labels";
import { exampleBundle } from "../utils/example";
import { ImportFilesPanel } from "@/components/customer-import-files/ui/ImportFilesPanel";
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
        workspaceId = chosen || availableWorkspaces[0]?.id || 0;
    const [form, setForm] = useState<ImportForm>({
            workspaceId: 0,
            source: "portable",
            namespace: "",
            format: "json",
            content: "",
            columns: {},
            updateImported: false,
            allowPartialHistory: false,
            expectedCounts: {},
        }),
        [columns, setColumns] = useState<string[]>([]),
        [job, setJob] = useState<ImportJob | null>(null),
        [busy, setBusy] = useState(false),
        [ack, setAck] = useState(false),
        [offset, setOffset] = useState(0);
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
        (error) => toast.error(error.message),
    );
    const locked = busy || runner.busy,
        change = (part: Partial<ImportForm>) => {
            if (locked) return;
            setForm((old) => ({ ...old, ...part }));
            setJob(null);
            setAck(false);
            setOffset(0);
        };
    async function preview() {
        if (!workspaceId) return;
        setBusy(true);
        try {
            const next = await importWrite<ImportJob>(
                "/api/customer-imports",
                { ...form, workspaceId },
                "POST",
            );
            setJob(next);
            setAck(false);
            setOffset(0);
            await list.mutate();
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function load(id: string, page = 0) {
        setBusy(true);
        try {
            setJob(
                await importRequest<ImportJob>(
                    `/api/customer-imports/${id}?offset=${page}`,
                ),
            );
            setOffset(page);
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
            toast.error((error as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function repreview() {
        if (!job) return;
        setBusy(true);
        try {
            const source = await importRequest<{ input: ImportForm }>(
                `/api/customer-imports/${job.id}?source=1`,
            );
            setForm(source.input);
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
        change({
            content,
            format,
            csvKind:
                format === "csv" ? form.csvKind || "contacts" : form.csvKind,
        });
        if (format === "csv")
            setColumns(Papa.parse(content, { header: true }).meta.fields || []);
    }
    if (
        bootstrap.data &&
        !availableWorkspaces.some((w) => w.id === workspaceId)
    )
        return (
            <div className="p-8">이 사업의 운영 관리 권한이 필요합니다.</div>
        );
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
                        setJob(null);
                    }}
                >
                    {availableWorkspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </select>
            </label>
            {(bootstrap.error || list.error) && (
                <p role="alert" className="text-sm text-red-700">
                    {(bootstrap.error || list.error).message}
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
                                        columns: {},
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
                                setColumns(
                                    Papa.parse(form.content, { header: true })
                                        .meta.fields || [],
                                );
                                change({ csvKind: form.csvKind || "contacts" });
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
                <div className="space-y-2 text-sm">
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
                        원본 {job.source} · {job.namespace} · 작업 {job.id}
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
                                    <li key={i}>{e}</li>
                                ))}
                            </ul>
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
                                    <li key={i}>{w}</li>
                                ))}
                            </ul>
                        </details>
                    )}
                    {job.reason && (
                        <p
                            role="alert"
                            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
                        >
                            {job.reason}
                        </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                        과거 상담은 ‘이전 상담 기록’에 저장하며 고객에게
                        공개하거나 발송하지 않습니다. 첨부파일은 상담 정보 저장
                        후 아래 ‘과거 상담 첨부파일 원본’에서 따로 가져옵니다.
                        이 화면을 열어둔 동안 25행씩 진행하며, 닫은 뒤에도
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
                                onClick={() => void stop("cancel")}
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
                                            className="border-b align-top"
                                        >
                                            <td className="p-2">
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
                                                        {e}
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
                        {job.audit.map((a) => (
                            <p
                                key={a.id}
                                className="mt-2 text-xs text-muted-foreground"
                            >
                                {new Date(a.createdAt).toLocaleString("ko-KR")}{" "}
                                · {a.actorName} · {a.action}
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
                {list.data?.rows.map((item) => (
                    <button
                        key={item.id}
                        className="flex w-full flex-wrap justify-between gap-2 rounded-lg border p-3 text-left text-sm"
                        disabled={locked}
                        onClick={() => void load(item.id)}
                    >
                        <span>
                            {item.source} · {item.namespace}
                        </span>
                        <span>
                            {stateNames[item.state]} · {item.cursor}행 처리
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
        </main>
    );
}
