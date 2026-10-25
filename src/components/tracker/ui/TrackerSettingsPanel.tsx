"use client";

import { EmbedScriptCard } from "./EmbedScriptCard";
import { DomainEditor } from "./DomainEditor";
import { MatchFieldCard } from "./MatchFieldCard";
import { ExcludePathsCard } from "./ExcludePathsCard";
import { FunnelManagerCard } from "./FunnelManagerCard";
import { EventAliasesCard } from "./EventAliasesCard";
import { formatKstShort } from "@/lib/kst";
import type { TrackerSite } from "../types";

/**
 * 트래커 설정 패널 — 설치 스크립트 + 허용 도메인.
 * /tracker 페이지의 "설정" 탭에서 사용.
 * readOnly(일반 멤버): 서버가 변경을 403으로 거절하므로 편집 버튼을 숨기고 스크립트 복사·조회만 둔다.
 */
export function TrackerSettingsPanel({
    site,
    onUpdated,
    readOnly = false,
}: {
    site: TrackerSite;
    onUpdated: () => void;
    readOnly?: boolean;
}) {
    const limited = site.rateLimited;
    return (
        <div className="space-y-4">
            {readOnly && (
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    트래커 설정은 관리자만 바꿀 수 있습니다. 변경이 필요하면 조직 관리자에게 요청하세요.
                </p>
            )}
            {limited && limited.count > 0 && (
                <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    최근 1시간 동안 요청 한도 초과로 수집·식별 요청 {limited.count.toLocaleString()}건이 버려졌습니다
                    {limited.lastAt ? ` (마지막 ${formatKstShort(new Date(limited.lastAt))})` : ""}.
                    방문 수치가 실제보다 적게 보일 수 있습니다.
                </p>
            )}
            <EmbedScriptCard apiKey={site.apiKey} />
            <DomainEditor
                siteId={site.id}
                domains={site.domains}
                onUpdated={onUpdated}
                readOnly={readOnly}
            />
            <MatchFieldCard
                siteId={site.id}
                workspaceId={site.workspaceId}
                matchField={site.matchField}
                onUpdated={onUpdated}
                readOnly={readOnly}
            />
            <ExcludePathsCard
                siteId={site.id}
                excludePaths={site.excludePaths ?? []}
                onUpdated={onUpdated}
                readOnly={readOnly}
            />
            <FunnelManagerCard siteId={site.id} readOnly={readOnly} />
            <EventAliasesCard siteId={site.id} readOnly={readOnly} />
        </div>
    );
}
