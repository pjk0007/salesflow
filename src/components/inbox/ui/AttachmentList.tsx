"use client";
import { useEffect, useState } from "react";
import { Download, ImageIcon } from "lucide-react";
import type { ChatAttachment } from "../types";
import { messengerApiUrl } from "@/components/customer-messenger/api-origin";
function Attachment({
    file,
    url,
    headers,
}: {
    file: ChatAttachment;
    url: string;
    headers?: Record<string, string>;
}) {
    const [preview, setPreview] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    useEffect(
        () => () => {
            if (preview) URL.revokeObjectURL(preview);
        },
        [preview],
    );
    async function load(show: boolean) {
        setBusy(true);
        setError("");
        try {
            const target = messengerApiUrl(url);
            const response = await fetch(target, { headers, cache: "no-store", ...(target !== url ? { credentials: "omit", redirect: "error" } : {}) });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error ?? "파일을 불러오지 못했습니다.");
            }
            const blob = await response.blob(),
                objectUrl = URL.createObjectURL(blob);
            if (show) setPreview(objectUrl);
            else {
                const a = document.createElement("a");
                a.href = objectUrl;
                a.download = file.fileName;
                a.click();
                setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <li className="overflow-hidden rounded-xl border bg-white p-2 text-xs text-gray-800">
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-all">
                    {file.fileName}
                    <small className="block text-gray-500">
                        {Math.max(1, Math.ceil(file.size / 1024))}KB
                        {file.importMetadata?.previousSource &&
                            " · 이전 원본 파일"}
                    </small>
                </span>
                {/^image\/(png|jpeg|gif|webp)$/.test(file.contentType) && (
                    <button
                        type="button"
                        disabled={busy}
                        aria-label={`${file.fileName} 미리보기`}
                        onClick={() =>
                            preview ? setPreview("") : void load(true)
                        }
                    >
                        <ImageIcon size={15} />
                    </button>
                )}
                <button
                    type="button"
                    disabled={busy}
                    aria-label={`${file.fileName} 다운로드`}
                    onClick={() => void load(false)}
                >
                    <Download size={15} />
                </button>
            </div>
            {busy && <p>불러오는 중…</p>}
            {error && (
                <p role="alert" className="mt-1 text-red-600">
                    {error}
                </p>
            )}
            {/* Protected blob URL, never a public asset URL. */}
            {preview && (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated blob preview cannot use a public optimizer URL
                <img
                    src={preview}
                    alt={file.fileName}
                    className="mt-2 max-h-64 max-w-full rounded-lg object-contain"
                />
            )}
        </li>
    );
}
export function AttachmentList({
    files = [],
    url,
    headers,
}: {
    files?: ChatAttachment[];
    url: (id: string) => string;
    headers?: Record<string, string>;
}) {
    return files.length ? (
        <ul className="mt-2 space-y-2">
            {files.map((file) => (
                <Attachment
                    key={file.id}
                    file={file}
                    url={url(file.id)}
                    headers={headers}
                />
            ))}
        </ul>
    ) : null;
}
