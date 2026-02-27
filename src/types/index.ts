// 조직 역할
export type OrgRole = "owner" | "admin" | "member";

// JWT Payload
export interface JWTPayload {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: OrgRole;
}

// API 응답 타입
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 필드 타입 (field_definitions.field_type)
export type FieldType =
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "phone"
  | "textarea"
  | "checkbox"
  | "file"
  | "currency"
  | "formula"
  | "user_select"
  | "email";

// 셀 타입 (field_definitions.cell_type)
export type CellType =
  | "editable"
  | "readonly"
  | "select"
  | "selectWithStatusBg"
  | "date"
  | "phone"
  | "file"
  | "formula"
  | "checkbox"
  | "user_select"
  | "currency"
  | "textarea"
  | "email";

// 필드 정의 (클라이언트용)
export interface FieldDefinition {
  id: number;
  workspaceId: number;
  key: string;
  label: string;
  fieldType: FieldType;
  category: string | null;
  sortOrder: number;
  isRequired: boolean;
  isSystem: boolean;
  defaultWidth: number;
  minWidth: number;
  cellType: CellType | null;
  cellClassName: string | null;
  options: string[] | null;
  statusOptionCategoryId: number | null;
  formulaConfig: FormulaConfig | null;
}

// 필터 연산자
export type FilterOperator =
    | "contains" | "equals" | "not_equals"
    | "gt" | "gte" | "lt" | "lte"
    | "before" | "after" | "between"
    | "is_empty" | "is_not_empty"
    | "is_true" | "is_false";

// 필터 조건
export interface FilterCondition {
    field: string;
    operator: FilterOperator;
    value: string | number | boolean | null;
    valueTo?: string | number;  // between용
}

// CSV 가져오기 에러
export interface ImportError {
    row: number;
    message: string;
}

// CSV 가져오기 결과
export interface ImportResult {
    success: boolean;
    totalCount: number;
    insertedCount: number;
    skippedCount: number;
    errors: ImportError[];
}

// 수식 설정
export interface FormulaConfig {
  rules: Array<{
    conditions: Array<{ field: string; operator: string; value: string | number }>;
    expression: { field: string; operator: string; value: number };
  }>;
  defaultExpression?: { field: string; operator: string; value: number };
}

// 사용자 목록 항목 (password 제외)
export interface UserListItem {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: OrgRole;
  phone: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

// 사용자 생성 입력
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: OrgRole;
  phone?: string;
}

// 사용자 수정 입력
export interface UpdateUserInput {
  name?: string;
  phone?: string;
  role?: OrgRole;
  isActive?: number;
}

// 조직 브랜딩
export interface OrgBranding {
    logo?: string;
    primaryColor?: string;
    companyName?: string;
}

// 조직 설정
export interface OrgSettings {
    timezone?: string;
    locale?: string;
    dateFormat?: string;
}

// 조직 정보 (API 응답)
export interface OrgInfo {
    id: string;
    name: string;
    slug: string;
    branding: OrgBranding | null;
    integratedCodePrefix: string;
    settings: OrgSettings | null;
}

// 조직 수정 입력
export interface UpdateOrgInput {
    name?: string;
    branding?: OrgBranding;
    settings?: OrgSettings;
    integratedCodePrefix?: string;
}

// 멤버 목록 항목
export interface MemberItem {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  phone: string | null;
  isActive: number;
  createdAt: string;
}

// 초대 목록 항목
export interface InvitationItem {
  id: number;
  email: string;
  role: OrgRole;
  status: "pending" | "accepted" | "cancelled";
  token: string;
  invitedBy: { id: string; name: string };
  expiresAt: string;
  createdAt: string;
}

// 워크스페이스 설정
export interface WorkspaceSettings {
    defaultVisibleFields?: string[];
    duplicateCheckField?: string;
}

// 워크스페이스 상세 (API 응답)
export interface WorkspaceDetail {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
    codePrefix: string | null;
    settings: WorkspaceSettings | null;
}

// 워크스페이스 수정 입력
export interface UpdateWorkspaceInput {
    name?: string;
    description?: string;
    icon?: string;
    codePrefix?: string;
}

// 워크스페이스 생성 입력
export interface CreateWorkspaceInput {
    name: string;
    description?: string;
    icon?: string;
}

// 파티션 생성 입력
export interface CreatePartitionInput {
    name: string;
    folderId?: number | null;
}

// 폴더 생성 입력
export interface CreateFolderInput {
    name: string;
}

// 필드 생성 입력
export interface CreateFieldInput {
    key: string;
    label: string;
    fieldType: FieldType;
    category?: string;
    isRequired?: boolean;
    options?: string[];
}

// 필드 수정 입력
export interface UpdateFieldInput {
    label?: string;
    category?: string;
    isRequired?: boolean;
    options?: string[];
    defaultWidth?: number;
}

// 필드 순서 변경 입력
export interface ReorderFieldsInput {
    fieldIds: number[];
}

// 알림톡 트리거 타입
export type AlimtalkTriggerType = "manual" | "on_create" | "on_field_change";

// 알림톡 발송 상태
export type AlimtalkSendStatus = "pending" | "sent" | "failed";

// 권한 타입
export type PermissionType = "owner" | "edit" | "view";

// 레코드 필터
export interface RecordFilter {
  distributionOrder?: number;
  searchKeyword?: string;
  filters?: Record<string, string | number | boolean>;
  startDate?: string;
  endDate?: string;
}

// NHN Cloud 발신프로필
export interface SenderProfile {
  plusFriendId: string;
  senderKey: string;
  categoryCode: string;
  status: string;
  statusName: string;
  kakaoStatus: string;
  alimtalk: boolean;
  friendtalk: boolean;
  createDate: string;
}

// NHN Cloud 템플릿
export interface AlimtalkTemplate {
  senderKey: string;
  templateCode: string;
  templateName: string;
  templateMessageType: string;
  templateContent: string;
  templateStatus: string;
  templateStatusName: string;
  buttons?: Array<{
    ordering: number;
    type: string;
    name: string;
    linkMo?: string;
    linkPc?: string;
  }>;
  createDate: string;
}

// 알림톡 발송 결과
export interface AlimtalkSendResult {
  requestId: string;
  totalCount: number;
  successCount: number;
  failCount: number;
  results: Array<{
    recordId: number;
    recipientNo: string;
    resultCode: number;
    resultMessage: string;
  }>;
}

// 알림톡 통계
export interface AlimtalkStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  recentLogs: Array<{
    id: number;
    recipientNo: string;
    templateCode: string;
    templateName: string | null;
    status: string;
    sentAt: string;
    resultMessage: string | null;
  }>;
}

// 통합 로그 채널
export type UnifiedLogChannel = "alimtalk" | "email";

// 통합 로그
export interface UnifiedLog {
    id: number;
    channel: UnifiedLogChannel;
    orgId: string;
    partitionId: number | null;
    recordId: number | null;
    recipient: string;
    title: string | null;
    status: string;
    triggerType: string | null;
    resultMessage: string | null;
    sentBy: string | null;
    sentAt: string;
    completedAt: string | null;
}
