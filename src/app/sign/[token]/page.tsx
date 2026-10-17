import { PublicSigningPage } from "@/components/esign/ui/PublicSigningPage";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <PublicSigningPage token={token} />;
}
