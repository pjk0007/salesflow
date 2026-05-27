"use client";

import { EmbedScriptCard } from "./EmbedScriptCard";
import { DomainEditor } from "./DomainEditor";
import { MatchFieldCard } from "./MatchFieldCard";
import { ExcludePathsCard } from "./ExcludePathsCard";
import { FunnelManagerCard } from "./FunnelManagerCard";
import type { TrackerSite } from "../types";

/**
 * 트래커 설정 패널 — 설치 스크립트 + 허용 도메인.
 * /tracker 페이지의 "설정" 탭에서 사용.
 */
export function TrackerSettingsPanel({
    site,
    onUpdated,
}: {
    site: TrackerSite;
    onUpdated: () => void;
}) {
    return (
        <div className="space-y-4">
            <EmbedScriptCard apiKey={site.apiKey} />
            <DomainEditor
                siteId={site.id}
                domains={site.domains}
                onUpdated={onUpdated}
            />
            <MatchFieldCard
                siteId={site.id}
                workspaceId={site.workspaceId}
                matchField={site.matchField}
                onUpdated={onUpdated}
            />
            <ExcludePathsCard
                siteId={site.id}
                excludePaths={site.excludePaths ?? []}
                onUpdated={onUpdated}
            />
            <FunnelManagerCard siteId={site.id} />
        </div>
    );
}
