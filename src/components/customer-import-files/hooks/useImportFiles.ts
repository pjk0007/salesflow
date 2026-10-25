"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fileRequest, fileWrite, supplementFile } from "../api";
import type { ImportFile, ImportFilePage } from "../types";
import { drainPendingFiles } from "../utils/drain";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import {
    importErrorMessage,
    importLongWrite,
} from "@/components/customer-imports/api";
const fetchable = (r: ImportFile) =>
    r.active &&
    r.state === "pending" &&
    r.metadataValid &&
    (r.expectedSize === null || r.expectedSize <= MAX_FILE_BYTES);
export function useImportFiles(jobId: string) {
    const [offset, setOffset] = useState(0),
        [state, setStateFilter] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [progress, setProgress] = useState(""),
        stopped = useRef(false),
        alive = useRef(true),
        running = useRef(false),
        url = `/api/customer-imports/${jobId}/files`,
        page = useSWR<ImportFilePage>(
            `${url}?offset=${offset}${state ? `&state=${state}` : ""}`,
            fileRequest,
            {
                refreshInterval: busy ? 0 : 5000,
            },
        );
    useEffect(() => {
        alive.current = true;
        stopped.current = false;
        return () => {
            alive.current = false;
            stopped.current = true;
        };
    }, []);
    async function run(action: () => Promise<unknown>) {
        if (running.current) return;
        running.current = true;
        stopped.current = false;
        setBusy(true);
        setError("");
        try {
            await action();
            return true;
        } catch (e) {
            if (alive.current)
                setError(
                    importErrorMessage(
                        e,
                        "파일 처리 결과 확인이 지연되고 있습니다. 서버에서 처리됐을 수 있으니 새로고침해 상태를 확인한 뒤 다시 시도해주세요.",
                    ),
                );
            return false;
        } finally {
            running.current = false;
            if (alive.current) {
                setBusy(false);
                await page.mutate();
            }
        }
    }
    // 원본 서버에서 파일을 내려받아 저장하므로 상담용 15초보다 길게 기다린다(UX-089).
    const fetchOne = (row: ImportFile) =>
        importLongWrite(url, {
            action: "fetch",
            id: row.id,
            version: row.version,
        });
    return {
        page,
        offset,
        setOffset,
        state,
        setState: (value: string) => {
            setStateFilter(value);
            setOffset(0);
        },
        busy,
        error,
        progress,
        stop: () => {
            stopped.current = true;
            setProgress(
                "현재 파일 처리 후 중지합니다. 완료한 파일은 보존됩니다.",
            );
        },
        refresh: () => page.mutate(),
        fetch: (row: ImportFile) => run(() => fetchOne(row)),
        source: (row: ImportFile, value: string) =>
            run(() =>
                fileWrite(url, {
                    action: "source",
                    id: row.id,
                    version: row.version,
                    url: value,
                }),
            ),
        upload: (row: ImportFile, file: File) =>
            run(() => supplementFile(url, row, file)),
        prepare: () =>
            run(async () => {
                let at = 0,
                    skipped = 0;
                for (;;) {
                    const result = await fileWrite<{
                        nextOffset: number;
                        total: number;
                        hasMore: boolean;
                        skipped: number;
                    }>(url, { action: "prepare", offset: at });
                    skipped += result.skipped;
                    at = result.nextOffset;
                    if (alive.current && !stopped.current)
                        setProgress(
                            `첨부 목록 준비 ${at}/${result.total}행 · 최신 원본과 다른 행 ${skipped}개 제외`,
                        );
                    if (!result.hasMore || stopped.current) break;
                }
                if (alive.current && stopped.current)
                    setProgress(
                        `중지했습니다 · 첨부 목록 준비 ${at}행까지 · 최신 원본과 다른 행 ${skipped}개 제외`,
                    );
            }),
        batch: () =>
            run(async () => {
                const { done, failed } = await drainPendingFiles({
                    page: (skip) =>
                        fileRequest<ImportFilePage>(
                            `${url}?offset=${skip}&state=pending`,
                        ),
                    fetch: fetchOne,
                    eligible: fetchable,
                    stopped: () => stopped.current,
                    onProgress: (done, failed) => {
                        if (alive.current && !stopped.current)
                            setProgress(
                                `대기 파일 ${done}개 처리 · 확인 필요 ${failed}개`,
                            );
                    },
                });
                if (alive.current)
                    setProgress(
                        stopped.current
                            ? `중지했습니다 · 처리 ${done}개 · 확인 필요 ${failed}개`
                            : `대기 파일 처리를 마쳤습니다 · 처리 ${done}개 · 확인 필요 ${failed}개`,
                    );
            }),
    };
}
