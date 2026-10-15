"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fileRequest, fileWrite, supplementFile } from "../api";
import type { ImportFile, ImportFilePage } from "../types";
export function useImportFiles(jobId: string) {
    const [offset, setOffset] = useState(0),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [progress, setProgress] = useState(""),
        stopped = useRef(false),
        alive = useRef(true),
        running = useRef(false),
        url = `/api/customer-imports/${jobId}/files`,
        page = useSWR<ImportFilePage>(`${url}?offset=${offset}`, fileRequest, {
            refreshInterval: busy ? 0 : 5000,
        });
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
            if (alive.current) setError((e as Error).message);
            return false;
        } finally {
            running.current = false;
            if (alive.current) {
                setBusy(false);
                await page.mutate();
            }
        }
    }
    const fetchOne = (row: ImportFile) =>
        fileWrite(url, { action: "fetch", id: row.id, version: row.version });
    return {
        page,
        offset,
        setOffset,
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
            }),
        batch: () =>
            run(async () => {
                const rows =
                    page.data?.rows.filter(
                        (r) => r.active && r.state === "pending",
                    ) ?? [];
                let done = 0,
                    failed = 0;
                for (const row of rows) {
                    if (stopped.current) break;
                    try {
                        await fetchOne(row);
                    } catch {
                        failed++;
                    }
                    done++;
                    if (alive.current && !stopped.current)
                        setProgress(
                            `현재 페이지 ${done}/${rows.length}개 처리 · 확인 필요 ${failed}개`,
                        );
                }
            }),
    };
}
