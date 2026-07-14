import { Suspense } from "react";
import { UnsubscribeCard } from "@/components/email/unsubscribe/ui/UnsubscribeCard";

export default function UnsubscribePage() {
    return (
        <Suspense>
            <UnsubscribeCard />
        </Suspense>
    );
}
