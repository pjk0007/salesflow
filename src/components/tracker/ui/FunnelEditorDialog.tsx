"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { FunnelStageEditor } from "./FunnelStageEditor";
import { createFunnel, updateFunnel } from "../hooks/useTrackerFunnels";
import { useFunnelOptions } from "../hooks/useFunnelOptions";
import type { FunnelDefinition, FunnelStage } from "../types/funnel";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    siteId: number;
    funnel: FunnelDefinition | null;     // null이면 신규 모드
    onSaved: () => void;
}

function emptyStage(): FunnelStage {
    return { key: "", label: "", match: { type: "record_event", eventType: "" } };
}

export function FunnelEditorDialog({ open, onOpenChange, siteId, funnel, onSaved }: Props) {
    const [name, setName] = useState(funnel?.name ?? "");
    const [stages, setStages] = useState<FunnelStage[]>(funnel?.stages ?? [emptyStage()]);
    const [isDefault, setIsDefault] = useState(Boolean(funnel?.isDefault));
    const [saving, setSaving] = useState(false);
    const { options } = useFunnelOptions(open ? siteId : null);

    // funnel prop 바뀌면 동기화 (편집 → 다른 퍼널 편집)
    const funnelKey = funnel?.id ?? null;
    if (typeof window !== "undefined") {
        // simple state sync via useState init은 안 됨 — open 변경 시점 콜백 활용
    }

    const handleStageChange = (i: number, next: FunnelStage) => {
        const arr = [...stages];
        arr[i] = next;
        setStages(arr);
    };
    const moveStage = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= stages.length) return;
        const arr = [...stages];
        [arr[i], arr[j]] = [arr[j], arr[i]];
        setStages(arr);
    };
    const removeStage = (i: number) => setStages(stages.filter((_, idx) => idx !== i));
    const addStage = () => setStages([...stages, emptyStage()]);

    const handleSave = async () => {
        const cleaned = stages.filter((s) => s.label.trim() !== "");
        if (cleaned.length === 0) {
            toast.error("최소 1개 단계가 필요합니다.");
            return;
        }
        // key 자동 부여(빈 경우 label 기반 + 충돌 시 인덱스)
        const usedKeys = new Set<string>();
        for (let i = 0; i < cleaned.length; i++) {
            let k = cleaned[i].key || slugify(cleaned[i].label) || `stage-${i + 1}`;
            let suffix = 1;
            while (usedKeys.has(k)) {
                k = `${k}-${++suffix}`;
            }
            usedKeys.add(k);
            cleaned[i] = { ...cleaned[i], key: k };
        }

        setSaving(true);
        try {
            if (funnel) {
                await updateFunnel(funnel.id, { name, stages: cleaned, isDefault });
            } else {
                await createFunnel({ siteId, name, stages: cleaned, isDefault });
            }
            toast.success("저장되었습니다.");
            onSaved();
            onOpenChange(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "저장 실패");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange} key={funnelKey}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{funnel ? "퍼널 편집" : "신규 퍼널"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">이름</label>
                        <Input
                            placeholder="퍼널 이름 (예: 가입 깔때기)"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm">
                        <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} />
                        메인 퍼널로 설정 (개요 탭에 표시)
                    </label>
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">단계 (방문/리드는 자동 포함됨)</p>
                        <div className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
                            1. 방문 (자동) · 2. 리드 (자동)
                        </div>
                        <div className="rounded-md border border-blue-200 bg-blue-50 p-2.5 text-[11px] leading-relaxed text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                            <p className="mb-1 font-medium">단계는 3가지 방식으로 정의할 수 있어요:</p>
                            <ul className="space-y-0.5 pl-3">
                                <li>• <span className="font-medium">행동 이벤트</span>: "회원가입 했을 때", "구독중으로 바뀌었을 때" — 시점 추적 (권장)</li>
                                <li>• <span className="font-medium">현재 상태</span>: "지금 구독중인 고객" — 시점은 모르고 현재 값만</li>
                                <li>• <span className="font-medium">페이지 방문</span>: "/pricing 본 적 있는 사용자"</li>
                            </ul>
                        </div>
                        {stages.map((s, i) => (
                            <FunnelStageEditor
                                key={i}
                                index={i}
                                stage={s}
                                options={options}
                                onChange={(next) => handleStageChange(i, next)}
                                onMoveUp={i > 0 ? () => moveStage(i, -1) : undefined}
                                onMoveDown={i < stages.length - 1 ? () => moveStage(i, 1) : undefined}
                                onRemove={() => removeStage(i)}
                            />
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={addStage} className="w-full">
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            단계 추가
                        </Button>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
                    <Button onClick={handleSave} disabled={saving || !name.trim()}>
                        {saving ? "저장 중..." : "저장"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function slugify(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}
