import { InboxError } from "@/lib/inbox/errors";
import {
    array,
    object,
    text,
    date,
    kinds,
    parseCsv,
    validateRows,
    type ImportInput,
    type ImportRow,
    type ImportKind,
} from "./rules";
export function normalizeImport(input: ImportInput) {
    let rows: ImportRow[] = [];
    const warnings: string[] = [],
        errors: string[] = [];
    const add = (
        kind: ImportKind,
        sourceId: unknown,
        data: Record<string, unknown>,
        original: Record<string, unknown>,
    ) => rows.push({ kind, sourceId: String(sourceId ?? ""), data, original });
    if (input.format === "csv") rows = parseCsv(input);
    else {
        let raw;
        try {
            raw = JSON.parse(input.content);
        } catch {
            throw new InboxError("올바른 JSON 자료를 입력해주세요.");
        }
        const bundle = object(raw);
        if (input.source === "portable") {
            for (const kind of kinds)
                for (const item of array(bundle[kind])) {
                    const { id, ...data } = item;
                    add(kind, id, data, item);
                }
        } else if (input.source === "channel") {
            for (const user of array(bundle.users)) {
                const profile = object(user.profile);
                const memberId = text(user.memberId),
                    isMember =
                        user.member !== false &&
                        (user.type === "member" ||
                            (!user.type && user.member === true)) &&
                        memberId !== text(user.veilId);
                if (memberId && !isMember)
                    warnings.push(
                        `고객 ${user.id}: 회원 여부가 확인되지 않은 memberId는 외부 회원 ID로 사용하지 않습니다. 원본은 보존합니다.`,
                    );
                add(
                    "contacts",
                    user.id,
                    {
                        name:
                            text(profile.name) ||
                            text(user.name) ||
                            `고객 ${user.id}`,
                        externalId: isMember ? memberId : undefined,
                        email: text(profile.email),
                        phone: text(profile.mobileNumber),
                        attributes: profile,
                        createdAt: date(user.createdAt),
                    },
                    user,
                );
            }
            const users = new Map(
                    array(bundle.users).map((u) => [String(u.id), u]),
                ),
                managers = new Map(
                    array(bundle.managers).map((u) => [String(u.id), u]),
                ),
                bots = new Map(
                    array(bundle.bots).map((u) => [String(u.id), u]),
                );
            for (const chat of array(bundle.userChats)) {
                const user = users.get(String(chat.userId)),
                    profile = object(user?.profile);
                const state = text(chat.state);
                let status: "open" | "closed" | "snoozed" = "closed";
                if (state === "opened" || state === "open") status = "open";
                else if (state === "snoozed") status = "snoozed";
                else if (["queued", "initial", "missed"].includes(state || "")) {
                    status = "open";
                    warnings.push(
                        `상담 ${chat.id}: 원본 상태 ${state}는 보관 화면의 open으로 표시합니다. 원본 상태는 보존하며 실제 상담을 재개하지 않습니다.`,
                    );
                } else if (state && state !== "closed")
                    errors.push(
                        `상담 ${chat.id}: 지원하지 않는 원본 상태 ${state}입니다. 상태 매핑을 확인해주세요.`,
                    );
                else if (!state)
                    warnings.push(
                        `상담 ${chat.id}: 원본 상태가 없어 보관 화면의 closed로 표시합니다.`,
                    );
                add(
                    "conversations",
                    chat.id,
                    {
                        contactId: text(chat.userId),
                        name:
                            text(chat.title) ||
                            text(chat.name) ||
                            text(profile.name) ||
                            `상담 ${chat.id}`,
                        status,
                        tags: chat.tags || [],
                        createdAt: date(chat.createdAt),
                    },
                    chat,
                );
            }
            for (const message of array(bundle.messages)) {
                const user = users.get(String(message.personId)),
                    manager = managers.get(String(message.personId)),
                    bot = bots.get(String(message.personId)),
                    files = array(message.files);
                const authorName =
                    message.personType === "manager"
                        ? text(manager?.name)
                        : message.personType === "bot"
                          ? text(bot?.name)
                          : message.personType === "user"
                            ? text(object(user?.profile).name) || text(user?.name)
                            : undefined;
                if (!authorName && ["manager", "bot"].includes(String(message.personType)))
                    warnings.push(
                        `메시지 ${message.chatId}/${message.id}: 작성자 이름이 없어 ${message.personType}로 표시합니다. 원본 작성자 ID는 보존합니다.`,
                    );
                if (!text(message.plainText) && array(message.blocks).length)
                    warnings.push(
                        `메시지 ${message.chatId}/${message.id}: 텍스트가 없는 블록 메시지는 원본 JSON에 보존합니다. 보관 화면에서 원본 레이아웃을 재현하지 않습니다.`,
                    );
                const kind =
                    Array.isArray(message.options) &&
                    message.options.includes("private")
                        ? "note"
                        : message.personType === "user"
                          ? "customer"
                          : ["manager", "bot"].includes(
                                  String(message.personType),
                              )
                            ? "reply"
                            : "note";
                add(
                    "messages",
                    message.id ? `${message.chatId}/${message.id}` : "",
                    {
                        conversationId: text(message.chatId),
                        body:
                            text(message.plainText) ||
                            (files.length
                                ? `원본 첨부 ${files.length}개`
                                : JSON.stringify(message.log || "시스템 기록")),
                        messageKind: kind,
                        authorName:
                            authorName ||
                            text(message.personType) ||
                            "원본 상담",
                        createdAt: date(message.createdAt),
                        files,
                    },
                    message,
                );
            }
            if (bundle.next || bundle.nextCursor || bundle.hasNext === true)
                errors.push(
                    "채널톡 다음 페이지가 남아 있습니다. 모든 페이지를 모아 다시 입력해주세요.",
                );
        } else if (input.source === "intercom") {
            for (const company of array(bundle.companies))
                add(
                    "companies",
                    company.id,
                    {
                        name: company.name,
                        externalId: text(company.company_id),
                        attributes: object(company.custom_attributes),
                        createdAt: date(company.created_at),
                    },
                    company,
                );
            for (const contact of array(bundle.contacts))
                add(
                    "contacts",
                    contact.id,
                    {
                        name:
                            text(contact.name) ||
                            text(contact.email) ||
                            `고객 ${contact.id}`,
                        externalId: text(contact.external_id),
                        email: text(contact.email),
                        phone: text(contact.phone),
                        companyIds: array(object(contact.companies).data).map(
                            (c) => String(c.id),
                        ),
                        attributes: object(contact.custom_attributes),
                        createdAt: date(contact.created_at),
                    },
                    contact,
                );
            for (const chat of array(bundle.conversations)) {
                const contacts = array(object(chat.contacts).contacts),
                    source = object(chat.source),
                    parts = object(chat.conversation_parts),
                    items = array(parts.conversation_parts);
                add(
                    "conversations",
                    chat.id,
                    {
                        contactId: text(contacts[0]?.id),
                        name: text(chat.title) || `상담 ${chat.id}`,
                        status:
                            chat.state === "closed"
                                ? "closed"
                                : chat.state === "snoozed"
                                  ? "snoozed"
                                  : "open",
                        createdAt: date(chat.created_at),
                    },
                    chat,
                );
                if (contacts.length > 1)
                    warnings.push(
                        `상담 ${chat.id}: 여러 참여자 중 첫 고객과 연결합니다. 원본 참여자는 보존합니다.`,
                    );
                for (const item of [source, ...items]) {
                    if (!item.id) continue;
                    const author = object(item.author),
                        files = array(item.attachments);
                    add(
                        "messages",
                        `${chat.id}/${item.id}`,
                        {
                            conversationId: String(chat.id),
                            body:
                                text(item.body) ||
                                (files.length
                                    ? `원본 첨부 ${files.length}개`
                                    : `시스템 기록 · ${item.part_type || "source"}`),
                            messageKind:
                                item.part_type === "note"
                                    ? "note"
                                    : ["user", "lead", "contact"].includes(
                                            String(author.type),
                                        )
                                      ? "customer"
                                      : item.part_type === "comment" ||
                                          item === source
                                        ? "reply"
                                        : "note",
                            authorName:
                                text(author.name) ||
                                text(author.type) ||
                                "원본 상담",
                            createdAt: date(item.created_at || chat.created_at),
                            files,
                        },
                        item,
                    );
                }
                if (items.length >= 500) {
                    const message = `상담 ${chat.id}: API의 500개 부분 제한에 걸릴 수 있습니다.`;
                    if (input.allowPartialHistory)
                        warnings.push(message + " 부분 자료로 승인했습니다.");
                    else
                        errors.push(
                            message +
                                " 전체 내보내기 자료를 사용하거나 부분 이전을 명시적으로 확인해주세요.",
                        );
                }
            }
        } else {
            const associations = (
                item: Record<string, unknown>,
                kind: string,
            ) =>
                array(object(item.associations)[kind]).map((v) => String(v.id));
            for (const company of array(bundle.companies)) {
                const p = object(company.properties);
                add(
                    "companies",
                    company.id,
                    {
                        name: p.name,
                        domain: text(p.domain),
                        attributes: p,
                        createdAt: date(company.createdAt),
                    },
                    company,
                );
            }
            for (const contact of array(bundle.contacts)) {
                const p = object(contact.properties);
                add(
                    "contacts",
                    contact.id,
                    {
                        name:
                            [p.firstname, p.lastname]
                                .filter(Boolean)
                                .join(" ") ||
                            text(p.email) ||
                            `고객 ${contact.id}`,
                        email: text(p.email),
                        phone: text(p.phone),
                        companyIds: associations(contact, "companies"),
                        attributes: p,
                        createdAt: date(contact.createdAt),
                    },
                    contact,
                );
            }
            for (const pipeline of array(bundle.pipelines))
                add(
                    "pipelines",
                    pipeline.id,
                    {
                        name: pipeline.label,
                        stages: array(pipeline.stages).map((s) => {
                            const m = object(s.metadata);
                            return {
                                id: String(s.id),
                                name: s.label,
                                category:
                                    m.isClosed === true || m.isClosed === "true"
                                        ? Number(m.probability) === 1
                                            ? "won"
                                            : "lost"
                                        : "open",
                            };
                        }),
                    },
                    pipeline,
                );
            for (const deal of array(bundle.deals)) {
                const p = object(deal.properties);
                add(
                    "deals",
                    deal.id,
                    {
                        title: p.dealname,
                        contactId: associations(deal, "contacts")[0],
                        companyId: associations(deal, "companies")[0],
                        pipelineId: text(p.pipeline),
                        stageId: text(p.dealstage),
                        amount: text(p.amount) || "0",
                        currency:
                            text(p.deal_currency_code) ||
                            text(bundle.defaultCurrency) ||
                            "KRW",
                        expectedCloseDate: date(p.closedate)?.slice(0, 10),
                        notes: text(p.description),
                        createdAt: date(deal.createdAt),
                    },
                    deal,
                );
                if (!p.deal_currency_code && !bundle.defaultCurrency)
                    errors.push(
                        `딜 ${deal.id}: 원본 통화가 없습니다. deal_currency_code 또는 묶음의 defaultCurrency를 지정해주세요.`,
                    );
                if (
                    associations(deal, "contacts").length > 1 ||
                    associations(deal, "companies").length > 1
                )
                    warnings.push(
                        `딜 ${deal.id}: 대표 고객·회사는 첫 관계를 사용하며 나머지 관계는 원본에 보존합니다.`,
                    );
            }
            for (const task of array(bundle.tasks)) {
                const p = object(task.properties);
                add(
                    "tasks",
                    task.id,
                    {
                        title: p.hs_task_subject,
                        body: text(p.hs_task_body),
                        contactId: associations(task, "contacts")[0],
                        companyId: associations(task, "companies")[0],
                        dealId: associations(task, "deals")[0],
                        status:
                            p.hs_task_status === "COMPLETED" ? "done" : "open",
                        dueAt: date(p.hs_timestamp),
                        createdAt: date(task.createdAt),
                    },
                    task,
                );
            }
        }
        for (const kind of kinds) {
            const page = object(bundle[kind]);
            if (object(page.paging).next || object(page.pages).next)
                errors.push(`${kind}: 다음 페이지 자료가 빠져 있습니다.`);
        }
    }
    if (!rows.length)
        throw new InboxError(
            "가져올 자료가 없습니다. 형식과 배열 이름을 확인해주세요.",
        );
    if (rows.length > 10000)
        throw new InboxError(
            "한 번에 10,000행까지 가져올 수 있습니다. 자료를 나눠주세요.",
            413,
        );
    rows.sort(
        (a, b) =>
            kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
            (a.kind === "messages"
                ? String(a.data.conversationId).localeCompare(
                      String(b.data.conversationId),
                  ) ||
                  String(a.data.createdAt).localeCompare(
                      String(b.data.createdAt),
                  ) ||
                  a.sourceId.localeCompare(b.sourceId)
                : 0),
    );
    const normalized = validateRows(rows),
        seen = new Set<string>();
    for (const row of normalized) {
        const key = `${row.kind}:${row.sourceId}`;
        if (seen.has(key)) row.errors.push("같은 자료에 원본 ID가 중복됩니다.");
        seen.add(key);
        if (
            row.kind === "messages" &&
            /<(?:p|div|br|html)\b/i.test(String(row.data.body))
        )
            warnings.push(
                `메시지 ${row.sourceId}: HTML 원문은 텍스트로 표시합니다. 인터컴은 display_as=plaintext로 내보내는 것을 권장합니다.`,
            );
    }
    for (const [kind, count] of Object.entries(input.expectedCounts))
        if (normalized.filter((r) => r.kind === kind).length !== count)
            errors.push(
                `${kind}: 원본 예상 ${count}행과 읽은 건수가 다릅니다.`,
            );
    return {
        rows: normalized,
        warnings: [...new Set(warnings)],
        errors: [...new Set(errors)],
    };
}
