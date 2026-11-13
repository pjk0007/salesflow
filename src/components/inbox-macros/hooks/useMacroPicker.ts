import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { toEditorHtml } from "@/lib/rich-text/format";
import { useMacros } from "./useMacros";
import { macroTrigger } from "../utils/trigger";

type Trigger = { query: string; from: number; to: number };
/** 커서 앞 같은 줄이 "#검색어"로 끝나면 그 범위 */
function readTrigger(editor: Editor): Trigger | null {
    const { selection } = editor.state;
    if (!selection.empty) return null;
    const { $from } = selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const hit = macroTrigger(before, before.length);
    return hit ? { query: hit.query, from: selection.from - (before.length - hit.start), to: selection.from } : null;
}

/**
 * 입력창에서 #을 치면 사업부 매크로를 골라 넣는다.
 * 위/아래로 고르고 Enter·Tab으로 넣고 Esc로 닫는다. 넣으면 "#검색어"가 매크로 내용으로 바뀐다.
 */
export function useMacroPicker({ workspaceId, editor }: { workspaceId: number | null | undefined; editor: Editor | null }) {
    const { data } = useMacros(workspaceId);
    const [trigger, setTrigger] = useState<Trigger | null>(null);
    const [active, setActive] = useState(0);
    const [closedAt, setClosedAt] = useState<number | null>(null);
    useEffect(() => {
        if (!editor) return;
        const update = () => setTrigger(editor.isFocused || editor.view.hasFocus() ? readTrigger(editor) : null);
        editor.on("transaction", update);
        editor.on("blur", update);
        return () => {
            editor.off("transaction", update);
            editor.off("blur", update);
        };
    }, [editor]);
    const query = trigger?.query.toLowerCase() ?? "";
    const items = (data ?? []).filter((m) => m.name.toLowerCase().includes(query));
    const open = !!trigger && !!data?.length && trigger.from !== closedAt;
    const index = Math.min(active, Math.max(items.length - 1, 0));

    function pick(i = index) {
        const macro = items[i];
        if (!editor || !trigger || !macro) return;
        editor.chain().focus().deleteRange({ from: trigger.from, to: trigger.to }).insertContent(toEditorHtml(macro.body)).run();
        setActive(0);
    }
    /** 매크로 목록이 열려 있을 때 키를 가로채면 true */
    function onKeyDown(e: KeyboardEvent) {
        if (!open || e.isComposing) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const n = items.length || 1;
            setActive((index + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            return true;
        }
        if ((e.key === "Enter" || e.key === "Tab") && items.length && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            pick();
            return true;
        }
        if (e.key === "Escape") {
            setClosedAt(trigger!.from);
            return true;
        }
        return false;
    }
    return { open, items, active: index, setActive, pick, onKeyDown };
}
