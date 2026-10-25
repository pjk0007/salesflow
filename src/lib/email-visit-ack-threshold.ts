/**
 * 방문 감사·후속 중단 기준(메일 링크로 사이트에 머문 초). 의존성이 없는 모듈이라 화면도 같은 숫자를 쓴다 (UX-164).
 * 서버 쪽은 email-visit-ack-rules.ts가 다시 내보낸다.
 */
export const VISIT_ACK_MIN_SECONDS = 7;
