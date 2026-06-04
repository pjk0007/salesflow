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
    return { key: "", label: "", match: { type: "record_field", field: "", value: "" } };
}

/**
 * 다이얼로그 본체 — open=true 마운트 시점에 funnel prop으로 초기화.
 * 외부에서 open/close + funnel 변경 시마다 새 인스턴스가 마운트되도록
 * 부모(FunnelEditorDialog)에서 key를 부여한다.
 */
function FunnelEditorBody({ onOpenChange, siteId, funnel, onSaved }: Omit<Props, "open">) {
    const [name, setName] = useState(funnel?.name ?? "");
    const [stages, setStages] = useState<FunnelStage[]>(funnel?.stages ?? [emptyStage()]);
    const [isDefault, setIsDefault] = useState(Boolean(funnel?.isDefault));
    const [saving, setSaving] = useState(false);
    const { options } = useFunnelOptions(siteId);

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
        <DialogContent className="sm:max-w-2xl flex max-h-[85vh] flex-col gap-0 p-0">
            <DialogHeader className="border-b p-6 pb-4">
                <DialogTitle>{funnel ? "퍼널 편집" : "신규 퍼널"}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
                <div className="space-y-4 p-6">
                    <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">이름</label>
                        <Input
                            placeholder="퍼널 이름 (예: 구독 전환 흐름)"
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
                                <li>• <span className="font-medium">필드 값</span>: 예) 매치 단계가 &quot;신청완료&quot;였던 적이 있는 사람 (변경 이력 기준)</li>
                                <li>• <span className="font-medium">페이지 방문</span>: 예) /pricing 같은 특정 경로를 본 적 있는 사람</li>
                                <li>• <span className="font-medium">이벤트 발생</span>: 예) &apos;subscribe_step_2&apos; 같은 CUSTOM 이벤트를 발생시킨 사람 (이름을 직접 정의하고 사이트에 심으세요)</li>
                            </ul>
                            <p className="mt-1.5">상위 단계 도달자는 자동으로 하위 단계도 통과한 걸로 카운트됩니다 (전환된 후 종료된 사람도 전환에 잡힙니다).</p>
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
            </div>
            <DialogFooter className="border-t p-6 pt-4">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
                <Button onClick={handleSave} disabled={saving || !name.trim()}>
                    {saving ? "저장 중..." : "저장"}
                </Button>
            </DialogFooter>
        </DialogContent>
    );
}

/**
 * 외부 노출 wrapper — Dialog 자체를 들고, 매 open 시점에 Body를 새로 마운트해서
 * funnel prop 변경(편집 → 신규 등)이 useState 초기값에 반영되도록 보장.
 */
export function FunnelEditorDialog({ open, onOpenChange, siteId, funnel, onSaved }: Props) {
    // open 마다 또는 funnel 변경 시 Body 리마운트.
    // 닫은 상태(open=false)일 땐 Body 자체를 안 그려서 stale state 누적도 방지.
    const bodyKey = open ? `${funnel?.id ?? "new"}` : "closed";
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {open && (
                <FunnelEditorBody
                    key={bodyKey}
                    onOpenChange={onOpenChange}
                    siteId={siteId}
                    funnel={funnel}
                    onSaved={onSaved}
                />
            )}
        </Dialog>
    );
}

function slugify(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}
