import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsQuery } from "../types";
import { useEmailStatsCompare } from "../hooks/useEmailStatsCompare";
import { CompareRows } from "./CompareRows";
export function CompareTable({ query }: { query: StatsQuery }) {
    const stats = useEmailStatsCompare(query);
    return <Card>
        <CardHeader><CardTitle className="text-base">축별 비교</CardTitle>
            <Tabs value={stats.axis} onValueChange={stats.handleAxis} className="overflow-x-auto"><TabsList>
                {stats.axes.map(axis => <TabsTrigger key={axis.value} value={axis.value}>{axis.label}</TabsTrigger>)}
            </TabsList></Tabs>
        </CardHeader>
        <CardContent>
            {stats.error ? <div role="alert">이메일 통계를 불러오지 못했습니다. <Button variant="outline" onClick={stats.handleRetry}>다시 불러오기</Button></div>
                : stats.isLoading ? <Skeleton className="h-64" aria-label="비교 표 로딩 중" />
                    : stats.isEmpty ? <p className="py-8 text-center text-muted-foreground">이 기간에 보낸 메일이 없습니다.</p>
                        : <div className="overflow-x-auto"><Table className="whitespace-nowrap">
                            <TableHeader><TableRow>{stats.columns.map(column => <TableHead key={column.key} title={column.tooltip}>
                                <button type="button" onClick={column.onClick} className={column.key === "label" ? "w-full py-2 text-left" : "w-full py-2 text-right"}>{column.label}{column.sortLabel}</button>
                            </TableHead>)}</TableRow></TableHeader>
                            <TableBody><CompareRows rows={stats.rows} /></TableBody>
                            <TableFooter><CompareRows rows={stats.total} /></TableFooter>
                        </Table></div>}
        </CardContent>
    </Card>;
}
