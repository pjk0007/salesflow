/**
 * 레코드 메모 삭제 권한 — 작성자 본인 또는 관리자(owner·admin)만 지울 수 있다(UX-059).
 * 화면(삭제 버튼 표시)과 API(403)가 같은 규칙을 쓴다.
 */
export function canDeleteMemo(memo: { createdBy: string | null }, user: { userId: string; role: string }): boolean {
    if (user.role === "owner" || user.role === "admin") return true;
    return !!memo.createdBy && memo.createdBy === user.userId;
}

export const MEMO_DELETE_FORBIDDEN = "작성자 본인이나 관리자만 메모를 삭제할 수 있습니다.";
