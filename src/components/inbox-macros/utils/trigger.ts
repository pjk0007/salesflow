/** 커서 바로 앞이 "#검색어"면 그 위치와 검색어를 돌려준다 (줄 처음이나 띄어쓰기 뒤의 #만) */
export function macroTrigger(text: string, caret: number) {
    const m = /(^|\s)#([^\s#]*)$/.exec(text.slice(0, caret));
    return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}
