"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Ban, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/contexts/SessionContext";
import { useUnsubscribeManagement } from "../hooks/useUnsubscribeManagement";
import type { UnsubscribeEntry, UnsubscribeLookupResult } from "../types";

const sourceLabels: Record<string, string> = { link: "본문 링크", one_click: "메일앱 구독취소", manual: "관리자 등록" };
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });

function EntriesTable({ items }: { items: UnsubscribeEntry[] }) {
    return (
        <Table>
            <TableHeader><TableRow>
                <TableHead>이메일</TableHead><TableHead>요청 사업</TableHead><TableHead>등록 경로</TableHead><TableHead>등록일 (한국 시간)</TableHead><TableHead>사유</TableHead>
            </TableRow></TableHeader>
            <TableBody>{items.map((item) => (
                <TableRow key={item.id}>
                    <TableCell className="font-medium break-all">{item.email}</TableCell>
                    <TableCell>{item.workspaceName || "사업 정보 없음"}</TableCell>
                    <TableCell>{sourceLabels[item.source] || item.source}</TableCell>
                    <TableCell className="whitespace-nowrap">{dateFormatter.format(new Date(item.unsubscribedAt))}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal break-words">{item.reason || "—"}</TableCell>
                </TableRow>
            ))}</TableBody>
        </Table>
    );
}

function LookupResult({ result, showAll }: { result: UnsubscribeLookupResult; showAll: () => void }) {
    const hasMatches = result.totalCount > 0;
    return (
        <div className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-all">{result.query}</span>
                <Badge variant={hasMatches ? "destructive" : "secondary"}>
                    {result.kind === "email" ? (hasMatches ? "조직 전체 수신거부" : "등록 내역 없음") : (hasMatches ? "도메인 내 등록 주소 있음" : "도메인 내 등록 주소 없음")}
                </Badge>
            </div>
            {result.kind === "domain" && <p className="text-sm text-muted-foreground">이 도메인과 정확히 일치하는 주소의 기록입니다. 도메인 전체 차단 여부를 뜻하지 않습니다.</p>}
            {hasMatches && <EntriesTable items={result.items} />}
            {result.totalCount > result.items.length && <Button variant="link" className="h-auto p-0" onClick={showAll}>전체 {result.totalCount}건을 목록에서 보기</Button>}
        </div>
    );
}

function UnsubscribeManager({ orgId, sessionEpoch }: { orgId: string; sessionEpoch: number }) {
    const state = useUnsubscribeManagement(orgId, sessionEpoch);
    const [searchText, setSearchText] = useState("");
    const [lookupText, setLookupText] = useState("");
    const [email, setEmail] = useState("");
    const [reason, setReason] = useState("");
    const pages = Math.max(1, Math.ceil((state.data?.totalCount ?? 0) / 20));

    async function add(event: FormEvent) {
        event.preventDefault();
        if (await state.add(email, reason)) { setEmail(""); setReason(""); }
    }

    return (
        <PageContainer>
            <PageHeader title="수신거부 목록" description="현재 조직의 모든 사업에 공통으로 적용되는 이메일 수신거부 목록입니다." actions={<Button variant="outline" asChild><Link href="/email">이메일로 돌아가기</Link></Button>} />
            <Alert><Ban className="size-4" /><AlertDescription className="space-y-2">
                <p>등록된 주소는 같은 조직의 모든 사업에서 이메일 발송 대상에서 제외됩니다. 기존에 사업별로 받은 수신거부도 함께 적용됩니다.</p>
                <p>발송 이력의 ‘거부’는 NHN 발송 서버가 거절한 상태이며, 이 수신거부 목록과 다릅니다.</p>
            </AlertDescription></Alert>

            <Card>
                <CardHeader><CardTitle>후보 주소 한 번에 확인</CardTitle><CardDescription>이메일 또는 도메인을 줄바꿈·쉼표로 구분해 최대 50개 입력하세요. 도메인 조회는 해당 도메인에 등록된 개별 이메일만 보여줍니다.</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void state.lookup(lookupText); }}>
                        <Label htmlFor="unsubscribe-targets">조회할 이메일 또는 도메인</Label>
                        <Textarea id="unsubscribe-targets" rows={4} value={lookupText} onChange={(event) => setLookupText(event.target.value)} placeholder={"person@example.com\nexample.org"} maxLength={13_000} required />
                        <Button type="submit" disabled={state.isLookingUp}><Search className="size-4" />{state.isLookingUp ? "확인 중..." : "수신거부 여부 확인"}</Button>
                    </form>
                    <p className="text-sm text-muted-foreground">‘등록 내역 없음’은 현재 조직의 수신거부 기록이 없다는 뜻입니다. 발송 동의나 실제 발송 가능 여부를 보장하지 않습니다.</p>
                    {state.lookupError && <p role="alert" className="text-sm text-destructive">{state.lookupError}</p>}
                    {state.lookupResults && <div className="space-y-3" aria-live="polite">{state.lookupResults.map((result) => <LookupResult key={result.query} result={result} showAll={() => { setSearchText(result.query); state.searchFor(result.query); }} />)}</div>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>수신거부 기록</CardTitle><CardDescription>조직 구성원 모두 조회할 수 있습니다. 같은 이메일의 과거 사업별 기록은 각각 표시됩니다.</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); state.searchFor(searchText); }}>
                        <Input aria-label="수신거부 목록 검색" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="이메일 또는 도메인 검색" maxLength={200} />
                        <Button type="submit" variant="outline">검색</Button>
                        <Button type="button" variant="outline" size="icon" aria-label="목록 새로고침" onClick={() => void state.refresh()}><RefreshCw className="size-4" /></Button>
                    </form>
                    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error.message}</p> : state.isLoading ? <p className="text-sm text-muted-foreground">목록을 불러오는 중...</p> : state.data?.items.length ? <EntriesTable items={state.data.items} /> : <p className="py-8 text-center text-muted-foreground">{state.search ? "검색 결과가 없습니다." : "등록된 수신거부 기록이 없습니다."}</p>}
                    {state.data && <div className="flex items-center justify-between gap-3 text-sm">
                        <span>총 {state.data.totalCount.toLocaleString()}건 · {state.page}/{pages} 페이지</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" disabled={state.page <= 1 || state.isLoading} onClick={() => state.setPage(state.page - 1)}><ChevronLeft className="size-4" />이전</Button>
                            <Button variant="outline" size="sm" disabled={state.page >= pages || state.isLoading} onClick={() => state.setPage(state.page + 1)}>다음<ChevronRight className="size-4" /></Button>
                        </div>
                    </div>}
                </CardContent>
            </Card>

            {state.data?.canManage && <Card>
                <CardHeader><CardTitle>관리자 수동 등록</CardTitle><CardDescription>등록 즉시 현재 조직의 모든 사업에 적용됩니다. 정확한 이메일 한 개만 등록하며, 이 화면에서는 해제할 수 없습니다.</CardDescription></CardHeader>
                <CardContent>
                    <form className="space-y-3" onSubmit={(event) => void add(event)}>
                        <div className="space-y-2"><Label htmlFor="unsubscribe-email">수신거부 이메일</Label><Input id="unsubscribe-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={200} required placeholder="person@example.com" /></div>
                        <div className="space-y-2"><Label htmlFor="unsubscribe-reason">사유 (선택)</Label><Textarea id="unsubscribe-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={2} /></div>
                        <Button type="submit" variant="destructive" disabled={state.isAdding}>{state.isAdding ? "등록 중..." : "조직 전체 수신거부 등록"}</Button>
                        {state.addError && <p role="alert" className="text-sm text-destructive">{state.addError}</p>}
                        {state.addedEmail && <p role="status" className="text-sm">{state.addedEmail} 주소에 조직 전체 수신거부를 적용했습니다.</p>}
                    </form>
                </CardContent>
            </Card>}
        </PageContainer>
    );
}

export default function UnsubscribesPage() {
    const { user, sessionEpoch, isSessionChanging } = useSession();
    return <WorkspaceLayout>{user && !isSessionChanging ? <UnsubscribeManager key={`${user.orgId}:${sessionEpoch}`} orgId={user.orgId} sessionEpoch={sessionEpoch} /> : <p className="p-6 text-muted-foreground">조직 정보를 확인하는 중...</p>}</WorkspaceLayout>;
}
