import { test } from "node:test";
import assert from "node:assert/strict";
import { StaffDraftSession } from "./staff-draft-session";
import { SessionTransitionQueue } from "./session-transition-queue";
import type { FileDraft } from "./useAttachmentDrafts";
import type { ChatAttachment } from "../types";

const file = (name = "draft.pdf"): FileDraft => ({ clientId: crypto.randomUUID(), file: new File(["synthetic attachment"], name, { type: "application/pdf" }) });
const uploaded = { id: "attachment-1" } as ChatAttachment;

test("conversation subscribers can leave/return without losing File identity, uploads, text or in-flight send", () => {
    const session = new StaffDraftSession();
    const draft = { ...file(), uploaded };
    session.update("a:reply", () => [draft]);
    session.setText("a:reply", "A original draft");
    let renders = 0;
    const leaveA = session.subscribe(() => { renders++; });
    const first = session.begin("a:reply", "same payload")!;
    leaveA();
    session.update("b:note", () => [file("b.pdf")]);
    session.setText("b:note", "B note");
    const leaveB = session.subscribe(() => { renders++; });
    assert.equal(session.getSnapshot().groups["a:reply"][0].file, draft.file);
    assert.equal(session.getSnapshot().groups["a:reply"][0].uploaded, uploaded);
    assert.equal(session.getSnapshot().text["a:reply"], "A original draft");
    assert.equal(session.begin("a:reply", "same payload"), null);
    first.complete();
    first.finish();
    assert.deepEqual(session.getSnapshot().groups["a:reply"], []);
    assert.equal(session.getSnapshot().text["a:reply"], "");
    assert.equal(session.getSnapshot().text["b:note"], "B note");
    assert.equal(session.getSnapshot().groups["b:note"].length, 1);
    assert.equal(session.getSnapshot().completed["a:reply"], 1);
    assert.ok(renders >= 2);
    leaveB();
});

test("uncertain message response retries keep clientId and uploaded IDs after returning; edited payload gets a new ID", () => {
    const session = new StaffDraftSession();
    const draft = { ...file(), uploaded };
    session.update("a:reply", () => [draft]);
    const first = session.begin("a:reply", "body/files/AI/email/mentions fingerprint")!;
    first.finish(); // The server may already have committed; retain the retry identity.
    const retry = session.begin("a:reply", "body/files/AI/email/mentions fingerprint")!;
    assert.equal(retry.clientId, first.clientId);
    assert.equal(session.getSnapshot().groups["a:reply"][0].uploaded!.id, uploaded.id);
    first.finish(); // An old completion cannot unlock a newer attempt.
    assert.equal(session.getSnapshot().pending["a:reply"]!.busy, true);
    retry.finish();
    const changed = session.begin("a:reply", "edited payload")!;
    assert.notEqual(changed.clientId, first.clientId);
});

for (const reason of ["account", "organization", "channel", "page exit", "permission"]) {
    test(`${reason} invalidation aborts and prevents a late upload from starting a message or repopulating files`, async () => {
        const session = new StaffDraftSession();
        session.update("a:reply", () => [file()]);
        session.setText("a:reply", "private draft");
        const operation = session.begin("a:reply", "payload")!;
        let release!: () => void;
        const delayed = new Promise<void>((resolve) => { release = resolve; });
        let posted = 0;
        const send = (async () => {
            await delayed; // A transport can resolve even after AbortController.abort().
            operation.assertCurrent();
            posted++;
            operation.complete();
        })();
        session.invalidate();
        assert.equal(operation.signal.aborted, true);
        assert.equal(session.getSnapshot().active, false);
        session.activate(); // StrictMode/re-entering cannot revive the old epoch.
        session.update("b:reply", () => [file("new.pdf")]);
        release();
        await assert.rejects(send, { name: "AbortError" });
        operation.finish();
        assert.equal(posted, 0);
        assert.equal(session.getSnapshot().groups["a:reply"], undefined);
        assert.equal(session.getSnapshot().text["a:reply"], undefined);
        assert.equal(session.getSnapshot().groups["b:reply"].length, 1);
    });
}

test("temporary errors retain drafts; authentication/permission failures erase them and abort writes", () => {
    const session = new StaffDraftSession();
    session.update("a:reply", () => [file()]);
    const operation = session.begin("a:reply", "payload")!;
    session.requestFailed({ status: 503 });
    assert.equal(operation.isCurrent(), true);
    assert.equal(session.getSnapshot().groups["a:reply"].length, 1);
    session.requestFailed({ status: 403 });
    assert.equal(operation.isCurrent(), false);
    assert.deepEqual(session.getSnapshot().groups, {});
    session.activate();
    session.update("b:reply", () => [file()]);
    session.requestFailed({ status: 401 });
    assert.deepEqual(session.getSnapshot().groups, {});
});

test("bounded session rejects new files instead of evicting existing drafts", () => {
    const session = new StaffDraftSession();
    for (let i = 0; i < 4; i++) session.update(`${i}:reply`, () => Array.from({ length: 5 }, () => file()));
    assert.throws(() => session.update("extra:reply", () => [file()]), /20개/);
    assert.equal(Object.values(session.getSnapshot().groups).flat().length, 20);
    const large = new StaffDraftSession();
    const virtualFile = (size: number) => ({ clientId: crypto.randomUUID(), file: { size } as File });
    large.update("a:reply", () => [virtualFile(100 * 1024 * 1024)]);
    assert.throws(() => large.update("b:reply", () => [virtualFile(1)]), /100MB/);
    assert.equal(large.getSnapshot().groups["a:reply"].length, 1);
});

const deferred = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
};

for (const next of ["logout", "switch B"]) {
    test(`switch A followed by ${next} serializes cookie writes, suppresses stale follow-up and never reopens the inbox between them`, async () => {
        let changing = false;
        const events: string[] = [];
        const queue = new SessionTransitionQueue(
            () => { changing = true; events.push("invalidate"); },
            () => { changing = false; events.push("idle"); },
        );
        const firstResponse = deferred(), nextResponse = deferred(), nextStarted = deferred();
        const first = queue.run(async (isLatest) => {
            events.push("request A");
            await firstResponse.promise;
            if (isLatest()) events.push("old refresh/router");
        });
        await Promise.resolve();
        const second = queue.run(async (isLatest) => {
            events.push(`request ${next}`);
            nextStarted.release();
            await nextResponse.promise;
            assert.equal(isLatest(), true);
            events.push("latest follow-up");
        });
        assert.deepEqual(events, ["invalidate", "request A", "invalidate"]);
        firstResponse.release();
        await nextStarted.promise;
        await first;
        assert.equal(changing, true);
        assert.equal(events.includes("old refresh/router"), false);
        assert.equal(events.includes("idle"), false);
        nextResponse.release();
        await second;
        assert.equal(changing, false);
        assert.equal(events.filter((value) => value === "idle").length, 1);
        assert.deepEqual(events.slice(-2), ["latest follow-up", "idle"]);
    });
}

test("failed transition still allows queued logout and invalidates the old draft scope before either response", async () => {
    const session = new StaffDraftSession();
    session.update("a:reply", () => [file()]);
    const operation = session.begin("a:reply", "payload")!;
    let idle = 0, logout = 0;
    const queue = new SessionTransitionQueue(() => session.invalidate(), () => { idle++; });
    const first = queue.run(async () => { throw new Error("network failure"); });
    const failed = assert.rejects(first, /network failure/);
    const second = queue.run(async () => { logout++; });
    assert.equal(operation.signal.aborted, true);
    assert.deepEqual(session.getSnapshot().groups, {});
    await failed;
    await second;
    assert.equal(logout, 1);
    assert.equal(idle, 1);
});
