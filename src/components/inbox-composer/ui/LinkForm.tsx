"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** 주소에 http·https·mailto가 없으면 https://를 붙인다. 쓸 수 없는 주소면 null */
export function normalizeHref(raw: string) {
    const v = raw.trim();
    if (!v || /\s/.test(v)) return null;
    if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
    return `https://${v}`;
}

/** 링크 넣기 창 — 링크 주소와 보여지는 텍스트 */
export function LinkForm({
    initial,
    onSubmit,
    onCancel,
}: {
    initial: { href: string; text: string };
    onSubmit: (value: { href: string; text: string }) => void;
    onCancel: () => void;
}) {
    const [href, setHref] = useState(initial.href);
    const [text, setText] = useState(initial.text);
    const url = normalizeHref(href);
    const submit = () => {
        if (url && text.trim()) onSubmit({ href: url, text });
    };
    return (
        <div
            className="w-80 space-y-3 rounded-lg border border-border/70 bg-background p-4"
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    onCancel();
                }
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                }
            }}
        >
            <label className="block space-y-1.5">
                <span className="text-sm font-semibold">링크</span>
                <Input autoFocus className="border-border/70" placeholder="입력하세요" value={href} onChange={(e) => setHref(e.target.value)} />
            </label>
            <label className="block space-y-1.5">
                <span className="text-sm font-semibold">보여지는 텍스트</span>
                <Input className="border-border/70" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onCancel}>
                    취소
                </Button>
                <Button type="button" disabled={!url || !text.trim()} onClick={submit}>
                    확인
                </Button>
            </div>
        </div>
    );
}
