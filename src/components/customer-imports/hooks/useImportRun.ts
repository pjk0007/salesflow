import { useRef, useState } from "react";
import { importErrorMessage, importLongWrite, importWrite } from "../api";
import type { ImportJob } from "../types";
// 서버는 1~250행 묶음을 지원한다. 화면 실행은 요청마다 작업 행을 다시 읽으므로 25행보다 크게 잡는다.
export const SCREEN_IMPORT_BATCH = 100;
export function useImportRun(
    onJob: (job: ImportJob) => void,
    onError: (error: Error, job: ImportJob) => void,
) {
    const [busy, setBusy] = useState(false),
        [requested, setRequested] = useState<string | null>(null),
        command = useRef<"pause" | "cancel" | null>(null);
    async function run(initial: ImportJob, action?: "start" | "resume") {
        if (busy) return;
        setBusy(true);
        command.current = null;
        setRequested(null);
        let current = initial;
        try {
            if (action) {
                current = await importLongWrite<ImportJob>(
                    `/api/customer-imports/${initial.id}`,
                    {
                        action,
                        version: initial.version,
                        ...(action === "start"
                            ? {
                                  fingerprint: initial.fingerprint,
                                  acknowledge: true,
                              }
                            : {}),
                    },
                );
                onJob(current);
            }
            while (current.state === "running") {
                const next = command.current;
                if (next) {
                    current = await importWrite<ImportJob>(
                        `/api/customer-imports/${current.id}`,
                        { action: next, version: current.version },
                        "POST",
                    );
                    onJob(current);
                    break;
                }
                current = await importLongWrite<ImportJob>(
                    `/api/customer-imports/${current.id}`,
                    {
                        action: "step",
                        cursor: current.cursor,
                        batchSize: SCREEN_IMPORT_BATCH,
                    },
                );
                onJob(current);
            }
        } catch (error) {
            onError(
                new Error(
                    importErrorMessage(
                        error,
                        "실행 결과 확인이 지연되고 있습니다. 서버에서 처리됐을 수 있으니 작업을 다시 불러와 처리 위치를 확인한 뒤 계속해주세요.",
                    ),
                ),
                current,
            );
        } finally {
            setBusy(false);
            setRequested(null);
            command.current = null;
        }
    }
    function stop(action: "pause" | "cancel") {
        command.current = action;
        setRequested(action);
    }
    return { busy, requested, run, stop };
}
