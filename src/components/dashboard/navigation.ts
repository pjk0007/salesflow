import { Home, Table2, MessageSquare, MessageCircle, Mail, Package, FileText, FileSignature, Building2, CreditCard, Layers, History, Activity, Ban, Users, BarChart3, TrendingUp, Briefcase, ListTodo, Contact, Bot, Settings2, Store } from "lucide-react";

export type NavItem = { href: string; label: string; icon: typeof Home };

/** 사이드바 메뉴 묶음 (genius-hub-erp처럼 그룹 제목 + 메뉴). group이 없으면 제목 없이 */
export const navGroups: Array<{ group?: string; items: NavItem[] }> = [
    { items: [{ href: "/", label: "홈", icon: Home }] },
    {
        group: "리드젠",
        items: [
            { href: "/leadgen/stats", label: "리드젠통계", icon: TrendingUp },
            { href: "/records", label: "레코드", icon: Table2 },
            { href: "/email", label: "이메일", icon: Mail },
            { href: "/email/unsubscribes", label: "수신거부 목록", icon: Ban },
            { href: "/web-forms", label: "웹 폼", icon: FileText },
        ],
    },
    {
        group: "리드관리",
        items: [
            { href: "/leads/stats", label: "리드통계", icon: TrendingUp },
            { href: "/leads", label: "리드관리", icon: Users },
        ],
    },
    {
        group: "영업관리",
        items: [
            { href: "/sales", label: "영업고객", icon: Briefcase },
            { href: "/sales/todo", label: "영업ToDo", icon: ListTodo },
        ],
    },
    {
        group: "고객관리",
        items: [
            { href: "/inbox", label: "고객 상담", icon: MessageSquare },
            { href: "/inbox/stats", label: "상담통계", icon: TrendingUp },
            { href: "/inbox/settings", label: "상담 설정", icon: Settings2 },
            { href: "/customer-contacts", label: "고객 연락처", icon: Contact },
            { href: "/customer-ai", label: "AI 응대", icon: Bot },
            { href: "/alimtalk", label: "알림톡", icon: MessageCircle },
            { href: "/customer-crm", label: "고객 관리", icon: Building2 },
        ],
    },
    {
        group: "행동분석",
        items: [
            { href: "/tracker", label: "트래커", icon: Activity },
            { href: "/logs", label: "발송 이력", icon: History },
            { href: "/crm", label: "CRM 관리", icon: BarChart3 },
        ],
    },
    {
        group: "기타",
        items: [
            { href: "/esign", label: "전자서명", icon: FileSignature },
            { href: "/products", label: "제품 관리", icon: Package },
        ],
    },
];

export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

export const bottomNavItems = [
    { href: "/settings/business", label: "사업부 관리", icon: Store },
    { href: "/settings/workspace", label: "워크스페이스", icon: Layers },
    { href: "/settings/billing", label: "요금제", icon: CreditCard },
    { href: "/settings/organization", label: "조직 설정", icon: Building2 },
];

const routeLabels: Record<string, string> = {
    ...Object.fromEntries([...navItems, ...bottomNavItems].map(({ href, label }) => [href, label])),
    "/customer-imports": "고객 가져오기",
    "/customer-webhooks": "고객 웹훅",
    "/customer-workflows": "고객 자동화",
    "/leadgen": "리드젠",
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
        // 레코드 상세는 독립 페이지가 없고 목록의 ?id= 딥링크로 열린다.
        const recordLink = segments[0] === "records" && index === 1 ? `/records?id=${encodeURIComponent(segment)}` : "";
        return {
            href: ancestorLinks[href] || recordLink || href,
            label: overrides[segment] || routeLabels[href] || segmentLabels[segment] ||
                (INTERNAL_ID.test(segment) ? "상세" : segment),
        };
    });
}
