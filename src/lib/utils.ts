import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPhoneNumber(value: string): string {
  const numbers = value.replace(/[^0-9]/g, "").slice(0, 11);
  const len = numbers.length;

  if (len <= 2) return numbers;
  if (len <= 5) return `${numbers.slice(0, 2)}-${numbers.slice(2)}`;
  if (len <= 9) {
    return `${numbers.slice(0, 2)}-${numbers.slice(2, 5)}-${numbers.slice(5)}`;
  }
  if (len === 10) {
    if (numbers.startsWith("02")) {
      return `${numbers.slice(0, 2)}-${numbers.slice(2, 6)}-${numbers.slice(6)}`;
    }
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 6)}-${numbers.slice(6)}`;
  }
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7)}`;
}

export function formatDate(date: Date | string | null): string {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

/** datetime-local 입력은 대상 날짜의 지역 시각을 쓴다. 현재 날짜의 DST 오프셋을 적용하지 않는다. */
export function localDateTimeValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * datetime-local 입력값을 저장용 ISO로 바꾼다. 입력이 원래 값의 표시와 같으면(사용자가 건드리지 않음)
 * 원래 순간을 그대로 돌려준다 — DST 종료 때 두 번 있는 지역 시각을 다시 해석해 한 시간 밀리는 일을 막는다.
 */
export function dateTimeInputToIso(input: string, original?: string | null): string | null {
  if (!input) return null;
  if (original && localDateTimeValue(original) === input) return new Date(original).toISOString();
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
