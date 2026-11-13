/** 서식 편집기 문서(JSON) → 메시지 본문 글자. 읽는 쪽은 src/lib/rich-text/format.ts */
export type DocNode = {
    type: string;
    text?: string;
    content?: DocNode[];
    marks?: { type: string; attrs?: Record<string, unknown> }[];
};
type Mark = { key: string; open: string; close: string };
const ORDER = ["link", "bold", "italic", "code"];

function marksOf(node: DocNode): Mark[] {
    return (node.marks ?? [])
        .filter((m) => ORDER.includes(m.type))
        .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))
        .map((m) => {
            if (m.type === "link") {
                const href = String(m.attrs?.href ?? "");
                return { key: `link:${href}`, open: "[", close: `](${href})` };
            }
            const s = m.type === "bold" ? "**" : m.type === "italic" ? "*" : "`";
            return { key: m.type, open: s, close: s };
        });
}

function inline(nodes: DocNode[] = []): string {
    let out = "";
    const stack: Mark[] = [];
    // 닫는 표시는 끝 공백 앞에 둔다 ("**글자 **"가 아니라 "**글자** ")
    const closeTo = (depth: number) => {
        if (stack.length <= depth) return;
        const ws = /\s*$/.exec(out)![0];
        out = out.slice(0, out.length - ws.length);
        while (stack.length > depth) out += stack.pop()!.close;
        out += ws;
    };
    for (const node of nodes) {
        if (node.type === "hardBreak") {
            closeTo(0);
            out += "\n";
            continue;
        }
        if (node.type !== "text" || !node.text) continue;
        const want = marksOf(node);
        let keep = 0;
        while (keep < stack.length && keep < want.length && stack[keep].key === want[keep].key) keep++;
        closeTo(keep);
        let text = node.text;
        if (want.length > stack.length) {
            const lead = /^\s*/.exec(text)![0];
            out += lead;
            text = text.slice(lead.length);
            for (const m of want.slice(stack.length)) {
                out += m.open;
                stack.push(m);
            }
        }
        out += text;
    }
    closeTo(0);
    return out;
}

export function docToMarkdown(doc: DocNode): string {
    const lines: string[] = [];
    for (const block of doc.content ?? []) {
        if (block.type === "bulletList" || block.type === "orderedList")
            for (const item of block.content ?? [])
                lines.push(`- ${(item.content ?? []).map((p) => inline(p.content)).join(" ")}`);
        else lines.push(inline(block.content));
    }
    // 편집기가 끝에 두는 빈 줄은 뺀다
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    return lines.join("\n");
}
