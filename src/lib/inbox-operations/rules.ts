import { z } from "zod";
import { calendarInput } from "./calendar";
export const policyInput = z
    .object({
        enabled: z.boolean(),
        calendar: calendarInput,
        showHours: z.boolean(),
        awayMessage: z.string().trim().max(500),
        includeAi: z.boolean(),
        pauseOnSnooze: z.boolean(),
        firstMinutes: z.number().int().min(1).max(43200),
        nextMinutes: z.number().int().min(1).max(43200),
        resolutionMinutes: z.number().int().min(1).max(43200),
    })
    .strict()
    .superRefine((value, ctx) => {
        const minutes = (text: string) =>
            text === "24:00"
                ? 1440
                : Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
        const weekly = value.calendar.weekly.reduce(
            (sum, row) => sum + minutes(row.end) - minutes(row.start),
            0,
        );
        if (
            Math.max(
                value.firstMinutes,
                value.nextMinutes,
                value.resolutionMinutes,
            ) >
            weekly * 400
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "응대 목표가 업무시간에 비해 너무 큽니다. 목표를 줄이거나 업무시간을 넓혀주세요.",
            });
    });
export type OperationsPolicy = z.infer<typeof policyInput>;
export const defaultPolicy = (): OperationsPolicy => ({
    enabled: false,
    calendar: {
        timezone: "Asia/Seoul",
        weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
            day,
            start: "00:00",
            end: "24:00",
        })),
        holidays: [],
    },
    showHours: false,
    awayMessage:
        "지금은 상담 업무시간 밖입니다. 문의를 남겨주시면 다음 업무시간에 확인하겠습니다.",
    includeAi: false,
    pauseOnSnooze: true,
    firstMinutes: 60,
    nextMinutes: 120,
    resolutionMinutes: 480,
});
export const operationsWorkerEnabled = () =>
    process.env.NODE_ENV === "production" &&
    process.env.CUSTOMER_INBOX_OPERATIONS_WORKER === "on";
export const notificationLabels: Record<string, string> = {
    customer: "새 고객 문의",
    assigned: "상담 담당 배정",
    handoff: "상담원 확인 요청",
    identity: "회원 상담 이력 연결",
    sla_first: "첫 답변 목표 초과",
    sla_next: "추가 답변 목표 초과",
    sla_resolution: "해결 목표 초과",
};
