import { emailAddress } from "./rules";
import { InboxError } from "@/lib/inbox/errors";

/** 다른 사업의 봉투·본문을 기본 메일함에 저장하기 전에 거부한다. */
export class OtherMailboxRecipientError extends InboxError {
    constructor() { super("다른 사업 문의 주소로 수신한 메일입니다.", 409); }
}

export function isOtherMailboxRecipient(
    box: { address: string; googleAccount?: string | null },
    input: { to: string[]; cc: string[]; deliveredTo?: string[] },
    otherAddresses: string[],
) {
    if (box.address !== googleAccountAddress(box)) return false;
    const explicit = [...input.to, ...input.cc];
    return !explicit.includes(box.address) &&
        explicit.some((address) => otherAddresses.includes(address));
}

export function googleAccountAddress(box: {
    address: string;
    googleAccount?: string | null;
}) {
    return emailAddress.parse(box.googleAccount || box.address);
}

/** Read only: Gmail's existing verified Send Mail As entries; never create aliases. */
export async function assertGoogleAlias(
    address: string,
    account: string,
    accessToken: string,
    fetchImpl: typeof fetch = fetch,
) {
    if (address === account) return;
    const response = await fetchImpl(
        "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
        {
            headers: { authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(15000),
        },
    );
    if (!response.ok)
        throw new Error("Gmail 발신 주소 인증 상태를 확인하지 못했습니다.");
    const body = (await response.json()) as {
        sendAs?: { sendAsEmail?: string; verificationStatus?: string }[];
    };
    if (
        !body.sendAs?.some(
            (alias) =>
                alias.sendAsEmail?.toLowerCase() === address &&
                alias.verificationStatus === "accepted",
        )
    )
        throw new Error(
            "Google 계정에 이 사업의 문의 주소를 인증된 발신 주소로 먼저 등록해주세요.",
        );
}
