import { useRef, useState } from "react";
import { importWrite } from "../api";
import type { ImportJob } from "../types";
export function useImportRun(
    onJob: (job: ImportJob) => void,
    onError: (error: Error) => void,
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
                current = await importWrite<ImportJob>(
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
                    "POST",
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
                current = await importWrite<ImportJob>(
                    `/api/customer-imports/${current.id}`,
                    { action: "step", cursor: current.cursor },
                    "POST",
                );
                onJob(current);
            }
        } catch (error) {
            onError(error as Error);
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
