"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { INLINE_TRIGGER } from "./inline-styles";

// 마지막 저장을 Ctrl+Z(⌘Z)로 되돌리기 — 입력 중이 아닐 때, 저장 후 8초 안에만
let lastUndo: (() => void) | null = null;
let lastUndoAt = 0;
if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => {
        const target = e.target as HTMLElement | null;
        const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (typing || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
        if (!lastUndo || Date.now() - lastUndoAt > 8000) return;
        e.preventDefault();
        const undo = lastUndo;
        lastUndo = null;
        undo();
        toast.success("되돌렸어요");
    });
}

/** 눌러서 바로 고치는 칸 — Enter·바깥 누르면 저장, Esc 취소, 저장 후 되돌리기(버튼·Ctrl+Z) */
export function InlineEdit({
    value,
    onSave,
    placeholder = "비어있음",
    multiline,
    className,
    triggerClassName,
}: {
    value: string;
    onSave: (v: string) => void | Promise<void>;
    placeholder?: string;
    multiline?: boolean;
    className?: string;
    /** 고치기 전 글자 모양에만 (예: 글자 너비만큼만 누를 수 있게) */
    triggerClassName?: string;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
    useEffect(() => {
        if (editing) ref.current?.focus();
    }, [editing]);

    const commit = async () => {
        setEditing(false);
        const before = value;
        const next = draft.trim();
        if (next === before.trim()) return;
        await onSave(next);
        // 실수로 지우거나 잘못 고쳤을 때 바로 되돌릴 수 있게 (Ctrl+Z / ⌘Z 또는 버튼)
        const undo = () => onSave(before);
        toast.success(next ? "저장했어요" : "내용을 지웠어요", {
            action: { label: "되돌리기", onClick: undo },
            duration: 8000,
        });
        lastUndo = undo;
        lastUndoAt = Date.now();
    };

    if (!editing) {
        return (
            <button
                type="button"
                onClick={() => {
                    setDraft(value);
                    setEditing(true);
                }}
                className={cn(INLINE_TRIGGER, !value && "text-muted-foreground", multiline && "items-start whitespace-pre-wrap", className, triggerClassName)}
            >
                {value || placeholder}
            </button>
        );
    }
    const common = {
        value: draft,
        onBlur: commit,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (!multiline || e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commit();
            }
        },
        className: cn(
            "w-full rounded-md border border-border/70 bg-background px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
        ),
    };
    return multiline ? (
        <textarea ref={ref} rows={2} {...common} onChange={(e) => setDraft(e.target.value)} />
    ) : (
        <input ref={ref} {...common} onChange={(e) => setDraft(e.target.value)} />
    );
}
