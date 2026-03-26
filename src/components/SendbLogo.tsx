export function SendbIcon({ className = "size-5" }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" className={className}>
            <defs>
                <linearGradient id="sf-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#sf-grad)" />
            <path d="M9 23L16 7l7 16-7-3.5L9 23z" fill="white" fillOpacity="0.9" />
        </svg>
    );
}
