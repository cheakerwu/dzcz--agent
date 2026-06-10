import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  Brain,
  CheckCircle2,
  KeyRound,
  Link2,
  MessageSquare,
  RefreshCw,
  Shield,
  Store,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import type {
  AdminAuditEvent,
  AdminBrowserProfile,
  AdminDashboard,
  AdminEmployee,
  AdminFeishuConversation,
  AdminMemoryItem,
  AdminStore,
  BrowserActionLevel,
  BrowserProfileStatus,
  MemoryScope,
  MemoryStatus,
  RiskLevel,
} from '../../types/admin-control-plane';
import '../styles/admin-console.css';

type AdminSection = 'dashboard' | 'stores' | 'conversations' | 'employees' | 'memories' | 'browser-vault' | 'audit';

interface AdminConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

const sections: Array<{ id: AdminSection; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: '总览', icon: <Activity size={16} /> },
  { id: 'stores', label: '门店', icon: <Store size={16} /> },
  { id: 'conversations', label: '群聊', icon: <MessageSquare size={16} /> },
  { id: 'employees', label: '员工', icon: <Users size={16} /> },
  { id: 'memories', label: '记忆', icon: <Brain size={16} /> },
  { id: 'browser-vault', label: '登录态', icon: <KeyRound size={16} /> },
  { id: 'audit', label: '审计', icon: <Shield size={16} /> },
];

const emptyDashboard: AdminDashboard = {
  counts: {
    stores: 0,
    activeConversations: 0,
    activeEmployees: 0,
    activeMemoryItems: 0,
    pendingMemoryReviews: 0,
    browserProfilesNeedingAttention: 0,
  },
  unboundConversations: [],
  pendingMemoryItems: [],
  unhealthyBrowserProfiles: [],
  recentAuditEvents: [],
};

export const AdminConsole: React.FC<AdminConsoleProps> = ({ isOpen, onClose }) => {
  const [section, setSection] = useState<AdminSection>('dashboard');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboard>(emptyDashboard);
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [conversations, setConversations] = useState<AdminFeishuConversation[]>([]);
  const [memories, setMemories] = useState<AdminMemoryItem[]>([]);
  const [browserProfiles, setBrowserProfiles] = useState<AdminBrowserProfile[]>([]);
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([]);

  const [storeForm, setStoreForm] = useState({ name: '', brand: '点之出众', city: '', area: '' });
  const [employeeForm, setEmployeeForm] = useState({ connectorId: 'feishu', userId: '', displayName: '', role: 'operator' });
  const [conversationForm, setConversationForm] = useState({ connectorId: 'feishu', conversationId: '', chatType: 'group', name: '' });
  const [assignmentForm, setAssignmentForm] = useState({ employeeId: '', storeId: '', responsibility: 'owner' });
  const [bindingForm, setBindingForm] = useState({ conversationId: '', storeId: '' });
  const [memoryForm, setMemoryForm] = useState({
    scope: 'store' as MemoryScope,
    category: 'ops_fact',
    content: '',
    status: 'active' as MemoryStatus,
    confidence: 0.85,
    storeId: '',
    conversationId: '',
  });
  const [browserForm, setBrowserForm] = useState({
    platform: 'meituan',
    label: '',
    storeId: '',
    storageStateRef: '',
    status: 'healthy' as BrowserProfileStatus,
    riskLevel: 'medium' as RiskLevel,
    allowedActionLevel: 'read_only' as BrowserActionLevel,
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [
        nextDashboard,
        nextStores,
        nextEmployees,
        nextConversations,
        nextMemories,
        nextBrowserProfiles,
        nextAuditEvents,
      ] = await Promise.all([
        api.adminGetDashboard(),
        api.adminListStores(),
        api.adminListEmployees(),
        api.adminListFeishuConversations(),
        api.adminListMemoryItems(),
        api.adminListBrowserProfiles(),
        api.adminListAuditEvents({ limit: 80 }),
      ]);
      setDashboard(nextDashboard);
      setStores(nextStores);
      setEmployees(nextEmployees);
      setConversations(nextConversations);
      setMemories(nextMemories);
      setBrowserProfiles(nextBrowserProfiles);
      setAuditEvents(nextAuditEvents);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const storeOptions = useMemo(() => stores.map((store) => (
    <option key={store.id} value={store.id}>{store.name}</option>
  )), [stores]);

  const employeeOptions = useMemo(() => employees.map((employee) => (
    <option key={employee.id} value={employee.id}>{employee.displayName}</option>
  )), [employees]);

  const conversationOptions = useMemo(() => conversations.map((conversation) => (
    <option key={conversation.id} value={conversation.id}>{conversation.name || conversation.conversationId}</option>
  )), [conversations]);

  if (!isOpen) return null;

  const submitStore = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.adminCreateStore({ ...storeForm, status: 'operating' });
    setStoreForm({ name: '', brand: '点之出众', city: '', area: '' });
    await loadData();
  };

  const submitEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.adminUpsertEmployee({
      ...employeeForm,
      role: employeeForm.role as any,
      status: 'active',
      isAdmin: employeeForm.role === 'admin',
    });
    setEmployeeForm({ connectorId: 'feishu', userId: '', displayName: '', role: 'operator' });
    await loadData();
  };

  const submitConversation = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.adminUpsertFeishuConversation({
      ...conversationForm,
      chatType: conversationForm.chatType as 'group' | 'p2p',
      status: 'active',
    });
    setConversationForm({ connectorId: 'feishu', conversationId: '', chatType: 'group', name: '' });
    await loadData();
  };

  const submitAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assignmentForm.employeeId || !assignmentForm.storeId) return;
    await api.adminAssignEmployeeToStore(assignmentForm);
    await loadData();
  };

  const submitBinding = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bindingForm.conversationId || !bindingForm.storeId) return;
    await api.adminBindConversationToStore(bindingForm);
    await loadData();
  };

  const submitMemory = async (event: React.FormEvent) => {
    event.preventDefault();
    const entityLinks = [];
    if (memoryForm.storeId) entityLinks.push({ entityType: 'store' as const, entityId: memoryForm.storeId });
    if (memoryForm.conversationId) entityLinks.push({ entityType: 'conversation' as const, entityId: memoryForm.conversationId });
    await api.adminCreateMemoryItem({
      scope: memoryForm.scope,
      category: memoryForm.category,
      content: memoryForm.content,
      status: memoryForm.status,
      confidence: Number(memoryForm.confidence),
      entityLinks,
    });
    setMemoryForm((prev) => ({ ...prev, content: '' }));
    await loadData();
  };

  const submitBrowserProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.adminCreateBrowserProfile({
      platform: browserForm.platform,
      label: browserForm.label,
      storeId: browserForm.storeId || undefined,
      storageStateRef: browserForm.storageStateRef || undefined,
      status: browserForm.status,
      riskLevel: browserForm.riskLevel,
      allowedActionLevel: browserForm.allowedActionLevel,
    });
    setBrowserForm((prev) => ({ ...prev, label: '', storageStateRef: '' }));
    await loadData();
  };

  const getStoreName = (storeId?: string) => stores.find((store) => store.id === storeId)?.name || '未绑定门店';

  return (
    <div className="admin-console-overlay">
      <div className="admin-console">
        <header className="admin-console-header">
          <div>
            <div className="admin-console-kicker">DianBot Control Plane</div>
            <h2>运营记忆管理后台</h2>
          </div>
          <div className="admin-console-header-actions">
            <button className="admin-icon-button" onClick={loadData} title="刷新">
              <RefreshCw size={16} />
            </button>
            <button className="admin-icon-button" onClick={onClose} title="关闭">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="admin-console-body">
          <nav className="admin-console-nav">
            {sections.map((item) => (
              <button
                key={item.id}
                className={`admin-nav-item ${section === item.id ? 'active' : ''}`}
                onClick={() => setSection(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <main className="admin-console-main">
            {error && <div className="admin-error">{error}</div>}
            {isLoading && <div className="admin-loading">Loading control plane data...</div>}

            {section === 'dashboard' && (
              <section className="admin-section">
                <div className="admin-metrics">
                  <Metric label="门店" value={dashboard.counts.stores} />
                  <Metric label="活跃群聊" value={dashboard.counts.activeConversations} />
                  <Metric label="员工" value={dashboard.counts.activeEmployees} />
                  <Metric label="活跃记忆" value={dashboard.counts.activeMemoryItems} />
                  <Metric label="待审记忆" value={dashboard.counts.pendingMemoryReviews} />
                  <Metric label="登录态异常" value={dashboard.counts.browserProfilesNeedingAttention} />
                </div>
                <div className="admin-split">
                  <Panel title="未绑定门店的群聊">
                    <CompactList rows={dashboard.unboundConversations.map((item) => item.name || item.conversationId)} empty="暂无未绑定群聊" />
                  </Panel>
                  <Panel title="近期审计">
                    <CompactList rows={dashboard.recentAuditEvents.map((event) => `${event.action} / ${event.entityType}`)} empty="暂无审计事件" />
                  </Panel>
                </div>
              </section>
            )}

            {section === 'stores' && (
              <section className="admin-section">
                <AdminForm onSubmit={submitStore}>
                  <input value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} placeholder="门店名称" required />
                  <input value={storeForm.brand} onChange={(e) => setStoreForm({ ...storeForm, brand: e.target.value })} placeholder="品牌" />
                  <input value={storeForm.city} onChange={(e) => setStoreForm({ ...storeForm, city: e.target.value })} placeholder="城市" />
                  <input value={storeForm.area} onChange={(e) => setStoreForm({ ...storeForm, area: e.target.value })} placeholder="区域" />
                  <button type="submit">新增门店</button>
                </AdminForm>
                <DataTable headers={['门店', '品牌', '位置', '状态', '活跃记忆']}>
                  {stores.map((store) => (
                    <tr key={store.id}>
                      <td>{store.name}</td>
                      <td>{store.brand || '-'}</td>
                      <td>{[store.city, store.area].filter(Boolean).join(' / ') || '-'}</td>
                      <td><StatusPill label={store.status} /></td>
                      <td>{store.activeMemoryCount}</td>
                    </tr>
                  ))}
                </DataTable>
              </section>
            )}

            {section === 'conversations' && (
              <section className="admin-section">
                <AdminForm onSubmit={submitConversation}>
                  <input value={conversationForm.connectorId} onChange={(e) => setConversationForm({ ...conversationForm, connectorId: e.target.value })} placeholder="connectorId" required />
                  <input value={conversationForm.conversationId} onChange={(e) => setConversationForm({ ...conversationForm, conversationId: e.target.value })} placeholder="飞书 conversationId" required />
                  <select value={conversationForm.chatType} onChange={(e) => setConversationForm({ ...conversationForm, chatType: e.target.value })}>
                    <option value="group">群聊</option>
                    <option value="p2p">单聊</option>
                  </select>
                  <input value={conversationForm.name} onChange={(e) => setConversationForm({ ...conversationForm, name: e.target.value })} placeholder="群聊名称" />
                  <button type="submit">登记群聊</button>
                </AdminForm>
                <AdminForm onSubmit={submitBinding}>
                  <select value={bindingForm.conversationId} onChange={(e) => setBindingForm({ ...bindingForm, conversationId: e.target.value })} required>
                    <option value="">选择群聊</option>
                    {conversationOptions}
                  </select>
                  <select value={bindingForm.storeId} onChange={(e) => setBindingForm({ ...bindingForm, storeId: e.target.value })} required>
                    <option value="">绑定门店</option>
                    {storeOptions}
                  </select>
                  <button type="submit"><Link2 size={14} />绑定</button>
                </AdminForm>
                <DataTable headers={['群聊', 'Connector', '类型', '状态', '门店数']}>
                  {conversations.map((conversation) => (
                    <tr key={conversation.id}>
                      <td>{conversation.name || conversation.conversationId}</td>
                      <td>{conversation.connectorId}</td>
                      <td>{conversation.chatType}</td>
                      <td><StatusPill label={conversation.status} /></td>
                      <td>{conversation.boundStoreIds.length}</td>
                    </tr>
                  ))}
                </DataTable>
              </section>
            )}

            {section === 'employees' && (
              <section className="admin-section">
                <AdminForm onSubmit={submitEmployee}>
                  <input value={employeeForm.connectorId} onChange={(e) => setEmployeeForm({ ...employeeForm, connectorId: e.target.value })} placeholder="connectorId" required />
                  <input value={employeeForm.userId} onChange={(e) => setEmployeeForm({ ...employeeForm, userId: e.target.value })} placeholder="飞书 userId" required />
                  <input value={employeeForm.displayName} onChange={(e) => setEmployeeForm({ ...employeeForm, displayName: e.target.value })} placeholder="姓名" required />
                  <select value={employeeForm.role} onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })}>
                    <option value="operator">operator</option>
                    <option value="ops_lead">ops_lead</option>
                    <option value="admin">admin</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button type="submit">保存员工</button>
                </AdminForm>
                <AdminForm onSubmit={submitAssignment}>
                  <select value={assignmentForm.employeeId} onChange={(e) => setAssignmentForm({ ...assignmentForm, employeeId: e.target.value })} required>
                    <option value="">选择员工</option>
                    {employeeOptions}
                  </select>
                  <select value={assignmentForm.storeId} onChange={(e) => setAssignmentForm({ ...assignmentForm, storeId: e.target.value })} required>
                    <option value="">负责门店</option>
                    {storeOptions}
                  </select>
                  <input value={assignmentForm.responsibility} onChange={(e) => setAssignmentForm({ ...assignmentForm, responsibility: e.target.value })} placeholder="职责" />
                  <button type="submit">分配</button>
                </AdminForm>
                <DataTable headers={['姓名', 'Connector', '角色', '状态', '操作']}>
                  {employees.map((employee) => (
                    <tr key={employee.id}>
                      <td>{employee.displayName}</td>
                      <td>{employee.connectorId}</td>
                      <td>{employee.role}</td>
                      <td><StatusPill label={employee.status} /></td>
                      <td>
                        <button className="admin-row-button danger" onClick={async () => { await api.adminOffboardEmployee(employee.id); await loadData(); }}>
                          <UserMinus size={14} />离职
                        </button>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </section>
            )}

            {section === 'memories' && (
              <section className="admin-section">
                <AdminForm onSubmit={submitMemory} className="admin-form-wide">
                  <select value={memoryForm.scope} onChange={(e) => setMemoryForm({ ...memoryForm, scope: e.target.value as MemoryScope })}>
                    <option value="enterprise">enterprise</option>
                    <option value="store">store</option>
                    <option value="conversation">conversation</option>
                    <option value="employee">employee</option>
                    <option value="task">task</option>
                  </select>
                  <input value={memoryForm.category} onChange={(e) => setMemoryForm({ ...memoryForm, category: e.target.value })} placeholder="分类" />
                  <select value={memoryForm.storeId} onChange={(e) => setMemoryForm({ ...memoryForm, storeId: e.target.value })}>
                    <option value="">关联门店</option>
                    {storeOptions}
                  </select>
                  <select value={memoryForm.conversationId} onChange={(e) => setMemoryForm({ ...memoryForm, conversationId: e.target.value })}>
                    <option value="">关联群聊</option>
                    {conversationOptions}
                  </select>
                  <textarea value={memoryForm.content} onChange={(e) => setMemoryForm({ ...memoryForm, content: e.target.value })} placeholder="记忆内容" required />
                  <button type="submit">写入记忆</button>
                </AdminForm>
                <DataTable headers={['范围', '分类', '内容', '状态', 'Provider', '操作']}>
                  {memories.map((memory) => (
                    <tr key={memory.id}>
                      <td>{memory.scope}</td>
                      <td>{memory.category || '-'}</td>
                      <td className="admin-memory-cell">{memory.content}</td>
                      <td><StatusPill label={memory.status} /></td>
                      <td>{memory.providerSync?.status || 'pending'}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button className="admin-row-button" onClick={async () => { await api.adminUpdateMemoryStatus(memory.id, 'active'); await loadData(); }}><CheckCircle2 size={14} />启用</button>
                          <button className="admin-row-button" onClick={async () => { await api.adminUpdateMemoryStatus(memory.id, 'archived'); await loadData(); }}><Archive size={14} />归档</button>
                          <button className="admin-row-button" onClick={async () => { await api.adminSyncMemoryItem(memory.id); await loadData(); }}><RefreshCw size={14} />mem0</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </section>
            )}

            {section === 'browser-vault' && (
              <section className="admin-section">
                <AdminForm onSubmit={submitBrowserProfile}>
                  <input value={browserForm.platform} onChange={(e) => setBrowserForm({ ...browserForm, platform: e.target.value })} placeholder="平台" required />
                  <input value={browserForm.label} onChange={(e) => setBrowserForm({ ...browserForm, label: e.target.value })} placeholder="登录态标签" required />
                  <select value={browserForm.storeId} onChange={(e) => setBrowserForm({ ...browserForm, storeId: e.target.value })}>
                    <option value="">绑定门店</option>
                    {storeOptions}
                  </select>
                  <input value={browserForm.storageStateRef} onChange={(e) => setBrowserForm({ ...browserForm, storageStateRef: e.target.value })} placeholder="storage-state 引用" />
                  <select value={browserForm.riskLevel} onChange={(e) => setBrowserForm({ ...browserForm, riskLevel: e.target.value as RiskLevel })}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                  <button type="submit">登记登录态</button>
                </AdminForm>
                <DataTable headers={['标签', '平台', '门店', '状态', '风险', '凭据']}>
                  {browserProfiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>{profile.label}</td>
                      <td>{profile.platform}</td>
                      <td>{getStoreName(profile.storeId)}</td>
                      <td><StatusPill label={profile.status} /></td>
                      <td>{profile.riskLevel}</td>
                      <td>{profile.storageStateRef ? '已登记，提示词不可见' : '未登记'}</td>
                    </tr>
                  ))}
                </DataTable>
              </section>
            )}

            {section === 'audit' && (
              <section className="admin-section">
                <DataTable headers={['时间', '动作', '实体', '风险', '操作者']}>
                  {auditEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.createdAt).toLocaleString()}</td>
                      <td>{event.action}</td>
                      <td>{event.entityType}</td>
                      <td>{event.riskLevel}</td>
                      <td>{event.actorId || '-'}</td>
                    </tr>
                  ))}
                </DataTable>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="admin-metric">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="admin-panel">
    <h3>{title}</h3>
    {children}
  </div>
);

const CompactList: React.FC<{ rows: string[]; empty: string }> = ({ rows, empty }) => (
  <ul className="admin-compact-list">
    {rows.length === 0 ? <li>{empty}</li> : rows.slice(0, 8).map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
  </ul>
);

const AdminForm: React.FC<React.FormHTMLAttributes<HTMLFormElement>> = ({ className = '', children, ...props }) => (
  <form className={`admin-form ${className}`} {...props}>
    {children}
  </form>
);

const DataTable: React.FC<{ headers: string[]; children: React.ReactNode }> = ({ headers, children }) => (
  <div className="admin-table-wrap">
    <table className="admin-table">
      <thead>
        <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

const StatusPill: React.FC<{ label: string }> = ({ label }) => (
  <span className={`admin-status admin-status-${label.replace(/_/g, '-')}`}>{label}</span>
);
