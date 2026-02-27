import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InviteStepProps {
    emails: string[];
    onEmailChange: (index: number, value: string) => void;
}

export default function InviteStep({ emails, onEmailChange }: InviteStepProps) {
    return (
        <div className="space-y-6 text-center">
            <div>
                <h2 className="text-2xl font-bold">팀원을 초대해보세요</h2>
                <p className="mt-2 text-muted-foreground">
                    나중에 설정에서도 초대할 수 있어요.
                </p>
            </div>

            <div className="space-y-3 text-left">
                {emails.map((email, i) => (
                    <div key={i} className="space-y-1">
                        <Label htmlFor={`email-${i}`}>이메일 {i + 1}</Label>
                        <Input
                            id={`email-${i}`}
                            type="email"
                            value={email}
                            onChange={(e) => onEmailChange(i, e.target.value)}
                            placeholder="team@example.com"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
