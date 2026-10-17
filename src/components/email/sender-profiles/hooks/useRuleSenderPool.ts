"use client";

import { useState } from "react";
import type { RuleSenderPool, SavedSenderPool } from "../types";
import { formSenderIds } from "../utils/senderPool";

export function useRuleSenderPool(saved?: SavedSenderPool | null): RuleSenderPool {
    const [edited, setIds] = useState<number[] | null>(null);
    return { ids: formSenderIds(edited, saved), setIds };
}
