"use client";
import { useState } from "react";
import { toast } from "sonner";
import { retryIncomingFile } from "../api";
export type IncomingEmailFile = {
    id?: string;
    name: string;
    state?: string;
    errorCode?: string | null;
};
export function IncomingEmailFiles({
    files,
    refresh,
    canRetry = false,
}: {
    files: IncomingEmailFile[];
    refresh: () => Promise<unknown>;
    canRetry?: boolean;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    async function retry(id: string) {
        setBusy(id);
        try {
            await retryIncomingFile(id);
            await refresh();
        } catch (error) {
            toast.error((error as Error).message);
        } finally {
            setBusy(null);
        }
    }
    return (
        <div className="space-y-1 text-xs">
            {files
                .filter((f) => f.state !== "available")
                .map((file, i) => (
                    <p
                        key={file.id ?? i}
                        className={
                            file.state === "failed" || file.state === "blocked"
                                ? "text-amber-800"
                                : "text-muted-foreground"
                        }
                    >
                        {file.name} ·{" "}
                        {file.state === "blocked"
                            ? "파일 제한(20MB/빈 파일) · 원본 메일함에서 확인해주세요."
                            : file.state === "failed"
                              ? file.errorCode === "source_missing"
                                  ? "원본 파일을 찾지 못했습니다."
                                  : file.errorCode === "size_mismatch"
                                    ? "원본 크기가 달라 가져오지 않았습니다."
                                    : "파일을 가져오지 못했습니다."
                              : "파일 가져오기 대기"}
                        {canRetry && file.state === "failed" && file.id && (
                            <button
                                disabled={!!busy}
                                className="ml-2 underline disabled:opacity-50"
                                onClick={() => void retry(file.id!)}
                            >
                                가져오기 재요청
                            </button>
                        )}
                    </p>
                ))}
        </div>
    );
}
