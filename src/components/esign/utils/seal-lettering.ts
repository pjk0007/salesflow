/** Original geometric Hangul lettering inspired by carved seals, not a copied seal font. */
type Box = { x: number; y: number; width: number; height: number };
type LetterPart = Box & { letter: string };
const initials = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const vowels = [..."ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"];
const finals = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];
const compoundVowels: Record<string, [string, string]> = { "ㅘ": ["ㅗ", "ㅏ"], "ㅙ": ["ㅗ", "ㅐ"], "ㅚ": ["ㅗ", "ㅣ"], "ㅝ": ["ㅜ", "ㅓ"], "ㅞ": ["ㅜ", "ㅔ"], "ㅟ": ["ㅜ", "ㅣ"], "ㅢ": ["ㅡ", "ㅣ"] };
const pairs: Record<string, [string, string]> = { "ㄲ": ["ㄱ", "ㄱ"], "ㄸ": ["ㄷ", "ㄷ"], "ㅃ": ["ㅂ", "ㅂ"], "ㅆ": ["ㅅ", "ㅅ"], "ㅉ": ["ㅈ", "ㅈ"], "ㄳ": ["ㄱ", "ㅅ"], "ㄵ": ["ㄴ", "ㅈ"], "ㄶ": ["ㄴ", "ㅎ"], "ㄺ": ["ㄹ", "ㄱ"], "ㄻ": ["ㄹ", "ㅁ"], "ㄼ": ["ㄹ", "ㅂ"], "ㄽ": ["ㄹ", "ㅅ"], "ㄾ": ["ㄹ", "ㅌ"], "ㄿ": ["ㄹ", "ㅍ"], "ㅀ": ["ㄹ", "ㅎ"], "ㅄ": ["ㅂ", "ㅅ"] };
const paths: Record<string, string> = {
    "ㄱ": "M12 12H82Q88 12 88 18V88", "ㄴ": "M12 12V82Q12 88 18 88H88",
    "ㄷ": "M88 12H18Q12 12 12 18V82Q12 88 18 88H88", "ㄹ": "M12 12H82Q88 12 88 18V44Q88 50 82 50H18Q12 50 12 56V82Q12 88 18 88H88",
    "ㅁ": "M20 12H80Q88 12 88 20V80Q88 88 80 88H20Q12 88 12 80V20Q12 12 20 12Z", "ㅂ": "M12 12V88H88V12M12 48H88",
    "ㅅ": "M50 12V32Q50 64 12 88M50 32Q50 64 88 88", "ㅇ": "M32 12H68Q88 12 88 32V68Q88 88 68 88H32Q12 88 12 68V32Q12 12 32 12Z",
    "ㅈ": "M12 12H88M50 12V32Q50 64 12 88M50 32Q50 64 88 88", "ㅊ": "M32 10H68M12 30H88M50 30V42Q50 68 12 90M50 42Q50 68 88 90",
    "ㅋ": "M12 12H82Q88 12 88 18V88M12 50H88", "ㅌ": "M88 12H18Q12 12 12 18V82Q12 88 18 88H88M12 50H88",
    "ㅍ": "M12 12H88M12 88H88M28 12V88M72 12V88", "ㅎ": "M32 8H68M12 26H88M34 46H66Q86 46 86 64V72Q86 90 66 90H34Q14 90 14 72V64Q14 46 34 46Z",
    "ㅏ": "M36 10V90M36 50H88", "ㅑ": "M36 10V90M36 32H88M36 68H88", "ㅓ": "M64 10V90M12 50H64", "ㅕ": "M64 10V90M12 32H64M12 68H64",
    "ㅐ": "M24 10V90M24 50H64M76 10V90", "ㅒ": "M24 10V90M24 32H64M24 68H64M76 10V90", "ㅔ": "M52 10V90M12 50H52M84 10V90", "ㅖ": "M52 10V90M12 32H52M12 68H52M84 10V90",
    "ㅗ": "M10 76H90M50 10V76", "ㅛ": "M10 76H90M32 10V76M68 10V76", "ㅜ": "M10 24H90M50 24V90", "ㅠ": "M10 24H90M32 24V90M68 24V90", "ㅡ": "M10 50H90", "ㅣ": "M50 10V90",
};

export function hasEngravedJamo(letter: string): boolean {
    return Object.hasOwn(paths, letter) || (Object.hasOwn(pairs, letter) && pairs[letter].every(hasEngravedJamo));
}

export function engravedSyllable(character: string) {
    const code = (character.codePointAt(0) ?? 0) - 0xac00;
    if (code < 0 || code >= 11172) return undefined;
    const initial = initials[Math.floor(code / 588)], vowel = vowels[Math.floor(code / 28) % 21], final = finals[code % 28];
    const parts: LetterPart[] = [];
    const add = (letter: string, x: number, y: number, width: number, height: number) => parts.push({ letter, x, y, width, height });
    if (compoundVowels[vowel]) {
        const [horizontal, vertical] = compoundVowels[vowel];
        add(initial, 0, 0, .56, final ? .43 : .57);
        add(horizontal, 0, final ? .48 : .64, .58, final ? .2 : .3);
        add(vertical, .64, 0, .36, final ? .68 : 1);
    } else if ("ㅗㅛㅜㅠㅡ".includes(vowel)) {
        add(initial, .08, 0, .84, final ? .43 : .57);
        add(vowel, 0, final ? .48 : .64, 1, final ? .2 : .36);
    } else {
        add(initial, 0, 0, .55, final ? .66 : 1);
        add(vowel, .63, 0, .37, final ? .66 : 1);
    }
    if (final) add(final, .06, .76, .88, .24);
    return { initial, vowel, final, parts };
}

function strokeJamo(context: CanvasRenderingContext2D, letter: string, box: Box) {
    if (pairs[letter]) {
        const [first, second] = pairs[letter];
        strokeJamo(context, first, { ...box, width: box.width * .45 });
        strokeJamo(context, second, { ...box, x: box.x + box.width * .55, width: box.width * .45 });
        return;
    }
    const path = paths[letter]; if (!path) throw new Error("도장 글자를 그리지 못했습니다.");
    const transformed = new Path2D();
    transformed.addPath(new Path2D(path), new DOMMatrix([box.width / 100, 0, 0, box.height / 100, box.x, box.y]));
    context.stroke(transformed);
}

export function drawEngravedCharacter(context: CanvasRenderingContext2D, character: string, cx: number, cy: number, width: number, height: number) {
    const syllable = engravedSyllable(character); if (!syllable) return false;
    context.save(); context.lineWidth = Math.min(width, height) * .051; context.lineCap = "round"; context.lineJoin = "round";
    for (const part of syllable.parts) strokeJamo(context, part.letter, { x: cx - width / 2 + part.x * width, y: cy - height / 2 + part.y * height, width: part.width * width, height: part.height * height });
    context.restore(); return true;
}
