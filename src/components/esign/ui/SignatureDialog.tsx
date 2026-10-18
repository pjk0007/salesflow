/* eslint-disable @next/next/no-img-element -- Locally generated PNG previews must not be sent to an image optimizer. */
"use client";

import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { EsignField } from "@/lib/esign/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fieldLabels } from "../utils/presentation";
import { fitPng, textPng } from "../utils/raster";
import { NameMarkPicker } from "./NameMarkPicker";
import type { SigningValue } from "../api/client";

export function SignatureDialog({ field, signerName, aspect, onClose, onSave }: { field: EsignField; signerName: string; aspect: number; onClose: () => void; onSave: (value: SigningValue) => void }) {
    const textField = ["name", "date", "text"].includes(field.type);
    const [mode, setMode] = useState<"signature" | "draw" | "seal" | "upload">(field.type === "seal" ? "seal" : "signature");
    const [text, setText] = useState(field.type === "name" ? signerName : field.type === "date" ? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : "");
    const [image, setImage] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [hasInk, setHasInk] = useState(false);
    const generated = !textField && (mode === "signature" || mode === "seal");
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const strokesRef = useRef(0);
    const point = (event: PointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width * 720, y: (event.clientY - rect.top) / rect.height * 280 }; };
    const clear = () => { canvasRef.current?.getContext("2d")?.clearRect(0, 0, 720, 280); drawingRef.current = false; setHasInk(false); setImage(""); strokesRef.current = 0; };

    async function save() {
        setBusy(true); setError("");
        try {
            let pngDataUrl: string;
            if (textField) {
                if (!text.trim()) throw new Error("내용을 입력해 주세요.");
                pngDataUrl = await textPng(text.trim(), aspect);
            } else {
                let source = image;
                if (mode === "draw") { if (!hasInk || !canvasRef.current) throw new Error("손가락이나 마우스로 서명을 그려 주세요."); source = canvasRef.current.toDataURL("image/png"); }
                if (!source) throw new Error("자신의 PNG 서명이나 도장을 올려 주세요.");
                pngDataUrl = await fitPng(source, aspect);
            }
            onSave({ fieldId: field.id, ...(textField ? { text: text.trim() } : {}), pngDataUrl }); onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "입력 이미지를 만들지 못했습니다."); }
        finally { setBusy(false); }
    }

    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader><DialogTitle>{field.label || fieldLabels[field.type]} 입력</DialogTitle><DialogDescription>{signerName} 님 본인의 정보를 입력해 주세요. 최종 제출 전 문서에서 위치와 내용을 확인할 수 있습니다.</DialogDescription></DialogHeader>
            {textField ? <label className="space-y-2 text-sm"><span>{fieldLabels[field.type]}</span><Input autoFocus type={field.type === "date" ? "date" : "text"} maxLength={120} value={text} onChange={event => setText(event.target.value)} /></label> : <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="입력 방법">
                    {([ ["signature", "이름으로 서명"], ["seal", "이름 도장"], ["draw", "직접 그리기"], ["upload", "PNG 올리기"] ] as const).map(([key, label]) => <Button key={key} type="button" disabled={busy} variant={mode === key ? "default" : "outline"} aria-pressed={mode === key} onClick={() => { if (mode !== key) { clear(); setMode(key); setError(""); } }}>{label}</Button>)}
                </div>
                {generated && <NameMarkPicker key={mode} kind={mode === "seal" ? "seal" : "signature"} signerName={signerName} aspect={aspect} busy={busy} onUse={pngDataUrl => { onSave({ fieldId: field.id, pngDataUrl }); onClose(); }} />}
                {mode === "draw" && <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">아래 칸에 손가락이나 마우스로 그려 주세요.</p>
                    <canvas ref={canvasRef} width={720} height={280} className="w-full touch-none rounded-lg border-2 border-dashed bg-white" aria-label="직접 서명 그리는 영역. 그리기 어려우면 이름으로 서명 또는 PNG 올리기를 이용해 주세요." onPointerDown={event => {
                        const context = event.currentTarget.getContext("2d"); if (!context) return;
                        event.currentTarget.setPointerCapture(event.pointerId); drawingRef.current = true;
                        const location = point(event); context.strokeStyle = "#111827"; context.lineWidth = 5; context.lineCap = "round"; context.lineJoin = "round"; context.beginPath(); context.moveTo(location.x, location.y);
                    }} onPointerMove={event => {
                        if (!drawingRef.current) return; const context = event.currentTarget.getContext("2d"); if (!context) return;
                        const location = point(event); context.lineTo(location.x, location.y); context.stroke(); strokesRef.current += 1; if (strokesRef.current >= 3) setHasInk(true);
                    }} onPointerUp={event => { drawingRef.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drawingRef.current = false; }} />
                    <Button type="button" size="sm" variant="outline" onClick={clear}>지우고 다시 그리기</Button>
                </div>}
                {mode === "upload" && <label className="block space-y-2 text-sm"><span>본인의 서명·도장 PNG (최대 2MB)</span><Input type="file" accept="image/png,.png" disabled={busy} onChange={async event => {
                    const file = event.target.files?.[0]; setError(""); setImage(""); if (!file) return;
                    setBusy(true);
                    try {
                        if (file.size > 2 * 1024 * 1024) throw new Error("PNG는 2MB 이하로 올려 주세요.");
                        const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer()); if (bytes.join(",") !== "137,80,78,71,13,10,26,10") throw new Error("실제 PNG 파일만 사용할 수 있습니다.");
                        const source = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("파일을 읽지 못했습니다.")); reader.readAsDataURL(file); });
                        setImage(await fitPng(source, aspect));
                    } catch (cause) { setError(cause instanceof Error ? cause.message : "파일을 올리지 못했습니다."); }
                    finally { setBusy(false); }
                }} /></label>}
                {image && <div className="flex h-40 items-center justify-center rounded-lg border bg-white"><img src={image} alt="내 서명·도장 미리보기" className="max-h-36 max-w-full object-contain" /></div>}
            </>}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>취소</Button>{!generated && <Button type="button" disabled={busy || (!textField && (mode === "draw" ? !hasInk : !image))} onClick={() => void save()}>{busy ? "준비 중…" : "문서에 넣기"}</Button>}</div>
        </DialogContent>
    </Dialog>;
}
