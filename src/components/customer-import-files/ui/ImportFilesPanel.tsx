"use client";
import { useState } from "react";
import type { ImportFile } from "../types";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import { useImportFiles } from "../hooks/useImportFiles";
const button = "rounded-lg border px-3 py-2 text-xs disabled:opacity-40";
const labels = {
    pending: "대기",
    fetching: "가져오는 중",
    ready: "이전 완료",
    failed: "확인 필요",
    needs_source: "원본 주소·파일 필요",
};
function FileRow({
    row,
    actions,
}: {
    row: ImportFile;
    actions: ReturnType<typeof useImportFiles>;
}) {
    const [url, setUrl] = useState(""),
        [expanded, setExpanded] = useState(false);
    const oversized = row.expectedSize !== null && row.expectedSize > MAX_FILE_BYTES;
    const locked =
        oversized ||
        actions.busy ||
        !row.active ||
        row.state === "ready" ||
        !row.metadataValid ||
        (row.state === "fetching" && !row.interrupted);
    return (
        <li className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="break-all">{row.fileName}</strong>
                <span>
                    {!row.active
                        ? "이전 원본"
                        : row.interrupted
                          ? "중단됨 · 재시도 가능"
                          : labels[row.state]}
                </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
                원본 상담 {row.locator.conversationId} ·{" "}
                {row.expectedSize === null
                    ? "크기 정보 없음"
                    : `${row.expectedSize.toLocaleString()}바이트`}{" "}
                · 시도 {row.attempts}회
            </p>
            {row.error && row.active && (
                <p className="mt-2 text-amber-800">{row.error}</p>
            )}
            {oversized && row.active && row.state !== "ready" && (
                <p className="mt-2 text-amber-800">
                    20MB를 넘는 이전 첨부라 이 화면에서는 가져올 수 없습니다.
                    개발 담당자에게 파일 이름과 원본 상담 번호를 전달해 비공개
                    파일 저장소 이전 도구(관리자 CLI, 문서
                    docs/2026-10-14-customer-inbox/IMPORT-FILES.md)로 옮겨달라고
                    요청해주세요.
                </p>
            )}
            {!row.metadataValid && row.active && row.state !== "ready" && (
                <p className="mt-2 text-amber-800">
                    원본의 크기·SHA-256 정보를 수정해서 자료를 다시
                    가져와주세요. 원본 자료(JSON)에서 이 파일의 크기·SHA-256
                    값을 고친 뒤 위의 &apos;원본 불러와 새 미리보기
                    준비&apos;로 다시 가져오면 새 파일 목록이 만들어집니다.
                </p>
            )}
            {row.active && row.state !== "ready" && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    {row.sourceHost && (
                        <button
                            className={button}
                            disabled={locked}
                            onClick={() => void actions.fetch(row)}
                        >
                            {row.state === "pending"
                                ? "파일 가져오기"
                                : "다시 시도"}
                        </button>
                    )}
                    <button
                        className={button}
                        disabled={locked}
                        onClick={() => setExpanded(!expanded)}
                    >
                        원본 주소 갱신
                    </button>
                    <label
                        className={
                            button +
                            (locked ? " opacity-40" : " cursor-pointer")
                        }
                    >
                        보관 파일로 보충
                        <input
                            aria-label={`${row.fileName} 보관 파일로 보충`}
                            className="sr-only"
                            type="file"
                            disabled={locked}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void actions.upload(row, file);
                                e.target.value = "";
                            }}
                        />
                    </label>
                </div>
            )}
            {expanded && !locked && (
                <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void actions.source(row, url).then((ok) => {
                            if (ok) {
                                setUrl("");
                                setExpanded(false);
                            }
                        });
                    }}
                >
                    <input
                        aria-label={`${row.fileName} 새 원본 주소`}
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="min-w-64 flex-1 rounded-lg border bg-background p-2 text-xs"
                        type="url"
                        required
                        placeholder="원본 서비스에서 갱신한 HTTPS 다운로드 주소"
                    />
                    <button className={button}>주소 저장</button>
                </form>
            )}
        </li>
    );
}
export function ImportFilesPanel({ jobId }: { jobId: string }) {
    const actions = useImportFiles(jobId),
        { page, busy } = actions;
    return (
        <section className="space-y-3 rounded-xl border bg-background p-4">
            <h2 className="font-semibold">3. 과거 상담 첨부파일 원본</h2>
            <p className="text-sm text-muted-foreground">
                상담 정보 저장 후 파일을 따로 가져옵니다. 완료한 파일은 과거
                상담에서 미리보기·다운로드할 수 있습니다. 화면에서는 파일당 20MB까지이며,
                원본 주소가 만료되면 주소를 갱신하거나 같은 이름의 보관 파일로
                보충하세요. 더 큰 이전 첨부는 관리자의 비공개 파일 저장소 이전을 사용합니다.
            </p>
            <div className="flex flex-wrap gap-2">
                <button
                    className={button}
                    disabled={busy}
                    onClick={() => void actions.prepare()}
                >
                    기존 이전 작업의 첨부 목록 준비
                </button>
                <button
                    className={button}
                    disabled={
                        busy ||
                        !page.data?.counts.some(
                            (c) => c.active && c.state === "pending" && c.count > 0,
                        )
                    }
                    onClick={() => void actions.batch()}
                >
                    대기 파일 모두 가져오기
                </button>
                <button
                    className={button}
                    disabled={busy}
                    onClick={() => void actions.refresh()}
                >
                    새로고침
                </button>
                {busy && (
                    <button className={button} onClick={actions.stop}>
                        현재 파일 후 중지
                    </button>
                )}
                <label className="flex items-center gap-2 text-xs">
                    상태
                    <select
                        aria-label="첨부 상태 필터"
                        className="rounded-lg border bg-background p-2 text-xs"
                        value={actions.state}
                        disabled={busy}
                        onChange={(e) => actions.setState(e.target.value)}
                    >
                        <option value="">전체</option>
                        {Object.entries(labels).map(([value, name]) => (
                            <option key={value} value={value}>
                                {name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <p className="text-xs text-muted-foreground">
                화면을 닫으면 추가 파일 처리를 멈춥니다. 처리 중이던 요청과 이미
                저장한 파일은 유지되며 다시 열어 계속할 수 있습니다. 주소
                갱신만으로 파일을 가져오지는 않습니다.
            </p>
            {(actions.error || page.error) && (
                <p role="alert" className="text-sm text-red-700">
                    {actions.error || page.error.message}
                </p>
            )}
            {actions.progress && (
                <p role="status" className="text-sm">
                    {actions.progress}
                </p>
            )}
            {page.data && (
                <>
                    <div className="flex flex-wrap gap-2 text-xs">
                        <span>전체 {page.data.total}개</span>
                        {page.data.counts.map((c) => (
                            <span
                                className="rounded bg-muted px-2 py-1"
                                key={`${c.state}-${c.active}`}
                            >
                                {c.active ? labels[c.state] : "이전 원본"}{" "}
                                {c.count}개
                            </span>
                        ))}
                    </div>
                    <ul className="space-y-2">
                        {page.data.rows.map((row) => (
                            <FileRow
                                key={`${row.id}-${row.version}`}
                                row={row}
                                actions={actions}
                            />
                        ))}
                    </ul>
                    {!!page.data.total &&
                        !page.data.rows.length &&
                        actions.state && (
                            <p className="text-sm">
                                선택한 상태의 파일이 없습니다.
                            </p>
                        )}
                    {!page.data.total && (
                        <p className="text-sm">
                            이전한 상담에 등록된 첨부가 없습니다. 이전 버전에서
                            가져온 작업은 ‘첨부 목록 준비’를 눌러 확인하세요.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button
                            className={button}
                            disabled={busy || !actions.offset}
                            onClick={() =>
                                actions.setOffset(
                                    Math.max(0, actions.offset - 100),
                                )
                            }
                        >
                            이전 100개
                        </button>
                        <button
                            className={button}
                            disabled={busy || !page.data.hasMore}
                            onClick={() =>
                                actions.setOffset(actions.offset + 100)
                            }
                        >
                            다음 100개
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}
