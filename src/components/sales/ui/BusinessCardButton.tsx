"use client";

import { useRef, useState } from "react";
import { IdCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { scanBusinessCard } from "../api";
import type { CardFields } from "../types";

/** 명함 사진(촬영·선택) → 글자 인식 → onScanned로 리드 추가 창을 채운다 */
export function BusinessCardButton({ onScanned }: { onScanned: (fields: CardFields) => void }) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const pick = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        try {
            const result = await scanBusinessCard(file);
            if (!result.success || !result.data) {
                toast.error(result.error || "명함 글자를 읽지 못했습니다. 직접 입력해주세요.");
                onScanned({ name: null, companyName: null, title: null, email: null, phone: null, website: null, address: null });
                return;
            }
            onScanned(result.data);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <IdCard className="mr-1 h-4 w-4" />}
                {busy ? "명함 읽는 중…" : "명함 등록"}
            </Button>
            <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                    pick(e.target.files?.[0]);
                    e.target.value = "";
                }}
            />
        </>
    );
}
