import { Fragment, type ReactNode } from "react";
import { parseBlocks, type Inline } from "@/lib/rich-text/format";

function inline(nodes: Inline[]): ReactNode[] {
    return nodes.map((n, i) => {
        if (n.t === "text") return <Fragment key={i}>{n.v}</Fragment>;
        if (n.t === "code")
            return (
                <code key={i} className="rounded bg-black/10 px-1 py-px text-[0.9em]">
                    {n.v}
                </code>
            );
        if (n.t === "link")
            return (
                <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {inline(n.c)}
                </a>
            );
        return n.t === "b" ? <strong key={i}>{inline(n.c)}</strong> : <em key={i}>{inline(n.c)}</em>;
    });
}

/** 상담 메시지 본문을 서식(굵게·기울임·코드·링크·목록)대로 보여준다. 줄바꿈은 그대로 */
export function FormattedText({ text }: { text: string }) {
    return parseBlocks(text).map((b, i) =>
        b.t === "ul" ? (
            <ul key={i} className="list-disc pl-5">
                {b.items.map((item, j) => (
                    <li key={j}>{inline(item)}</li>
                ))}
            </ul>
        ) : (
            <span key={i} className="block min-h-[1lh]">
                {inline(b.c)}
            </span>
        ),
    );
}
