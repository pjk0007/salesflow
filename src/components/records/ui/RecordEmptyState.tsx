import { Button } from "@/components/ui/button";

interface RecordEmptyStateProps {
    /** 검색·필터·분배순서가 걸려 있는지 — 조건 때문에 비었는지 자료가 없는지 구분한다(UX-057) */
    hasConditions?: boolean;
    onClearConditions?: () => void;
}

/** 레코드 표·그룹 뷰 공용 빈 상태 */
export default function RecordEmptyState({ hasConditions, onClearConditions }: RecordEmptyStateProps) {
    return (
        <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-center text-muted-foreground">
                <p className="text-lg mb-1">{hasConditions ? "조건에 맞는 레코드가 없습니다" : "레코드가 없습니다"}</p>
                <p className="text-sm">
                    {hasConditions
                        ? "검색어·필터·분배순서를 바꾸거나 조건을 초기화해보세요."
                        : "새 레코드를 추가해보세요."}
                </p>
                {hasConditions && onClearConditions && (
                    <Button variant="outline" size="sm" className="mt-4" onClick={onClearConditions}>
                        조건 초기화
                    </Button>
                )}
            </div>
        </div>
    );
}
