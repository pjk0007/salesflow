import { PublicSigningPage } from "@/components/esign/ui/PublicSigningPage";

export default async function SignPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ preview?: string }> }) {
    const { token } = await params;
    return <PublicSigningPage token={token} preview={(await searchParams).preview === "1"} />;
}
