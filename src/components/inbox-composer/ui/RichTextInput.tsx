"use client";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Code, Italic, Link2, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { toEditorHtml } from "@/lib/rich-text/format";
import { docToMarkdown, type DocNode } from "../utils/serialize";
import { LinkForm } from "./LinkForm";

/**
 * 상담 답장 입력창 — 글자를 드래그하면 굵게·기울임·코드·목록·링크 도구가 뜬다.
 * 글자를 고른 채 주소를 붙여넣으면 그 글자가 링크가 된다. 값은 서식 표시가 든 글자(format.ts)로 주고받는다.
 */
export function RichTextInput({
    value,
    onChange,
    placeholder,
    disabled,
    ariaLabel,
    onKeyDown,
    onBlur,
    onEditor,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    disabled?: boolean;
    ariaLabel: string;
    /** true를 돌려주면 편집기 기본 동작을 막는다 */
    onKeyDown?: (event: KeyboardEvent) => boolean;
    onBlur?: () => void;
    onEditor?: (editor: Editor | null) => void;
    className?: string;
}) {
    const last = useRef(value);
    const handlers = useRef({ onChange, onKeyDown, onBlur, placeholder });
    useEffect(() => {
        handlers.current = { onChange, onKeyDown, onBlur, placeholder };
    });
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: false,
                codeBlock: false,
                blockquote: false,
                horizontalRule: false,
                strike: false,
                underline: false,
                orderedList: false,
                link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
            }),
            // 플러그인이 그릴 때 부르는 함수라 렌더 중에 읽지 않는다
            // eslint-disable-next-line react-hooks/refs
            Placeholder.configure({ placeholder: () => handlers.current.placeholder, showOnlyWhenEditable: false }),
        ],
        content: toEditorHtml(value),
        editable: !disabled,
        editorProps: {
            attributes: { "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true", class: "rich-input outline-none" },
            handleKeyDown: (_view, event) => handlers.current.onKeyDown?.(event) ?? false,
            // 파일은 입력창 바깥 처리기(첨부)가 받는다
            handleDrop: (_view, event) => !!(event as DragEvent).dataTransfer?.files?.length,
        },
        onUpdate: ({ editor }) => {
            const md = docToMarkdown(editor.getJSON() as DocNode);
            last.current = md;
            handlers.current.onChange(md);
        },
        onBlur: () => handlers.current.onBlur?.(),
    });
    useEffect(() => {
        onEditor?.(editor);
        return () => onEditor?.(null);
    }, [editor, onEditor]);
    // 바깥에서 값이 바뀌면(다른 상담으로 이동·전송 후 비움·AI 초안) 편집기에 다시 넣는다
    useEffect(() => {
        if (!editor || value === last.current) return;
        last.current = value;
        editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
    }, [editor, value]);
    useEffect(() => {
        editor?.setEditable(!disabled);
    }, [editor, disabled]);
    useEffect(() => {
        if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
    }, [editor, placeholder]);

    return (
        <div className={cn("text-sm", className)}>
            {editor && <Toolbar editor={editor} />}
            <EditorContent editor={editor} />
        </div>
    );
}

function Toolbar({ editor }: { editor: Editor }) {
    const [link, setLink] = useState<{ from: number; to: number; text: string; href: string } | null>(null);
    const active = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            code: e.isActive("code"),
            list: e.isActive("bulletList"),
            link: e.isActive("link"),
        }),
    });
    const tool = (on: boolean) =>
        cn("flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted", on ? "bg-muted text-foreground" : "text-muted-foreground");
    return (
        <BubbleMenu
            editor={editor}
            options={{ placement: "top", offset: 8 }}
            shouldShow={({ editor: e, state }) => !!link || (!state.selection.empty && e.isEditable)}
            className="z-30"
        >
            {link ? (
                <LinkForm
                    initial={link}
                    onCancel={() => {
                        setLink(null);
                        editor.commands.focus();
                    }}
                    onSubmit={({ href, text }) => {
                        const chain = editor.chain().focus();
                        // 넣은 뒤엔 커서를 링크 바로 뒤로 옮겨, 이어 쓰는 글자가 링크를 덮지 않게 한다
                        if (text === link.text) chain.setTextSelection({ from: link.from, to: link.to }).extendMarkRange("link").setLink({ href }).setTextSelection(link.to);
                        else
                            chain.insertContentAt(
                                { from: link.from, to: link.to },
                                { type: "text", text, marks: [{ type: "link", attrs: { href } }] },
                            );
                        chain.run();
                        setLink(null);
                    }}
                />
            ) : (
                <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-background p-1">
                    <button type="button" title="굵게" aria-label="굵게" className={tool(!!active?.bold)} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}>
                        <Bold size={16} />
                    </button>
                    <button type="button" title="기울임" aria-label="기울임" className={tool(!!active?.italic)} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}>
                        <Italic size={16} />
                    </button>
                    <button type="button" title="코드" aria-label="코드" className={tool(!!active?.code)} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleCode().run()}>
                        <Code size={16} />
                    </button>
                    <button type="button" title="목록" aria-label="목록" className={tool(!!active?.list)} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBulletList().run()}>
                        <List size={16} />
                    </button>
                    <button
                        type="button"
                        title="링크"
                        aria-label="링크"
                        className={tool(!!active?.link)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            const { from, to } = editor.state.selection;
                            setLink({ from, to, text: editor.state.doc.textBetween(from, to, " "), href: String(editor.getAttributes("link").href ?? "") });
                        }}
                    >
                        <Link2 size={16} />
                    </button>
                </div>
            )}
        </BubbleMenu>
    );
}
