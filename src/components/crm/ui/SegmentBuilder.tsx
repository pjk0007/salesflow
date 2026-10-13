"use client";

import { useState } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { Search, ExternalLink, Users, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";

function durationLabel(sec: number | null) {
    if (sec == null) return "-";
    if (sec < 60) return `${Math.round(sec)}초`;
    return `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초`;
}

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
    eventType?: string;
    eventNamePattern?: string;
    hasClicked?: boolean;
    stage?: string;
}

const CLICK_PATTERNS: { label: string; pattern: string }[] = [
    { label: "상담/데모", pattern: "demo|consult|contact|trial|meeting" },
    { label: "가입/신청", pattern: "signup|subscribe|manual_entry" },
    { label: "무료체험", pattern: "free-trial|trial" },
    { label: "전화/콜", pattern: "phone|call" },
    { label: "브로슈어/자료", pattern: "brochure|download|resource" },
];

function UnderlineInput({ value, onChange, placeholder, type = "text", className = "" }: {
    value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string;
}) {
    return (
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`bg-transparent border-0 border-b border-border focus:border-foreground outline-none text-sm py-1 transition-colors ${className}`}
        />
    );
}

export default function SegmentBuilder() {
    const today = new Date();
    const [dateFrom, setDateFrom] = useState<Date | undefined>(today);
    const [dateTo, setDateTo] = useState<Date | undefined>(today);
    const [workspaceId, setWorkspaceId] = useState<number | undefined>();
    const [results, setResults] = useState<SegmentResult[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [expandedWs, setExpandedWs] = useState<Set<string>>(new Set());
    const [activeFilters, setActiveFilters] = useState<Filters>({});

    const [minDuration, setMinDuration] = useState("");
    const [minPages, setMinPages] = useState("");
    const [minVisits, setMinVisits] = useState("");
    const [pagePathContains, setPagePathContains] = useState("");
    const [clickPattern, setClickPattern] = useState("");
    const [hasClicked, setHasClicked] = useState("all");
    const [stage, setStage] = useState("");

    const { workspaces } = useWorkspaces();

    const buildFilters = (): Filters => ({
        ...(minDuration ? { minDuration: Number(minDuration) } : {}),
        ...(minPages ? { minPages: Number(minPages) } : {}),
        ...(minVisits ? { minVisits: Number(minVisits) } : {}),
        ...(pagePathContains ? { pagePathContains } : {}),
        ...(clickPattern ? { eventNamePattern: clickPattern, eventType: "CLICK" } : {}),
        ...(hasClicked === "yes" ? { hasClicked: true } : {}),
        ...(stage ? { stage } : {}),
    });

    const activeFilterLabels = (): string[] => {
        const labels: string[] = [];
        if (activeFilters.minDuration) labels.push(`${activeFilters.minDuration}초 이상 체류`);
        if (activeFilters.minPages) labels.push(`${activeFilters.minPages}페이지 이상`);
        if (activeFilters.minVisits) labels.push(`${activeFilters.minVisits}회 이상 방문`);
        if (activeFilters.pagePathContains) labels.push(`경로: ${activeFilters.pagePathContains}`);
        if (activeFilters.eventNamePattern) labels.push(`클릭: ${CLICK_PATTERNS.find((p) => p.pattern === activeFilters.eventNamePattern)?.label ?? activeFilters.eventNamePattern}`);
        if (activeFilters.hasClicked) labels.push("이메일 유입만");
        if (activeFilters.stage) labels.push(`단계: ${activeFilters.stage}`);
        return labels;
    };

    const search = async () => {
        if (!dateFrom || !dateTo) return;
        const f = buildFilters();
        setActiveFilters(f);
        setIsLoading(true);
        setHasSearched(true);
        const startDate = format(dateFrom, "yyyy-MM-dd");
        const endDate = format(dateTo, "yyyy-MM-dd");
        try {
            const res = await fetch("/api/crm/segments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceId, startDate, endDate, filters: f }),
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

    return (
        <div className="space-y-4">
            {/* 날짜 + 서비스 + 유입 */}
            <div className="flex items-center gap-4 flex-wrap">
                <DateRangePicker
                    from={dateFrom}
                    to={dateTo}
                    onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
                    maxDate={today}
                    triggerClassName="border-0 border-b border-border rounded-none shadow-none px-0 bg-transparent hover:bg-transparent w-[250px] tabular-nums"
                />
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" onClick={() => { setDateFrom(today); setDateTo(today); }}>오늘</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); setDateFrom(d); setDateTo(today); }}>7일</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs cursor-pointer" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 30); setDateFrom(d); setDateTo(today); }}>30일</Button>
                </div>
                <Select value={workspaceId?.toString() ?? "all"} onValueChange={(v) => setWorkspaceId(v === "all" ? undefined : Number(v))}>
                    <SelectTrigger className="w-[140px] h-8 text-sm border-0 border-b border-border rounded-none shadow-none px-0">
                        <SelectValue placeholder="서비스" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 서비스</SelectItem>
                        {workspaces.map((ws) => (
                            <SelectItem key={ws.id} value={ws.id.toString()}>{ws.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={hasClicked} onValueChange={setHasClicked}>
                    <SelectTrigger className="w-[150px] h-8 text-sm border-0 border-b border-border rounded-none shadow-none px-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 방문자</SelectItem>
                        <SelectItem value="yes">이메일 유입만</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* 조건 필터 */}
            <div className="rounded-lg border p-4 space-y-4">

                {/* 2행: 조건 필터 */}
                <div className="flex items-end gap-5 flex-wrap">
                    <div className="flex items-center gap-1">
                        <UnderlineInput type="number" value={minDuration} onChange={setMinDuration} placeholder="N" className="w-[50px] text-center" />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">초 이상 체류</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <UnderlineInput type="number" value={minPages} onChange={setMinPages} placeholder="N" className="w-[40px] text-center" />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">페이지 이상</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <UnderlineInput type="number" value={minVisits} onChange={setMinVisits} placeholder="N" className="w-[40px] text-center" />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">회 이상 방문</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">경로</span>
                        <UnderlineInput value={pagePathContains} onChange={setPagePathContains} placeholder="/pricing" className="w-[100px]" />
                    </div>
                    <div className="flex items-center gap-1">
                        <Select value={clickPattern || "none"} onValueChange={(v) => setClickPattern(v === "none" ? "" : v)}>
                            <SelectTrigger className="w-[110px] h-8 text-sm border-0 border-b border-border rounded-none shadow-none px-0">
                                <SelectValue placeholder="버튼 클릭" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">버튼 없음</SelectItem>
                                {CLICK_PATTERNS.map((p) => (
                                    <SelectItem key={p.pattern} value={p.pattern}>{p.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground whitespace-nowrap">클릭</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">단계</span>
                        <Select value={stage || "none"} onValueChange={(v) => setStage(v === "none" ? "" : v)}>
                            <SelectTrigger className="w-[120px] h-8 text-sm border-0 border-b border-border rounded-none shadow-none px-0">
                                <SelectValue placeholder="전체" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">전체</SelectItem>
                                <SelectItem value="사이트 도착">사이트 도착</SelectItem>
                                <SelectItem value="둘러봄">둘러봄</SelectItem>
                                <SelectItem value="서비스 깊이 확인">서비스 깊이 확인</SelectItem>
                                <SelectItem value="상담·데모·체험 행동">상담·데모·체험</SelectItem>
                                <SelectItem value="신청 시작">신청 시작</SelectItem>
                                <SelectItem value="신청·구독·구매 완료">완료</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* 조회 버튼 */}
                <div>
                    <Button onClick={search} size="sm">
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
                        {activeFilterLabels().length > 0 && (
                            <>
                                <span className="text-muted-foreground">·</span>
                                {activeFilterLabels().map((label) => (
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
