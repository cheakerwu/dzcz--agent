export type AdminRole = 'admin' | 'ops_lead' | 'operator' | 'viewer';
export type StoreStatus = 'operating' | 'paused' | 'closed';
export type EmployeeStatus = 'active' | 'transferred' | 'offboarded';
export type ConversationStatus = 'active' | 'muted' | 'archived';
export type MemoryScope = 'enterprise' | 'employee' | 'conversation' | 'store' | 'task';
export type MemoryStatus = 'candidate' | 'pending_review' | 'active' | 'conflicted' | 'expired' | 'archived' | 'rejected';
export type BrowserProfileStatus = 'healthy' | 'needs_reauth' | 'expired' | 'revoked' | 'locked' | 'unhealthy';
export type BrowserActionLevel = 'read_only' | 'low_risk_write' | 'medium_risk_write' | 'high_risk_write' | 'destructive';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AdminEntityType = 'store' | 'employee' | 'conversation' | 'platform_account' | 'browser_profile' | 'task';
export type AssignmentStatus = 'active' | 'revoked';
export type ProviderSyncStatus = 'pending' | 'synced' | 'disabled' | 'error' | 'deleted';

export interface AdminActionRequest<TPayload = Record<string, unknown>> {
  action: string;
  payload?: TPayload;
}

export interface AdminActionResponse<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: string;
}

export interface CreateStoreInput {
  name: string;
  brand?: string;
  city?: string;
  area?: string;
  platformStoreId?: string;
  status?: StoreStatus;
  notes?: string;
}

export interface AdminStore {
  id: string;
  name: string;
  brand?: string;
  city?: string;
  area?: string;
  platformStoreId?: string;
  status: StoreStatus;
  notes?: string;
  activeMemoryCount: number;
  staleMemoryCount: number;
  lastMemoryUpdateAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertEmployeeInput {
  connectorId: string;
  userId: string;
  openId?: string;
  displayName: string;
  role?: AdminRole;
  status?: EmployeeStatus;
  isAdmin?: boolean;
}

export interface AdminEmployee {
  id: string;
  connectorId: string;
  userId: string;
  openId?: string;
  displayName: string;
  role: AdminRole;
  status: EmployeeStatus;
  isAdmin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertFeishuConversationInput {
  connectorId: string;
  conversationId: string;
  chatType: 'p2p' | 'group';
  name?: string;
  status?: ConversationStatus;
  defaultTaskCategories?: string[];
  defaultTtlDays?: number;
}

export interface AdminFeishuConversation {
  id: string;
  connectorId: string;
  conversationId: string;
  chatType: 'p2p' | 'group';
  name?: string;
  status: ConversationStatus;
  defaultTaskCategories: string[];
  defaultTtlDays?: number;
  boundStoreIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AssignEmployeeToStoreInput {
  employeeId: string;
  storeId: string;
  responsibility?: string;
}

export interface StoreAssignment {
  id: string;
  storeId: string;
  employeeId: string;
  responsibility: string;
  status: AssignmentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface BindConversationToStoreInput {
  conversationId: string;
  storeId: string;
}

export interface ConversationStoreBinding {
  id: string;
  conversationId: string;
  storeId: string;
  status: AssignmentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEntityLinkInput {
  entityType: AdminEntityType;
  entityId: string;
}

export interface CreateMemoryItemInput {
  provider?: string;
  providerMemoryId?: string;
  scope: MemoryScope;
  category?: string;
  content: string;
  status?: MemoryStatus;
  confidence?: number;
  expiresAt?: number;
  createdBy?: string;
  approvedBy?: string;
  supersedesId?: string;
  sourceType?: string;
  sourceRef?: string;
  entityLinks?: MemoryEntityLinkInput[];
}

export interface ListMemoryItemsFilter {
  scope?: MemoryScope;
  status?: MemoryStatus;
  storeId?: string;
  employeeId?: string;
  conversationId?: string;
  category?: string;
}

export interface AdminMemoryItem {
  id: string;
  provider: string;
  providerMemoryId?: string;
  scope: MemoryScope;
  category?: string;
  content: string;
  status: MemoryStatus;
  confidence: number;
  expiresAt?: number;
  createdBy?: string;
  approvedBy?: string;
  lastUsedAt?: number;
  supersedesId?: string;
  entityLinks: MemoryEntityLinkInput[];
  providerSync?: AdminProviderSyncState;
  createdAt: number;
  updatedAt: number;
}

export interface CreateBrowserProfileInput {
  platform: string;
  label: string;
  storeId?: string;
  profilePath?: string;
  storageStateRef?: string;
  status?: BrowserProfileStatus;
  riskLevel?: RiskLevel;
  allowedActionLevel?: BrowserActionLevel;
  lastCheckedAt?: number;
  lastSuccessfulUseAt?: number;
}

export interface AdminBrowserProfile {
  id: string;
  platform: string;
  label: string;
  storeId?: string;
  profilePath?: string;
  storageStateRef?: string;
  status: BrowserProfileStatus;
  riskLevel: RiskLevel;
  allowedActionLevel: BrowserActionLevel;
  lastCheckedAt?: number;
  lastSuccessfulUseAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface GrantBrowserProfilePermissionInput {
  browserProfileId: string;
  entityType: 'employee' | 'conversation' | 'store' | 'tool';
  entityId: string;
  actionLevel?: BrowserActionLevel;
  status?: AssignmentStatus;
}

export interface BrowserProfilePermission {
  id: string;
  browserProfileId: string;
  entityType: 'employee' | 'conversation' | 'store' | 'tool';
  entityId: string;
  actionLevel: BrowserActionLevel;
  status: AssignmentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AdminProviderSyncState {
  id: string;
  memoryId: string;
  provider: string;
  providerMemoryId?: string;
  status: ProviderSyncStatus;
  error?: string;
  lastSyncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AdminAuditEvent {
  id: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  riskLevel: RiskLevel;
  changes?: Record<string, unknown>;
  createdAt: number;
}

export interface ListAuditEventsFilter {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  limit?: number;
}

export interface AdminDashboard {
  counts: {
    stores: number;
    activeConversations: number;
    activeEmployees: number;
    activeMemoryItems: number;
    pendingMemoryReviews: number;
    browserProfilesNeedingAttention: number;
  };
  unboundConversations: AdminFeishuConversation[];
  pendingMemoryItems: AdminMemoryItem[];
  unhealthyBrowserProfiles: AdminBrowserProfile[];
  recentAuditEvents: AdminAuditEvent[];
}
