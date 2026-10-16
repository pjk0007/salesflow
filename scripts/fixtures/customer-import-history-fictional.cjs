/* eslint-disable @typescript-eslint/no-require-imports -- Fictional source records and local file bytes only. */
const { createHash } = require("node:crypto");
const PRIVATE = "PRIVATE_IMPORTED_NOTE_SENTINEL";
const PRIVATE_TITLE = "PRIVATE_ADMIN_TITLE_SENTINEL";
const PRIVATE_FILE = "PRIVATE_NOTE_ATTACHMENT_SENTINEL.png";
const RAW_PROFILE = "PRIVATE_RAW_PROFILE_SENTINEL";
const AT = "2024-01-02T03:04:05.000Z";
const pdf = Buffer.from("%PDF-1.4\nFictional customer history attachment only\n%%EOF");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPd8AAAAASUVORK5CYII=", "base64");
const files = [
    { id: "public-customer", name: "허구 고객 자료.pdf", bytes: pdf, visibility: "public", kind: "customer" },
    { id: "public-reply", name: "허구 직원 답변.png", bytes: png, visibility: "public", kind: "reply" },
    { id: "private-note", name: PRIVATE_FILE, bytes: png, visibility: "private", kind: "note" },
];
const descriptor = file => ({ id: file.id, name: file.name, size: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex"), url: `https://files.example.test/fictional/${file.id}?signature=fictional-source-only` });
function channelFixture({ business = "dh", conversations = 52, messages = 121, memberId = "fictional-history-member-a", otherId = "fictional-history-member-b", colleagueId = "fictional-history-colleague" } = {}) {
    const users = [
        { id: "source-a", type: "member", member: true, memberId, veilId: "fictional-veil-a" },
        { id: "source-b", type: "member", member: true, memberId: otherId, veilId: "fictional-veil-b" },
        { id: "source-colleague", type: "member", member: true, memberId: colleagueId, veilId: "fictional-veil-colleague" },
        { id: "email-name-only", type: "lead", member: false },
        { id: "unconfirmed-member", type: "lead", member: false, memberId },
        { id: "veil-collision", type: "veil", memberId, veilId: memberId },
        { id: "missing-member-id", type: "member", member: true },
    ].map(user => ({ ...user, profile: { name: "허구 동일 표시명", email: "fictional-same@example.test", privateFixture: RAW_PROFILE }, createdAt: Date.parse(AT) }));
    const bundle = { users, managers: [{ id: "fictional-manager", name: "허구 이전 상담원" }], bots: [], userChats: [], messages: [], hasNext: false };
    const publicChats = [], hiddenChats = [];
    function addChat(id, userId, amount, { noteOnly = false, attachments = false } = {}) {
        bundle.userChats.push({ id, userId, title: PRIVATE_TITLE, state: "closed", createdAt: Date.parse(AT) });
        if (!noteOnly) for (let index = 0; index < amount; index++) {
            const kind = index % 2 === 0 ? "user" : "manager";
            const file = attachments && index < 2 ? files[index] : null;
            // Source chronology intentionally runs against insert/ID order; groups
            // of three also put the 100-message page boundary inside a timestamp tie.
            bundle.messages.push({ id: `public-${index}`, chatId: id, personType: kind, personId: kind === "user" ? userId : "fictional-manager", plainText: `${business} 허구 공개 ${index === 0 ? "문의" : "메시지"} ${id}/${index}`, createdAt: Date.parse(AT) - Math.floor(index / 3) * 1000, ...(file ? { files: [descriptor(file)] } : {}) });
        }
        bundle.messages.push({ id: "private-note", chatId: id, personType: "manager", personId: "fictional-manager", plainText: `${PRIVATE} ${id}`, options: ["private"], createdAt: Date.parse(AT) + 3600000, ...(attachments ? { files: [descriptor(files[2])] } : {}) });
    }
    for (let index = 0; index < conversations; index++) {
        const id = `history-a-${String(index).padStart(3, "0")}`;
        addChat(id, "source-a", index === 0 ? messages : 2, { attachments: index === 0 }); publicChats.push(id);
    }
    for (const user of users.filter(value => value.id !== "source-a")) {
        const id = `excluded-${user.id}`; addChat(id, user.id, 2); hiddenChats.push(id);
    }
    addChat("note-only", "source-a", 0, { noteOnly: true }); hiddenChats.push("note-only");
    return { fictional: true, business, memberId, otherId, colleagueId, bundle, publicChats, hiddenChats, files };
}
module.exports = { channelFixture, files, PRIVATE, PRIVATE_TITLE, PRIVATE_FILE, RAW_PROFILE, AT };
