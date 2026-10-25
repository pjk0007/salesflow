/* eslint-disable @next/next/no-img-element -- Locally generated PNG previews must not be sent to an image optimizer. */
"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EsignField } from "@/lib/esign/types";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { clamp, fieldLabels, roleColors } from "../utils/presentation";

type Props = {
    url: string; headers?: Record<string, string>; fields?: EsignField[]; values?: Record<string, string>;
    pageIndex: number; onPageChange: (page: number) => void; selectedFieldId?: string;
    onFieldClick?: (field: EsignField) => void; onPlace?: (page: number, x: number, y: number) => void;
    onMove?: (field: EsignField) => void;
};

/** PDF.js is fetched only when a document preview is mounted. One page is rasterized at a time. */
export function PdfViewer({ url, headers, fields = [], values = {}, pageIndex, onPageChange, selectedFieldId, onFieldClick, onPlace, onMove }: Props) {
    const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
    // 문서 불러오기 실패와 한 페이지 표시 실패를 나눈다. 페이지 실패는 다른 페이지 이동·다시 시도로 회복하며 부모(인증·입력) 상태를 건드리지 않는다.
    const [loadError, setLoadError] = useState("");
    const [pageError, setPageError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [renderAttempt, setRenderAttempt] = useState(0);
    const [rendering, setRendering] = useState(true);
    const [zoom, setZoom] = useState(1);
    const [width, setWidth] = useState(700);
    const [dimensions, setDimensions] = useState({ width: 700, height: 990 });
    const hostRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ field: EsignField; pointerX: number; pointerY: number; width: number; height: number } | null>(null);
    const headerKey = JSON.stringify(headers ?? {});

    useEffect(() => {
        let disposed = false;
        let loading: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
        setLoadError(""); setPageError(""); setPdf(null); setRendering(true);
        void import("pdfjs-dist").then(async (renderer) => {
            renderer.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
            const assets = `/api/esign/assets/${renderer.version}`;
            loading = renderer.getDocument({ url, httpHeaders: JSON.parse(headerKey), withCredentials: true, cMapUrl: `${assets}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}/standard_fonts/`, wasmUrl: `${assets}/wasm/` });
            const document = await loading.promise;
            if (disposed) return;
            setPdf(document);
        }).catch(() => { if (!disposed) { setLoadError("문서를 미리 볼 수 없습니다. 접근 권한이나 PDF 상태를 확인해 주세요."); setRendering(false); } });
        return () => { disposed = true; void loading?.destroy(); };
    }, [url, headerKey, loadAttempt]);

    useEffect(() => {
        const element = hostRef.current; if (!element) return;
        const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width - 24)));
        observer.observe(element); return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!pdf || !canvasRef.current) return;
        let disposed = false;
        let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
        setRendering(true); setPageError("");
        void pdf.getPage(clamp(pageIndex + 1, 1, pdf.numPages)).then(async (page) => {
            if (disposed || !canvasRef.current) return;
            const natural = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(width, 900) / natural.width * zoom });
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            const canvas = canvasRef.current, context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
            canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
            setDimensions({ width: viewport.width, height: viewport.height });
            task = page.render({ canvas, canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
            await task.promise; if (!disposed) setRendering(false);
        }).catch((cause) => { if (!disposed && cause?.name !== "RenderingCancelledException") { setPageError("이 페이지를 표시하지 못했습니다."); setRendering(false); } });
        return () => { disposed = true; task?.cancel(); };
    }, [pdf, pageIndex, width, zoom, renderAttempt]);

    return <section className="overflow-hidden rounded-xl border bg-slate-100" aria-label="PDF 문서 미리보기">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white p-2">
            <div className="flex items-center gap-2">
                <Button type="button" size="icon-sm" variant="ghost" aria-label="이전 페이지" disabled={pageIndex === 0 || !pdf} onClick={() => onPageChange(pageIndex - 1)}><ChevronLeft /></Button>
                <span className="text-sm tabular-nums">{pdf ? `${pageIndex + 1} / ${pdf.numPages} 페이지` : "문서 불러오는 중"}</span>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="다음 페이지" disabled={!pdf || pageIndex >= pdf.numPages - 1} onClick={() => onPageChange(pageIndex + 1)}><ChevronRight /></Button>
            </div>
            <div className="flex items-center gap-1">
                <Button type="button" size="icon-sm" variant="ghost" aria-label="축소" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}><ZoomOut /></Button>
                <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="확대" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}><ZoomIn /></Button>
            </div>
        </div>
        <div ref={hostRef} className="relative max-h-[72vh] min-h-64 overflow-auto p-3">
            {loadError ? <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-white p-6 text-sm text-red-700"><p>{loadError}</p><Button type="button" size="sm" variant="outline" onClick={() => setLoadAttempt(value => value + 1)}><RefreshCw />문서 다시 불러오기</Button></div> : <div ref={pageRef} className={`relative mx-auto bg-white shadow ${onPlace ? "cursor-crosshair" : ""}`} style={{ width: dimensions.width, height: dimensions.height }} onClick={event => {
                if (!onPlace || !pdf || rendering || pageError) return;
                const bounds = event.currentTarget.getBoundingClientRect(); onPlace(pageIndex, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
            }}>
                <canvas ref={canvasRef} className="block" style={{ width: dimensions.width, height: dimensions.height }} aria-label={`문서 ${pageIndex + 1}페이지`} />
                {fields.filter(field => field.pageIndex === pageIndex).map(field => <button key={field.id} type="button" aria-label={`${field.recipientIndex + 1}번 서명자 ${field.label || fieldLabels[field.type]}${values[field.id] ? ", 입력 완료" : ""}`} aria-pressed={selectedFieldId === field.id} className={`absolute flex items-center justify-center overflow-hidden border-2 text-xs font-medium ${selectedFieldId === field.id ? "ring-2 ring-offset-1" : ""} ${onMove ? "touch-none cursor-move" : ""}`} style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%`, borderColor: roleColors[field.recipientIndex], color: roleColors[field.recipientIndex], backgroundColor: values[field.id] ? "transparent" : `${roleColors[field.recipientIndex]}15` }} onClick={event => { event.stopPropagation(); onFieldClick?.(field); }} onPointerDown={event => {
                    if (!onMove || !pageRef.current) return; event.stopPropagation();
                    const bounds = pageRef.current.getBoundingClientRect(); dragRef.current = { field, pointerX: event.clientX, pointerY: event.clientY, width: bounds.width, height: bounds.height }; event.currentTarget.setPointerCapture(event.pointerId); onFieldClick?.(field);
                }} onPointerMove={event => {
                    const drag = dragRef.current; if (!drag || !onMove) return;
                    onMove({ ...drag.field, x: clamp(drag.field.x + (event.clientX - drag.pointerX) / drag.width, 0, 1 - field.width), y: clamp(drag.field.y + (event.clientY - drag.pointerY) / drag.height, 0, 1 - field.height) });
                }} onPointerUp={event => { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragRef.current = null; }} onKeyDown={event => {
                    if (!onMove || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                    event.preventDefault(); const step = event.shiftKey ? .02 : .005;
                    onMove({ ...field, x: clamp(field.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), 0, 1 - field.width), y: clamp(field.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0), 0, 1 - field.height) });
                }}>
                    {/* A local PNG is generated or validated before it is supplied here. */}
                    {values[field.id] ?  <img src={values[field.id]} alt="입력 미리보기" className="h-full w-full object-contain" draggable={false} /> : <span className="px-1">{field.label || fieldLabels[field.type]}{field.required && " *"}</span>}
                </button>)}
                {rendering && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="size-6 animate-spin" aria-label="문서 표시 중" /></div>}
                {pageError && <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/95 p-6 text-center text-sm text-red-700" onClick={event => event.stopPropagation()}><p>{pageError} 다른 페이지로 이동하거나 다시 시도해 주세요. 입력한 내용은 그대로 있습니다.</p><Button type="button" size="sm" variant="outline" onClick={() => setRenderAttempt(value => value + 1)}><RefreshCw />이 페이지 다시 표시</Button></div>}
            </div>}
        </div>
    </section>;
}
