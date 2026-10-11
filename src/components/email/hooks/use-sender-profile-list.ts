import { useState, type ChangeEvent } from "react";
import type { SenderProfile } from "../types/sender-profile";
import { getSenderProfilePage } from "../utils/sender-profile-list";

export function useSenderProfileList(profiles: SenderProfile[]) {
    const [query, setQuery] = useState("");
    const [requestedPage, setRequestedPage] = useState(1);
    const result = getSenderProfilePage(profiles, query, requestedPage);
    const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value);
        setRequestedPage(1);
    };
    const handleClear = () => { setQuery(""); setRequestedPage(1); };
    const handlePrevious = () => setRequestedPage(Math.max(1, result.page - 1));
    const handleNext = () => setRequestedPage(Math.min(result.totalPages, result.page + 1));
    return { ...result, query, handleSearch, handleClear, handlePrevious, handleNext };
}
