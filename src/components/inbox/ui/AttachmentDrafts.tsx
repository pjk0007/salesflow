"use client";
import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import type { FileDraft } from "../hooks/useAttachmentDrafts";
export function AttachmentDrafts({
    files,
    busy,
    progress,
    onSelect,
    onRemove,
    onError,
}: {
    files: FileDraft[];
    busy: boolean;
    progress: string;
    onSelect: (files: FileList | null) => void;
    onRemove: (id: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <div className="space-y-2 text-xs">
            <input
                ref={input}
                type="file"
                multiple
                aria-label="첨부 파일 선택"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                    try {
                        onSelect(e.target.files);
                    } catch (error) {
                        onError((error as Error).message);
                    }
                    e.target.value = "";
                }}
            />
            <button
                type="button"
                disabled={busy || files.length >= 5}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                onClick={() => input.current?.click()}
            >
                <Paperclip size={14} />
                파일 첨부 · 최대 5개, 각 20MB
            </button>
            {!!files.length && (
                <ul className="space-y-1">
                    {files.map((f) => (
                        <li
                            key={f.clientId}
                            className="flex items-center gap-2 rounded-lg border bg-white p-2 text-gray-700"
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {f.file.name} ·{" "}
                                {Math.max(1, Math.ceil(f.file.size / 1024))}KB
                                {f.uploaded ? " · 업로드 완료" : ""}
                            </span>
                            <button
                                type="button"
                                disabled={busy}
                                aria-label={`${f.file.name} 첨부 삭제`}
                                onClick={() =>
                                    void onRemove(f.clientId).catch((e) =>
                                        onError(e.message),
                                    )
                                }
                            >
                                <X size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {files.length > 0 && (
                <p className="text-[10px] text-gray-500">
                    선택한 파일은 이 창에서만 유지됩니다. {progress}
                </p>
            )}
        </div>
    );
}
