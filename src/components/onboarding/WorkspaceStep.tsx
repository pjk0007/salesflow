import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import IconPicker from "@/components/ui/icon-picker";

interface WorkspaceStepProps {
    workspaceName: string;
    workspaceIcon: string;
    onNameChange: (value: string) => void;
    onIconChange: (value: string) => void;
}

export default function WorkspaceStep({
    workspaceName,
    workspaceIcon,
    onNameChange,
    onIconChange,
}: WorkspaceStepProps) {
    return (
        <div className="space-y-6 text-center">
            <div>
                <h2 className="text-2xl font-bold">워크스페이스를 만들어보세요</h2>
                <p className="mt-2 text-muted-foreground">
                    데이터를 관리할 공간입니다.
                </p>
            </div>

            <div className="space-y-4 text-left">
                <div className="space-y-2">
                    <Label htmlFor="wsName">워크스페이스 이름</Label>
                    <Input
                        id="wsName"
                        value={workspaceName}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="워크스페이스 이름을 입력하세요"
                    />
                </div>

                <div className="space-y-2">
                    <Label>아이콘</Label>
                    <IconPicker value={workspaceIcon} onChange={onIconChange} />
                </div>
            </div>
        </div>
    );
}
