import type { FieldType } from "@/types";

export interface FieldTemplateItem {
    key: string;
    label: string;
    fieldType: FieldType;
    category?: string;
    isRequired?: boolean;
    options?: string[];
}

export interface FieldTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;
    fields: FieldTemplateItem[];
}

export const FIELD_TEMPLATES: FieldTemplate[] = [
    {
        id: "b2b-sales",
        name: "B2B 영업",
        description: "기업 대상 영업 관리에 필요한 기본 속성",
        icon: "Building2",
        fields: [
            { key: "companyName", label: "회사명", fieldType: "text", isRequired: true },
            { key: "contactName", label: "담당자명", fieldType: "text", isRequired: true },
            { key: "contactTitle", label: "직책", fieldType: "text" },
            { key: "phone", label: "전화번호", fieldType: "phone" },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "address", label: "회사주소", fieldType: "text" },
            { key: "salesStage", label: "영업단계", fieldType: "select", options: ["리드", "미팅", "제안", "협상", "계약", "완료", "실패"] },
            { key: "expectedAmount", label: "예상금액", fieldType: "currency" },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
    {
        id: "b2c-sales",
        name: "B2C 영업",
        description: "개인 고객 대상 영업 관리",
        icon: "UserRound",
        fields: [
            { key: "customerName", label: "고객명", fieldType: "text", isRequired: true },
            { key: "phone", label: "전화번호", fieldType: "phone", isRequired: true },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "address", label: "주소", fieldType: "text" },
            { key: "interest", label: "관심상품", fieldType: "text" },
            { key: "status", label: "상태", fieldType: "select", options: ["상담중", "구매예정", "구매완료", "이탈"] },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
    {
        id: "real-estate",
        name: "부동산",
        description: "부동산 매물 및 고객 관리",
        icon: "Home",
        fields: [
            { key: "customerName", label: "고객명", fieldType: "text", isRequired: true },
            { key: "phone", label: "전화번호", fieldType: "phone", isRequired: true },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "region", label: "관심지역", fieldType: "text" },
            { key: "budget", label: "예산", fieldType: "currency" },
            { key: "propertyType", label: "매물유형", fieldType: "select", options: ["아파트", "빌라", "오피스텔", "상가", "토지", "기타"] },
            { key: "contractStatus", label: "계약상태", fieldType: "select", options: ["상담", "매물확인", "계약진행", "계약완료", "취소"] },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
    {
        id: "hr-management",
        name: "인력 관리",
        description: "직원 및 인력 정보 관리",
        icon: "Users",
        fields: [
            { key: "name", label: "이름", fieldType: "text", isRequired: true },
            { key: "phone", label: "전화번호", fieldType: "phone" },
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "department", label: "소속", fieldType: "text" },
            { key: "position", label: "직급", fieldType: "text" },
            { key: "joinDate", label: "입사일", fieldType: "date" },
            { key: "status", label: "상태", fieldType: "select", options: ["재직", "휴직", "퇴직"] },
            { key: "memo", label: "메모", fieldType: "textarea" },
        ],
    },
];
