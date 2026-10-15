/** A site CTA proposes text; it never overwrites an existing customer sentence. */
export function mergeCustomerDraftText(text: string, suggestion: string, incoming: string) {
    return text.trim() && text !== incoming
        ? { text, suggestion: incoming }
        : { text: incoming, suggestion };
}
