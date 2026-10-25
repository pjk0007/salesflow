"use client";
import { useId } from "react";
import type { ReactNode } from "react";
export const controlClass =
    "w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50";
export function Field({
    label,
    children,
    help,
}: {
    label: string;
    children: (id: string) => ReactNode;
    help?: string;
}) {
    const id = useId();
    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="text-sm font-medium">
                {label}
            </label>
            {children(id)}
            {help && <p className="text-xs text-muted-foreground">{help}</p>}
        </div>
    );
}
export const purposeLabel = (value: string) =>
    value === "customer_chat"
        ? "고객 상담"
        : value === "visit_ack"
          ? "방문 감사 메일"
          : "첫 소개 메일";
export const stateLabel = (value: string) =>
    ({
        draft: "초안",
        evaluating: "평가 중",
        evaluated: "평가 완료",
        approved: "승인",
        retired: "사용 종료",
        blocked: "차단",
        pending: "대기",
        generating: "생성 중",
        ready: "준비 완료",
        retry: "재시도 예정",
        held: "검토 대기",
        cancelled: "취소",
        running: "진행 중",
        review: "검토 필요",
        passed: "기준 통과",
        completed: "측정 완료",
    })[value] ?? value;
export { reasonLabel, resultLabel, plainTextFromHtml } from "../utils/labels";
