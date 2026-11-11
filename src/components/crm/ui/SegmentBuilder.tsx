"use client";

import { useState } from "react";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { Search, ExternalLink, Users, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { format } from "date-fns";

function durationLabel(sec: number | null) {
    if (sec == null) return "-";
    if (sec < 60) return `${Math.round(sec)}초`;
    return `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초`;
}

const noSpinner = "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

interface SegmentResult {
    visitorId: number;
    email: string | null;
    name: string | null;
    totalVisits: number;
    totalPageviews: number;
    lastSeenAt: string | null;
    recordId: number | null;
    integratedCode: string | null;
    recordData: Record<string, unknown> | null;
    workspaceName: string;
    maxDuration: number | null;
    totalPages: number;
    sessionCount: number;
}

interface Filters {
    minDuration?: number;
    minPages?: number;
    minVisits?: number;
    pagePathContains?: string;
    pageMinDuration?: number;
    eventType?: string;
    eventNamePattern?: string;
    hasClicked?: boolean;
    stage?: string;
}

type ConditionType = "duration" | "pages" | "visits" | "path" | "click" | "stage";

interface Condition {
    id: number;
    type: ConditionType;
    value: string;
    value2: string;
    operator: "AND" | "OR";
}

const CONDITION_TYPES: { value: ConditionType; label: string }[] = [
    { value: "duration", label: "체류 시간" },
    { value: "pages", label: "페이지 수" },
    { value: "visits", label: "방문 횟수" },
    { value: "path", label: "페이지 경로" },
    { value: "click", label: "버튼 클릭" },
    { value: "stage", label: "여정 단계" },
];

const DURATION_OPTIONS = [
    { value: "30", label: "30초 이상" },
    { value: "60", label: "60초 이상" },
    { value: "120", label: "2분 이상" },
    { value: "180", label: "3분 이상" },
    { value: "300", label: "5분 이상" },
];

const CLICK_PATTERNS = [
    { label: "상담/데모", pattern: "demo|consult|contact|trial|meeting" },
    { label: "가입/신청", pattern: "signup|subscribe|manual_entry" },
    { label: "무료체험", pattern: "free-trial|trial" },
    { label: "전화/콜", pattern: "phone|call" },
    { label: "브로슈어/자료", pattern: "brochure|download|resource" },
];

const STAGE_OPTIONS = [
    { value: "사이트 도착", label: "사이트 도착" },
    { value: "둘러봄", label: "둘러봄" },
    { value: "서비스 깊이 확인", label: "서비스 깊이 확인" },
    { value: "상담·데모·체험 행동", label: "상담·데모·체험" },
    { value: "신청 시작", label: "신청 시작" },
    { value: "신청·구독·구매 완료", label: "완료" },
];

let nextId = 1;

export default function SegmentBuilder() {
    const today = new Date();
    const [dateFrom, setDateFrom] = useState<Date | undefined>(today);
    const [dateTo, setDateTo] = useState<Date | undefined>(today);
    const [workspaceId, setWorkspaceId] = useState<number | undefined>();
    const [hasClicked, setHasClicked] = useState("all");
    const [conditions, setConditions] = useState<Condition[]>([]);
    const [results, setResults] = useState<SegmentResult[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set());
    const [activeLabels, setActiveLabels] = useState<string[]>([]);

    const { workspaces } = useWorkspaces();

    const addCondition = () => {
        // 아직 안 쓴 타입 중 첫 번째, 없으면 duration
        const usedTypes = new Set(conditions.map((c) => c.type));
        const available = CONDITION_TYPES.find((t) => !usedTypes.has(t.value));
        setConditions([...conditions, { id: nextId++, type: available?.value ?? "duration", value: "", value2: "", operator: "AND" }]);
    };

    const removeCondition = (id: number) => {
        setConditions(conditions.filter((c) => c.id !== id));
    };

    const updateCondition = (id: number, patch: Partial<Condition>) => {
        setConditions(conditions.map((c) => c.id === id ? { ...c, ...patch } : c));
    };

    const buildFilters = (): Filters => {
        const f: Filters = {};
        if (hasClicked === "yes") f.hasClicked = true;
        for (const c of conditions) {
            if (!c.value) continue;
            switch (c.type) {
                case "duration": f.minDuration = Number(c.value); break;
                case "pages": f.minPages = Number(c.value); break;
                case "visits": f.minVisits = Number(c.value); break;
                case "path":
                    f.pagePathContains = c.value;
                    if (c.value2) f.pageMinDuration = Number(c.value2);
                    break;
                case "click": f.eventNamePattern = c.value; f.eventType = "CLICK"; break;
                case "stage": f.stage = c.value; break;
            }
        }
        return f;
    };

    const buildLabels = (): string[] => {
        const labels: string[] = [];
        if (hasClicked === "yes") labels.push("이메일 유입만");
        for (let i = 0; i < conditions.length; i++) {
            const c = conditions[i];
            if (!c.value) continue;
            const prefix = i > 0 ? (c.operator === "OR" ? "또는 " : "") : "";
            switch (c.type) {
                case "duration": labels.push(`${prefix}${c.value}초 이상 체류`); break;
                case "pages": labels.push(`${prefix}${c.value}페이지 이상`); break;
                case "visits": labels.push(`${prefix}${c.value}회 이상 방문`); break;
                case "path":
                    labels.push(c.value2 ? `${prefix}경로: ${c.value} (${c.value2}초+)` : `${prefix}경로: ${c.value}`);
                    break;
                case "click":
                    labels.push(`${prefix}클릭: ${CLICK_PATTERNS.find((p) => p.pattern === c.value)?.label ?? c.value}`);
                    break;
                case "stage": labels.push(`${prefix}단계: ${c.value}`); break;
            }
        }
        return labels;
    };

    const search = async () => {
        if (!dateFrom || !dateTo) return;
        setActiveLabels(buildLabels());
        setIsLoading(true);
        setHasSearched(true);
        const startDate = format(dateFrom, "yyyy-MM-dd");
        const endDate = format(dateTo, "yyyy-MM-dd");
        const apiConditions = conditions
            .filter((c) => c.value)
            .map((c) => ({ type: c.type, value: c.value, value2: c.value2 || undefined, operator: c.operator }));
        try {
            const res = await fetch("/api/crm/segments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceId, startDate, endDate, conditions: apiConditions, hasClicked: hasClicked === "yes" }),
            });
            const data = await res.json();
            if (data.success) {
                setResults(data.data);
                setTotal(data.total);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const renderConditionValue = (c: Condition) => {
        switch (c.type) {
            case "duration":
                return (
                    <Select value={c.value || "none"} onValueChange={(v) => updateCondition(c.id, { value: v === "none" ? "" : v })}>
                        <SelectTrigger className="w-[120px] h-9 text-sm">
                            <SelectValue placeholder="선택" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="min-w-[var(--radix-select-trigger-width)]">
                            <SelectItem value="none">선택</SelectItem>
                            {DURATION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                );
            case "pages":
                return (
                    <div className="flex items-center gap-1">
                        <Input type="number" value={c.value} onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                            placeholder="N" className={`w-[60px] h-9 text-sm text-center ${noSpinner}`} />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">페이지 이상</span>
                    </div>
                );
            case "visits":
                return (
                    <div className="flex items-center gap-1">
                        <Input type="number" value={c.value} onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                            placeholder="N" className={`w-[60px] h-9 text-sm text-center ${noSpinner}`} />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">회 이상</span>
                    </div>
                );
            case "path":
                return (
                    <div className="flex items-center gap-1">
                        <Input value={c.value} onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                            placeholder="/pricing" className="w-[120px] h-9 text-sm" />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">에서</span>
                        <Input type="number" value={c.value2} onChange={(e) => updateCondition(c.id, { value2: e.target.value })}
                            placeholder="초" className={`w-[60px] h-9 text-sm text-center ${noSpinner}`} />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">초 이상</span>
                    </div>
                );
            case "click":
                return (
                    <Select value={c.value || "none"} onValueChange={(v) => updateCondition(c.id, { value: v === "none" ? "" : v })}>
                        <SelectTrigger className="w-[120px] h-9 text-sm">
                            <SelectValue placeholder="선택" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="min-w-[var(--radix-select-trigger-width)]">
                            <SelectItem value="none">선택</SelectItem>
                            {CLICK_PATTERNS.map((p) => <SelectItem key={p.pattern} value={p.pattern}>{p.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                );
            case "stage":
                return (
                    <Select value={c.value || "none"} onValueChange={(v) => updateCondition(c.id, { value: v === "none" ? "" : v })}>
                        <SelectTrigger className="w-[140px] h-9 text-sm">
                            <SelectValue placeholder="선택" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="min-w-[var(--radix-select-trigger-width)]">
                            <SelectItem value="none">선택</SelectItem>
                            {STAGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                );
        }
    };

    return (
        <div className="space-y-4">
            {/* 날짜 + 서비스 + 유입 */}
            <div className="flex items-center gap-4 flex-wrap">
                <DateRangePicker
                    from={dateFrom}
                    to={dateTo}
                    onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
                    maxDate={today}
                    triggerClassName="w-[250px] tabular-nums"
                />
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" onClick={() => { setDateFrom(today); setDateTo(today); }}>오늘</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); setDateFrom(d); setDateTo(today); }}>7일</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 30); setDateFrom(d); setDateTo(today); }}>30일</Button>
                </div>
                <Select value={workspaceId?.toString() ?? "all"} onValueChange={(v) => setWorkspaceId(v === "all" ? undefined : Number(v))}>
                    <SelectTrigger className="w-[140px] h-9 text-sm">
                        <SelectValue placeholder="서비스" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="min-w-[var(--radix-select-trigger-width)]">
                        <SelectItem value="all">전체 서비스</SelectItem>
                        {workspaces.map((ws) => (
                            <SelectItem key={ws.id} value={ws.id.toString()}>{ws.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={hasClicked} onValueChange={setHasClicked}>
                    <SelectTrigger className="w-[150px] h-9 text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="min-w-[var(--radix-select-trigger-width)]">
                        <SelectItem value="all">전체 방문자</SelectItem>
                        <SelectItem value="yes">이메일 유입만</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* 조합형 필터 */}
            <div className="rounded-lg border p-4 space-y-3">
                {conditions.length === 0 && (
                    <p className="text-sm text-muted-foreground">조건을 추가하여 세그먼트를 만드세요.</p>
                )}
                {conditions.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-2">
                        {i > 0 && (
                            <button
                                type="button"
                                className="text-xs font-medium w-[34px] py-0.5 rounded cursor-pointer hover:bg-muted transition-colors text-center"
                                style={{ color: c.operator === "OR" ? "var(--color-primary)" : undefined }}
                                onClick={() => updateCondition(c.id, { operator: c.operator === "AND" ? "OR" : "AND" })}
                            >
                                {c.operator}
                            </button>
                        )}
                        {i === 0 && <span className="w-[34px]" />}
                        <Select value={c.type} onValueChange={(v) => updateCondition(c.id, { type: v as ConditionType, value: "", value2: "" })}>
                            <SelectTrigger className="w-[130px] h-9 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" className="min-w-[var(--radix-select-trigger-width)]">
                                {CONDITION_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {renderConditionValue(c)}
                        <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer" onClick={() => removeCondition(c.id)}>
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" className="cursor-pointer" onClick={addCondition}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> 조건 추가
                    </Button>
                    <Button size="sm" className="cursor-pointer" onClick={search}>
                        <Search className="h-3.5 w-3.5 mr-1.5" /> 조회
                    </Button>
                </div>
            </div>

            {/* 결과 */}
            {isLoading ? (
                <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
            ) : hasSearched && (
                <>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{total}명 매칭</span>
                        {activeLabels.length > 0 && (
                            <>
                                <span className="text-muted-foreground">·</span>
                                {activeLabels.map((label) => (
                                    <Badge key={label} variant="secondary">{label}</Badge>
                                ))}
                            </>
                        )}
                    </div>

                    {(() => {
                        const grouped = new Map<string, SegmentResult[]>();
                        for (const row of results) {
                            const key = row.workspaceName;
                            if (!grouped.has(key)) grouped.set(key, []);
                            grouped.get(key)!.push(row);
                        }
                        const wsNames = [...grouped.keys()].sort();
                        const isGrouped = !workspaceId && wsNames.length > 1;

                        const toggleWsExpand = (name: string) => {
                            setExpandedWs((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
                        };

                        const renderRow = (row: SegmentResult) => (
                            <TableRow key={row.visitorId}>
                                {isGrouped && <TableCell />}
                                <TableCell>
                                    <div className="font-medium text-sm">{row.name || row.email || "미식별"}</div>
                                    {row.name && row.email && <div className="text-xs text-muted-foreground">{row.email}</div>}
                                    {row.integratedCode && <div className="text-xs text-muted-foreground">{row.integratedCode}</div>}
                                </TableCell>
                                {!isGrouped && <TableCell className="text-sm">{row.workspaceName}</TableCell>}
                                <TableCell className="text-right text-sm">{row.sessionCount}</TableCell>
                                <TableCell className="text-right text-sm">{row.totalPages}</TableCell>
                                <TableCell className="text-right text-sm">{durationLabel(row.maxDuration)}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
                                </TableCell>
                                <TableCell>
                                    {row.recordId ? (
                                        <a href={`/records/${row.recordId}/journey`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">-</span>
                                    )}
                                </TableCell>
                            </TableRow>
                        );

                        const colCount = isGrouped ? 7 : 7;

                        return (
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            {isGrouped && <TableHead className="w-[40px]" />}
                                            <TableHead>고객</TableHead>
                                            {!isGrouped && <TableHead className="w-[100px]">서비스</TableHead>}
                                            <TableHead className="w-[80px] text-right">방문</TableHead>
                                            <TableHead className="w-[80px] text-right">페이지</TableHead>
                                            <TableHead className="w-[100px] text-right">최대 체류</TableHead>
                                            <TableHead className="w-[110px]">마지막 방문</TableHead>
                                            <TableHead className="w-[60px]">링크</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {results.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={colCount + 1} className="text-center py-8 text-muted-foreground">
                                                    조건에 맞는 고객이 없습니다.
                                                </TableCell>
                                            </TableRow>
                                        ) : isGrouped ? (
                                            wsNames.map((wsName) => {
                                                const wsRows = grouped.get(wsName)!;
                                                const wsOpen = expandedWs.has(wsName);
                                                return (
                                                    <>
                                                        <TableRow
                                                            key={`ws-${wsName}`}
                                                            className="cursor-pointer hover:bg-muted/50"
                                                            onClick={() => toggleWsExpand(wsName)}
                                                        >
                                                            <TableCell>
                                                                {wsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                            </TableCell>
                                                            <TableCell className="font-semibold" colSpan={colCount - 1}>
                                                                {wsName} ({wsRows.length}명)
                                                            </TableCell>
                                                        </TableRow>
                                                        {wsOpen && wsRows.map(renderRow)}
                                                    </>
                                                );
                                            })
                                        ) : (
                                            results.map(renderRow)
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        );
                    })()}
                </>
            )}
        </div>
    );
}
