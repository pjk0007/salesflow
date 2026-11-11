"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** 상대 특성 메모 — 히스토리가 아니라 한 칸짜리 메모, 누구나 고쳐 저장 */
export function ProfileMemo({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> | void }) {
    const [draft, setDraft] = useState(value);
    const [saving, setSaving] = useState(false);
    const dirty = draft !== value;
    const save = async () => {
        setSaving(true);
        try {
            await onSave(draft);
        } finally {
            setSaving(false);
        }
    };
    return (
        <section className="space-y-2">
            {/* 줄 높이를 고정해 버튼이 나타나도 아래 칸이 밀리지 않게 */}
            <div className="flex h-6 items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">메모</h3>
                {dirty && (
                    <div className="flex gap-1">
                        <Button size="xs" variant="ghost" disabled={saving} onClick={() => setDraft(value)}>
                            취소
                        </Button>
                        <Button size="xs" disabled={saving} onClick={save}>
                            저장
                        </Button>
                    </div>
                )}
            </div>
            <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // Enter 저장, Shift+Enter 줄바꿈 (한글 조합 중 Enter는 무시)
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (dirty && !saving) save();
                    }
                }}
                rows={4}
                placeholder="이 분·회사에 대해 기억할 것 (성향, 관심사, 의사결정 구조, 주의할 점 등)"
            />
        </section>
    );
}
