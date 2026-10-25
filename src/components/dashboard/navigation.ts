import { Home, Table2, MessageSquare, Mail, Package, FileText, FileSignature, Building2, CreditCard, Layers, History, Activity, Ban } from "lucide-react";

export const navItems = [
    { href: "/", label: "홈", icon: Home },
    { href: "/records", label: "레코드", icon: Table2 },
    { href: "/inbox", label: "고객 상담", icon: MessageSquare },
    { href: "/customer-crm", label: "고객 관리", icon: Building2 },
    { href: "/alimtalk", label: "알림톡", icon: MessageSquare },
    { href: "/email", label: "이메일", icon: Mail },
    { href: "/email/unsubscribes", label: "수신거부 목록", icon: Ban },
    { href: "/esign", label: "전자서명", icon: FileSignature },
    { href: "/products", label: "제품 관리", icon: Package },
    { href: "/web-forms", label: "웹 폼", icon: FileText },
    { href: "/tracker", label: "트래커", icon: Activity },
    { href: "/logs", label: "발송 이력", icon: History },
];

export const bottomNavItems = [
    { href: "/settings/workspace", label: "워크스페이스", icon: Layers },
    { href: "/settings/billing", label: "요금제", icon: CreditCard },
    { href: "/settings/organization", label: "조직 설정", icon: Building2 },
];

const routeLabels: Record<string, string> = {
    ...Object.fromEntries([...navItems, ...bottomNavItems].map(({ href, label }) => [href, label])),
    "/customer-ai": "상담 AI",
    "/customer-imports": "고객 가져오기",
    "/customer-webhooks": "고객 웹훅",
    "/customer-workflows": "고객 자동화",
    "/settings": "설정",
    "/admin": "관리자",
};

const segmentLabels: Record<string, string> = {
    profile: "프로필", templates: "템플릿", links: "연결", "ai-auto": "AI 자동발송",
    new: "새로 만들기", visitors: "방문자", journey: "고객 여정", edit: "수정",
    users: "사용자", organizations: "조직", payments: "결제", plans: "요금제",
    contracts: "계약", settings: "설정", versions: "버전",
};

const INTERNAL_ID = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// 이 경로들은 독립 페이지 대신 상위 화면의 탭에서 목록을 제공한다.
const ancestorLinks: Record<string, string> = {
    "/email/templates": "/email?tab=templates",
    "/email/links": "/email?tab=links",
    "/email/ai-auto": "/email?tab=ai-auto",
    "/alimtalk/templates": "/alimtalk?tab=templates",
    "/alimtalk/links": "/alimtalk?tab=links",
    "/tracker/visitors": "/tracker",
};

export function getBreadcrumbItems(pathname: string, overrides: Record<string, string> = {}) {
    const segments = pathname.split("/").filter(Boolean);
    return segments.map((segment, index) => {
        const href = "/" + segments.slice(0, index + 1).join("/");
        return {
            href: ancestorLinks[href] || href,
            label: overrides[segment] || routeLabels[href] || segmentLabels[segment] ||
                (INTERNAL_ID.test(segment) ? "상세" : segment),
        };
    });
}
