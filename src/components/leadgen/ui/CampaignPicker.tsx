"use client";

import { ChevronDown, GitCompareArrows, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CampaignOption } from "../hooks/useCampaignOptions";
import { MAX_GROUPS, type LeadgenFilters } from "../hooks/useLeadgenFilters";
import { GROUPS, groupName } from "../utils/groups";

/** 메일 여러 개 고르기 — 비교 묶음(A·B·C)이면 색 점·글자, 아니면 비었을 때 "전체 메일" */
function GroupPicker({
    index,
    keys,
    options,
    taken = new Set(),
    onChange,
    onRemove,
}: {
    /** 비교 묶음 자리 (없으면 그냥 메일 고르기) */
    index?: number;
    keys: string[];
    options: CampaignOption[];
    /** 다른 묶음이 이미 고른 메일 */
    taken?: Set<string>;
    onChange: (keys: string[]) => void;
    onRemove?: () => void;
}) {
    const g = index === undefined ? null : GROUPS[index];
    const nameOf = (k: string) => options.find((o) => o.key === k)?.label ?? null;
    const toggle = (key: string) => onChange(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
    return (
        <div className="flex items-center">
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            "flex h-9 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-left text-sm",
                            g ? "w-60" : "w-72",
                        )}
                    >
                        {g && (
                            <>
                                <span className="size-2 shrink-0 rounded-full" style={{ background: g.color }} />
                                <span className="shrink-0 text-xs font-semibold text-muted-foreground">{g.letter}</span>
                            </>
                        )}
                        <span className={cn("min-w-0 flex-1 truncate", keys.length === 0 && g && "text-muted-foreground")}>
                            {keys.length ? groupName(keys, nameOf) : g ? "메일 고르기" : "전체 메일"}
                        </span>
                        <ChevronDown className="size-4 shrink-0 opacity-50" />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] p-1">
                    {!g && (
                        <button
                            type="button"
                            onClick={() => onChange([])}
                            disabled={keys.length === 0}
                            className="mb-1 flex w-full items-center rounded-sm border-b border-border/40 px-2 py-1.5 text-left text-sm hover:bg-accent disabled:text-muted-foreground disabled:hover:bg-transparent"
                        >
                            전체 메일
                            {keys.length > 0 && <span className="ml-auto text-xs text-muted-foreground">선택 해제</span>}
                        </button>
                    )}
                    <div className="max-h-80 overflow-y-auto scrollbar-thin">
                        {options.map((o) => {
                            const used = taken.has(o.key);
                            return (
                                <label
                                    key={o.key}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                                        used && "cursor-not-allowed opacity-40 hover:bg-transparent",
                                    )}
                                >
                                    <Checkbox checked={keys.includes(o.key)} disabled={used} onCheckedChange={() => toggle(o.key)} />
                                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{o.sent.toLocaleString("ko-KR")}통</span>
                                </label>
                            );
                        })}
                    </div>
                </PopoverContent>
            </Popover>
            {onRemove && (
                <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`${g?.letter ?? ""} 묶음 빼기`} className="text-muted-foreground">
                    <X className="size-4" />
                </Button>
            )}
        </div>
    );
}

/** 리드젠통계 메일 고르기 — 전체·메일 여러 개(합쳐서), 또는 [비교]로 메일 묶음 2~3개 (묶음마다 메일 여러 개) */
export function CampaignPicker({ f, options }: { f: LeadgenFilters; options: CampaignOption[] }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {f.compare ? (
                <>
                    {f.compare.map((keys, i) => (
                        <GroupPicker
                            key={i}
                            index={i}
                            keys={keys}
                            options={options}
                            taken={new Set(f.compare!.filter((_, j) => j !== i).flat())}
                            onChange={(k) => f.setGroup(i, k)}
                            onRemove={f.compare!.length > 2 ? () => f.removeGroup(i) : undefined}
                        />
                    ))}
                    {f.compare.length < MAX_GROUPS && (
                        <Button variant="ghost" size="sm" onClick={f.addGroup} className="text-muted-foreground">
                            <Plus className="mr-1 h-4 w-4" />
                            묶음 추가
                        </Button>
                    )}
                </>
            ) : (
                <GroupPicker keys={f.campaign} options={options} onChange={f.setCampaign} />
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={f.toggleCompare}
                disabled={!f.compare && options.length < 2}
                className={cn(f.compare && "border-primary/40 text-primary")}
            >
                <GitCompareArrows className="mr-1 h-4 w-4" />
                {f.compare ? "비교 끄기" : "메일 비교"}
            </Button>
        </div>
    );
}
