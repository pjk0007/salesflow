/**
 * 레코드 메모 수정·삭제 권한 — 작성자 본인만 (2026-11-11 주희님 요청: 관리자도 남의 메모는 못 지움).
 * 예전 규칙(UX-059)은 작성자 또는 관리자였다. 화면(버튼 표시)과 API(403)가 같은 규칙을 쓴다.
 */
export function canDeleteMemo(memo: { createdBy: string | null }, user: { userId: string; role: string }): boolean {
    return !!memo.createdBy && memo.createdBy === user.userId;
}

export const canEditMemo = canDeleteMemo;

export const MEMO_DELETE_FORBIDDEN = "작성자 본인만 메모를 삭제할 수 있습니다.";
