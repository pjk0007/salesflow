"use client";
import { Button } from "@/components/ui/button";
import { useVersionOptions } from "../hooks/useCopyManager";
import type { CopyPurpose } from "../types";
import { controlClass } from "./Fields";

/**
 * 조건에 맞는 버전을 모두 고를 수 있는 선택기(UX-167). 최근 50개를 넘는 오래된 승인 버전은 '더 보기'로 이어 받고,
 * 아직 받지 않은 쪽에 있는 현재 선택값은 번호로 남겨 값이 몰래 바뀌지 않게 한다.
 */
export function VersionSelect({
    id,
    kind,
    workspaceId,
    state,
    purpose,
    value,
    onChange,
}: {
    id: string;
    kind: "policy" | "knowledge";
    workspaceId: number;
    state: "approved" | "usable";
    purpose?: CopyPurpose;
    value: number;
    onChange: (id: number) => void;
}) {
    const options = useVersionOptions<{ id: number; name: string }>(kind, {
        workspaceId,
        state,
        purpose,
    });
    const listed = options.versions;
    const selectedMissing = value > 0 && !listed.some((v) => v.id === value);
    return (
        <div className="space-y-1.5">
            <select
                id={id}
                className={controlClass}
                required
                disabled={!workspaceId}
                value={value || ""}
                onChange={(e) => onChange(Number(e.target.value))}
            >
                <option value="">{workspaceId ? "선택" : "사업을 먼저 선택"}</option>
                {selectedMissing && <option value={value}>현재 선택 · #{value}</option>}
                {listed.map((v) => (
                    <option key={v.id} value={v.id}>
                        {v.name} · #{v.id}
                    </option>
                ))}
            </select>
            {options.error ? (
                <p className="text-xs text-destructive" role="alert">
                    버전 목록을 불러오지 못했습니다.{" "}
                    <button type="button" className="underline" onClick={options.retry}>
                        다시 시도
                    </button>
                </p>
            ) : options.hasMore ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={options.loading}
                    onClick={options.loadMore}
                >
                    {options.loading ? "불러오는 중..." : "이전 버전 더 보기"}
                </Button>
            ) : workspaceId > 0 && !options.loading && !listed.length ? (
                <p className="text-xs text-muted-foreground">선택할 수 있는 버전이 없습니다.</p>
            ) : null}
        </div>
    );
}
