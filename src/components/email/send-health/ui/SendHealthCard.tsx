"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import ChatDeliverySection from "./ChatDeliverySection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSendHealth } from "../hooks/useSendHealth";
import type { ReleaseTarget } from "../types";
import {
    actionNoteLabel,
    eventLabel,
    formatKst,
    formatRateBp,
    healthTooltip,
    holdLine,
    modeLabel,
    sortPartitions,
    syncLine,
} from "../utils/labels";
import HealthStateBadge from "./HealthStateBadge";
import HoldBadge from "./HoldBadge";
import ReleaseDialog from "./ReleaseDialog";

const COLLAPSED_ROWS = 8;

/**
 * 이메일 첫 화면의 발신 건강 카드 (DESIGN-SND 10절, id="send-health" — 알림 링크가 여기로 온다).
 * 명단 표(7일/30일 창 표시), 주소 표, 도메인 발신 쪽 실패, 보류·멈춤과 풀기(관리자), 최근 사건, 모드·동기화 상태,
 * 반송 안내 참고 숫자. 받는 사람 주소는 보이지 않는다 (숫자와 사유만).
 */
export default function SendHealthCard() {
    const { view, loadFailed, releaseHold, releaseSender } = useSendHealth();
    const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget | null>(null);
    const [showAll, setShowAll] = useState(false);

    // 알림 링크(/email#send-health)로 들어오면 카드가 그려진 뒤 여기로 옮긴다
    useEffect(() => {
        if (view && typeof window !== "undefined" && window.location.hash === "#send-health") {
            document.getElementById("send-health")?.scrollIntoView({ block: "start" });
        }
    }, [view]);

    const partitions = useMemo(() => sortPartitions(view?.partitions ?? []), [view]);
    if (loadFailed && !view) return null;
    if (!view) return null;
    // 발신 건강 판정 대상 조직이 아니면 보이지 않는다 (SEND_HEALTH_ORG_IDS — OPS-2)
    if (view.inScope === false) return null;

    const sync = syncLine(view.sync);
    const visiblePartitions = showAll ? partitions : partitions.filter((p) => p.state !== "ok" || p.held || p.recovered).slice(0, COLLAPSED_ROWS);
    const senders = view.senders.filter((s) => showAll || s.state === "danger" || s.state === "caution" || (s.isPaused && s.pausedSource === "auto"));
    const domains = view.domains.filter((d) => d.state !== "ok");
    const dsnTotal = view.partitions.reduce((a, p) => a + p.dsnOnly, 0);

    const onConfirm = (t: ReleaseTarget, note: string) => (t.kind === "hold" ? releaseHold(t.holdId, note) : releaseSender(t.profileId, note));

    return (
        <Card id="send-health" className="scroll-mt-20">
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="text-base">발송 건강</CardTitle>
                        <CardDescription>
                            최근 7일 명단·발신 주소의 발송 실패율 (느린 명단은 30일). 모드: {modeLabel(view.mode)}
                            {view.dsnInRate ? " · 반송 안내 실패율 반영" : ""}
                        </CardDescription>
                    </div>
                    <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
                {view.unavailable ? (
                    <p className="text-muted-foreground">발신 건강 표가 아직 준비되지 않았습니다 (마이그레이션 확인 필요).</p>
                ) : (
                    <>
                        <div className="space-y-1 text-xs text-muted-foreground">
                            <p>{sync.text}</p>
                            {sync.warning && (
                                <p className="flex items-center gap-1 text-amber-700">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    {sync.warning}
                                </p>
                            )}
                            {view.healthDate ? <p>판정: {view.healthDate} 기준 마지막 회차</p> : <p>아직 판정한 적이 없습니다 (10분마다 판정).</p>}
                        </div>

                        {view.holds.length > 0 && (
                            <section className="space-y-2">
                                <p className="font-medium">보류 중인 명단</p>
                                <ul className="divide-y rounded-md border">
                                    {view.holds.map((h) => (
                                        <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                                            <HoldBadge kind="hold" reason={h.reasonText} since={h.heldAt} />
                                            <span className="min-w-0 flex-1 truncate font-medium">
                                                {h.workspaceName ? `${h.workspaceName} › ` : ""}
                                                {h.partitionName}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {holdLine(h)} · 대기 {h.queued.toLocaleString("ko-KR")}통
                                            </span>
                                            {view.isAdmin && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => setReleaseTarget({ kind: "hold", holdId: h.id, name: h.partitionName, queued: h.queued })}
                                                >
                                                    풀기
                                                </Button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        <section className="space-y-2">
                            <div className="flex items-center justify-between">
                                <p className="font-medium">명단</p>
                                {partitions.length > 0 && (
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>
                                        {showAll ? "문제 있는 것만" : `모두 보기 (${partitions.length})`}
                                    </Button>
                                )}
                            </div>
                            {visiblePartitions.length === 0 ? (
                                <p className="text-xs text-muted-foreground">위험·주의 명단이 없습니다.</p>
                            ) : (
                                <div className="overflow-x-auto rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>명단</TableHead>
                                                <TableHead>상태</TableHead>
                                                <TableHead className="text-right">확정</TableHead>
                                                <TableHead className="text-right">실패</TableHead>
                                                <TableHead className="text-right">실패율</TableHead>
                                                <TableHead className="text-right">반송 안내</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {visiblePartitions.map((p) => (
                                                <TableRow key={p.partitionId}>
                                                    <TableCell className="max-w-[16rem] truncate">
                                                        {p.workspaceName ? <span className="text-muted-foreground">{p.workspaceName} › </span> : null}
                                                        {p.name}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-wrap items-center gap-1">
                                                            <HealthStateBadge state={p.state} recovered={p.recovered} tooltip={healthTooltip(p)} />
                                                            {p.evalWindow === "30d" && <span className="text-[11px] text-muted-foreground">30일</span>}
                                                            {p.held && <HoldBadge kind="hold" />}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">{p.final.toLocaleString("ko-KR")}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{p.failed.toLocaleString("ko-KR")}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{formatRateBp(p.rateBp)}</TableCell>
                                                    <TableCell className="text-right tabular-nums text-muted-foreground">{p.dsnOnly || "-"}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </section>

                        <section className="space-y-2">
                            <p className="font-medium">발신 주소</p>
                            {senders.length === 0 ? (
                                <p className="text-xs text-muted-foreground">위험·주의·자동 멈춤 주소가 없습니다.</p>
                            ) : (
                                <ul className="divide-y rounded-md border">
                                    {senders.map((s) => {
                                        const autoPaused = s.isPaused && s.pausedSource === "auto";
                                        return (
                                            <li key={s.profileId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                                                <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.email}</span>
                                                <HealthStateBadge
                                                    state={s.state}
                                                    tooltip={`${healthTooltip({ final: s.final, failed: s.failed, rateBp: s.rateBp, dsnOnly: s.dsnOnly })}${s.outliers ? `\n같은 명단의 다른 주소보다 뚜렷이 높은 명단 ${s.outliers}개` : ""}`}
                                                />
                                                {autoPaused && <HoldBadge kind="auto_pause" reason={s.pausedReason} since={s.pausedAt} />}
                                                {s.isDefault && (
                                                    <span className="text-[11px] text-muted-foreground" title="조직 기본 주소는 자동으로 멈추지 않습니다 — 멈추면 이 조직의 템플릿 메일(폼 문의 첫 메일 포함)이 모두 멈춥니다.">
                                                        자동 멈춤 안 함(기본 주소)
                                                    </span>
                                                )}
                                                {s.healthAction === "alert" && !s.isDefault && <span className="text-[11px] text-muted-foreground">알림만</span>}
                                                <span className="text-xs tabular-nums text-muted-foreground">{formatRateBp(s.rateBp)}</span>
                                                {view.isAdmin && autoPaused && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() =>
                                                            setReleaseTarget({ kind: "sender", profileId: s.profileId, email: s.email, reason: s.pausedReason, preview: s.releasePreview })
                                                        }
                                                    >
                                                        풀기
                                                    </Button>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        {domains.length > 0 && (
                            <section className="space-y-1">
                                <p className="font-medium">발신 도메인 인증 실패</p>
                                <ul className="space-y-1 text-xs">
                                    {domains.map((d) => (
                                        <li key={d.domain} className="flex items-center gap-2">
                                            <HealthStateBadge state={d.state} tooltip="SPF·DKIM·DMARC 같은 우리 도메인 쪽 실패 (명단 실패율에는 넣지 않는다)" />
                                            <span className="font-mono">{d.domain}</span>
                                            <span className="text-muted-foreground">
                                                최근 24시간 {d.senderSide24h}통{d.burst ? ` · 최근 1시간 ${d.senderSide1h}통 (폭주)` : ""} — 도메인 인증 확인 필요
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {dsnTotal > 0 && !view.dsnInRate && (
                            <p className="text-xs text-muted-foreground">반송 안내(참고, 실패율에는 아직 안 넣음): {dsnTotal.toLocaleString("ko-KR")}통</p>
                        )}

                        {view.isAdmin && <ChatDeliverySection rows={view.chatDelivery ?? []} />}

                        {view.events.length > 0 && (
                            <section className="space-y-1">
                                <p className="font-medium">최근 사건 (14일)</p>
                                <ul className="space-y-1 text-xs">
                                    {view.events.slice(0, 10).map((e) => (
                                        <li key={e.id} className="flex flex-wrap gap-x-2">
                                            <span className="tabular-nums text-muted-foreground">{formatKst(e.createdAt)}</span>
                                            <span className="font-medium">{eventLabel(e)}</span>
                                            {e.entityKey && <span className="font-mono">{e.entityKey}</span>}
                                            <span className="min-w-0 text-muted-foreground">{e.summary.split("\n")[0]}</span>
                                            {actionNoteLabel(e.actionNote) && <span className="text-amber-700">· {actionNoteLabel(e.actionNote)}</span>}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </>
                )}
            </CardContent>
            <ReleaseDialog target={releaseTarget} onClose={() => setReleaseTarget(null)} onConfirm={onConfirm} />
        </Card>
    );
}
