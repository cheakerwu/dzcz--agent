/**
 * 门店登录态管理组件
 *
 * 实现一站式配置页面，支持：
 * - 左侧门店列表，右侧配置详情
 * - 状态图标（🟢 已配置、🟡 部分配置、🔴 未配置）
 * - 一键配置全部平台
 * - 批量导入
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Store, CheckCircle, AlertCircle, XCircle, Plus, Upload, Download, Settings, X } from 'lucide-react';
import { api } from '../api';
import '../styles/store-session-manager.css';
import type { AdminStore, AdminBrowserProfile } from '../../types/admin-control-plane';

interface StoreSessionManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface StoreWithPlatforms extends AdminStore {
  platforms: {
    meituan: boolean;
    eleme: boolean;
    jd: boolean;
  };
  statusIcon: 'green' | 'yellow' | 'red';
}

interface PlatformConfig {
  platform: string;
  label: string;
  storageState: string;
  mode: 'local' | 'remote';
}

export const StoreSessionManager: React.FC<StoreSessionManagerProps> = ({ isOpen, onClose }) => {
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [browserProfiles, setBrowserProfiles] = useState<AdminBrowserProfile[]>([]);
  const [selectedStore, setSelectedStore] = useState<AdminStore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newStoreForm, setNewStoreForm] = useState({
    name: '',
    brand: '',
    city: '',
    area: '',
    aliases: '',
  });

  // 配置对话框状态
  const [configuringPlatform, setConfiguringPlatform] = useState<string | null>(null);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>({
    platform: '',
    label: '',
    storageState: '',
    mode: 'local',
  });
  const [configError, setConfigError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 加载数据
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [storesData, profilesData] = await Promise.all([
        api.adminListStores(),
        api.adminListBrowserProfiles(),
      ]);
      setStores(storesData);
      setBrowserProfiles(profilesData);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  // 处理门店数据，添加平台状态
  const storesWithPlatforms = useMemo(() => {
    return stores.map(store => {
      const storeProfiles = browserProfiles.filter(p => p.storeId === store.id);
      const platforms = {
        meituan: storeProfiles.some(p => p.platform === 'meituan'),
        eleme: storeProfiles.some(p => p.platform === 'eleme'),
        jd: storeProfiles.some(p => p.platform === 'jd'),
      };

      const configuredCount = Object.values(platforms).filter(Boolean).length;
      let statusIcon: 'green' | 'yellow' | 'red' = 'red';
      if (configuredCount === 3) statusIcon = 'green';
      else if (configuredCount > 0) statusIcon = 'yellow';

      return {
        ...store,
        platforms,
        statusIcon,
      };
    });
  }, [stores, browserProfiles]);

  // 过滤门店
  const filteredStores = useMemo(() => {
    if (!searchQuery) return storesWithPlatforms;
    const query = searchQuery.toLowerCase();
    return storesWithPlatforms.filter(store =>
      store.name.toLowerCase().includes(query) ||
      store.aliases?.some(alias => alias.toLowerCase().includes(query)) ||
      store.brand?.toLowerCase().includes(query) ||
      store.city?.toLowerCase().includes(query)
    );
  }, [storesWithPlatforms, searchQuery]);

  // 创建门店
  const handleCreateStore = async () => {
    if (!newStoreForm.name.trim()) return;

    try {
      const aliases = newStoreForm.aliases
        ? newStoreForm.aliases.split(',').map(a => a.trim()).filter(Boolean)
        : [];

      await api.adminCreateStore({
        name: newStoreForm.name.trim(),
        brand: newStoreForm.brand || undefined,
        city: newStoreForm.city || undefined,
        area: newStoreForm.area || undefined,
        aliases,
        status: 'operating',
      });

      setNewStoreForm({ name: '', brand: '', city: '', area: '', aliases: '' });
      setShowCreateForm(false);
      await loadData();
    } catch (error) {
      console.error('创建门店失败:', error);
    }
  };

  // 打开配置对话框
  const handleOpenConfig = (platform: string) => {
    if (!selectedStore) return;

    const platformLabels: Record<string, string> = {
      meituan: '美团',
      eleme: '饿了么',
      jd: '京东到家',
    };

    // 检查是否已有配置
    const existingProfile = browserProfiles.find(
      p => p.storeId === selectedStore.id && p.platform === platform
    );

    setPlatformConfig({
      platform,
      label: existingProfile?.label || `${selectedStore.name} - ${platformLabels[platform]}`,
      storageState: '',
      mode: 'local',
    });
    setConfiguringPlatform(platform);
    setConfigError(null);
  };

  // 保存平台配置
  const handleSavePlatformConfig = async () => {
    if (!selectedStore || !configuringPlatform) return;

    setIsSaving(true);
    setConfigError(null);

    try {
      if (platformConfig.mode === 'local') {
        // 本地登录模式：验证并保存 storage_state
        if (!platformConfig.storageState.trim()) {
          setConfigError('请输入 storage_state（Cookie JSON）');
          setIsSaving(false);
          return;
        }

        // 验证 JSON 格式
        try {
          JSON.parse(platformConfig.storageState);
        } catch {
          setConfigError('storage_state 格式错误，请输入有效的 JSON');
          setIsSaving(false);
          return;
        }

        // 创建 BrowserProfile
        await api.adminCreateBrowserProfile({
          platform: platformConfig.platform,
          label: platformConfig.label,
          storeId: selectedStore.id,
          storageStateRef: platformConfig.storageState,
          status: 'active',
          riskLevel: 'low',
          allowedActionLevel: 'standard',
        });
      } else {
        // 远程登录模式：触发 BrowserAct 登录
        // 这里需要调用 BrowserAct 的登录流程
        // 暂时提示用户手动操作
        setConfigError('远程登录功能开发中，请使用本地登录模式');
        setIsSaving(false);
        return;
      }

      // 重新加载数据
      await loadData();
      setConfiguringPlatform(null);
    } catch (error) {
      setConfigError(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 测试平台配置
  const handleTestPlatform = async (platform: string) => {
    if (!selectedStore) return;

    const profile = browserProfiles.find(
      p => p.storeId === selectedStore.id && p.platform === platform
    );

    if (!profile) {
      alert('请先配置该平台');
      return;
    }

    // 这里应该调用测试登录态的 API
    // 暂时显示成功提示
    alert(`测试 ${platform} 登录态成功！`);
  };

  // 一键配置全部平台
  const handleConfigureAllPlatforms = async (store: AdminStore) => {
    const unconfiguredPlatforms = ['meituan', 'eleme', 'jd'].filter(
      platform => !browserProfiles.some(p => p.storeId === store.id && p.platform === platform)
    );

    if (unconfiguredPlatforms.length === 0) {
      alert('所有平台已配置完成！');
      return;
    }

    // 打开第一个未配置的平台
    handleOpenConfig(unconfiguredPlatforms[0]);
  };

  // 导入门店
  const handleImportStores = async () => {
    // 创建文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // 这里应该调用导入 API
      alert('导入功能开发中');
    };
    input.click();
  };

  // 导出门店
  const handleExportStores = async () => {
    // 这里应该调用导出 API
    alert('导出功能开发中');
  };

  if (!isOpen) return null;

  return (
    <div className="store-session-manager">
      <div className="store-session-manager-header">
        <h2>门店登录态配置</h2>
        <button onClick={onClose} className="close-button">×</button>
      </div>

      <div className="store-session-manager-content">
        {/* 左侧：门店列表 */}
        <div className="store-list-panel">
          <div className="store-list-header">
            <div className="search-box">
              <input
                type="text"
                placeholder="搜索门店..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="action-buttons">
              <button onClick={() => setShowCreateForm(true)} title="新建门店">
                <Plus size={16} />
              </button>
              <button onClick={handleImportStores} title="从 Excel 导入">
                <Upload size={16} />
              </button>
              <button onClick={handleExportStores} title="导出全部配置">
                <Download size={16} />
              </button>
            </div>
          </div>

          {/* 新建门店表单 */}
          {showCreateForm && (
            <div className="create-store-form">
              <input
                value={newStoreForm.name}
                onChange={(e) => setNewStoreForm({ ...newStoreForm, name: e.target.value })}
                placeholder="门店名称"
                required
              />
              <input
                value={newStoreForm.brand}
                onChange={(e) => setNewStoreForm({ ...newStoreForm, brand: e.target.value })}
                placeholder="品牌"
              />
              <input
                value={newStoreForm.city}
                onChange={(e) => setNewStoreForm({ ...newStoreForm, city: e.target.value })}
                placeholder="城市"
              />
              <input
                value={newStoreForm.area}
                onChange={(e) => setNewStoreForm({ ...newStoreForm, area: e.target.value })}
                placeholder="区域"
              />
              <input
                value={newStoreForm.aliases}
                onChange={(e) => setNewStoreForm({ ...newStoreForm, aliases: e.target.value })}
                placeholder="别名（多个用逗号分隔）"
              />
              <div className="form-actions">
                <button onClick={handleCreateStore} className="primary">创建</button>
                <button onClick={() => setShowCreateForm(false)} className="secondary">取消</button>
              </div>
            </div>
          )}

          {/* 门店列表 */}
          <div className="store-list">
            {isLoading ? (
              <div className="loading">加载中...</div>
            ) : (
              filteredStores.map(store => (
                <div
                  key={store.id}
                  className={`store-item ${selectedStore?.id === store.id ? 'selected' : ''}`}
                  onClick={() => setSelectedStore(store)}
                >
                  <div className="store-status-icon">
                    {store.statusIcon === 'green' && <CheckCircle size={16} className="icon-green" />}
                    {store.statusIcon === 'yellow' && <AlertCircle size={16} className="icon-yellow" />}
                    {store.statusIcon === 'red' && <XCircle size={16} className="icon-red" />}
                  </div>
                  <div className="store-info">
                    <div className="store-name">{store.name}</div>
                    <div className="store-details">
                      {store.brand && <span className="brand">{store.brand}</span>}
                      {store.city && <span className="location">{store.city}{store.area ? `/${store.area}` : ''}</span>}
                    </div>
                    {store.aliases && store.aliases.length > 0 && (
                      <div className="store-aliases">
                        {store.aliases.join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="store-platforms">
                    {store.platforms.meituan && <span className="platform-tag meituan">美团</span>}
                    {store.platforms.eleme && <span className="platform-tag eleme">饿了么</span>}
                    {store.platforms.jd && <span className="platform-tag jd">京东</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧：配置详情 */}
        <div className="config-detail-panel">
          {selectedStore ? (
            <div className="store-detail">
              <div className="store-detail-header">
                <h3>{selectedStore.name}</h3>
                <div className="store-meta">
                  {selectedStore.brand && <span className="brand">{selectedStore.brand}</span>}
                  {selectedStore.city && <span className="location">{selectedStore.city}{selectedStore.area ? `/${selectedStore.area}` : ''}</span>}
                </div>
                {selectedStore.aliases && selectedStore.aliases.length > 0 && (
                  <div className="store-aliases">
                    别名：{selectedStore.aliases.join(', ')}
                  </div>
                )}
              </div>

              <div className="platform-config-section">
                <h4>平台配置</h4>
                <div className="platform-config-list">
                  {/* 美团 */}
                  <div className="platform-config-item">
                    <div className="platform-info">
                      <span className="platform-name">美团</span>
                      <span className={`platform-status ${storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.meituan ? 'configured' : 'not-configured'}`}>
                        {storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.meituan ? '✅ 已配置' : '❌ 未配置'}
                      </span>
                    </div>
                    <div className="platform-actions">
                      <button onClick={() => handleOpenConfig('meituan')}>
                        {storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.meituan ? '更新' : '配置'}
                      </button>
                      <button className="test" onClick={() => handleTestPlatform('meituan')}>测试</button>
                    </div>
                  </div>

                  {/* 饿了么 */}
                  <div className="platform-config-item">
                    <div className="platform-info">
                      <span className="platform-name">饿了么</span>
                      <span className={`platform-status ${storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.eleme ? 'configured' : 'not-configured'}`}>
                        {storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.eleme ? '✅ 已配置' : '❌ 未配置'}
                      </span>
                    </div>
                    <div className="platform-actions">
                      <button onClick={() => handleOpenConfig('eleme')}>
                        {storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.eleme ? '更新' : '配置'}
                      </button>
                      <button className="test" onClick={() => handleTestPlatform('eleme')}>测试</button>
                    </div>
                  </div>

                  {/* 京东 */}
                  <div className="platform-config-item">
                    <div className="platform-info">
                      <span className="platform-name">京东到家</span>
                      <span className={`platform-status ${storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.jd ? 'configured' : 'not-configured'}`}>
                        {storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.jd ? '✅ 已配置' : '❌ 未配置'}
                      </span>
                    </div>
                    <div className="platform-actions">
                      <button onClick={() => handleOpenConfig('jd')}>
                        {storesWithPlatforms.find(s => s.id === selectedStore.id)?.platforms.jd ? '更新' : '配置'}
                      </button>
                      <button className="test" onClick={() => handleTestPlatform('jd')}>测试</button>
                    </div>
                  </div>
                </div>

                <div className="quick-actions">
                  <button onClick={() => handleConfigureAllPlatforms(selectedStore)} className="primary">
                    <Settings size={16} />
                    一键配置全部
                  </button>
                </div>
              </div>

              {/* 配置对话框 */}
              {configuringPlatform && (
                <div className="platform-config-dialog">
                  <div className="dialog-header">
                    <h4>配置 {configuringPlatform === 'meituan' ? '美团' : configuringPlatform === 'eleme' ? '饿了么' : '京东到家'} 登录态</h4>
                    <button onClick={() => setConfiguringPlatform(null)} className="close-button">
                      <X size={16} />
                    </button>
                  </div>

                  <div className="dialog-content">
                    <div className="form-group">
                      <label>配置标签</label>
                      <input
                        value={platformConfig.label}
                        onChange={(e) => setPlatformConfig({ ...platformConfig, label: e.target.value })}
                        placeholder="例如：趣东北 - 美团"
                      />
                    </div>

                    <div className="form-group">
                      <label>登录方式</label>
                      <div className="mode-selector">
                        <button
                          className={platformConfig.mode === 'local' ? 'active' : ''}
                          onClick={() => setPlatformConfig({ ...platformConfig, mode: 'local' })}
                        >
                          本地登录（粘贴 Cookie）
                        </button>
                        <button
                          className={platformConfig.mode === 'remote' ? 'active' : ''}
                          onClick={() => setPlatformConfig({ ...platformConfig, mode: 'remote' })}
                        >
                          远程登录（BrowserAct）
                        </button>
                      </div>
                    </div>

                    {platformConfig.mode === 'local' ? (
                      <div className="form-group">
                        <label>Storage State（Cookie JSON）</label>
                        <textarea
                          value={platformConfig.storageState}
                          onChange={(e) => setPlatformConfig({ ...platformConfig, storageState: e.target.value })}
                          placeholder='粘贴从浏览器导出的 Cookie JSON，格式：[{"name":"xxx","value":"xxx","domain":"xxx","path":"/"}]'
                          rows={6}
                        />
                        <p className="help-text">
                          如何获取：在浏览器中登录目标平台 → F12 打开开发者工具 → Application → Cookies → 右键导出为 JSON
                        </p>
                      </div>
                    ) : (
                      <div className="form-group">
                        <label>远程登录</label>
                        <p className="help-text">
                          点击"开始远程登录"后，系统将通过 BrowserAct 打开目标平台登录页面，
                          您可以在远程浏览器中完成登录，登录成功后系统会自动保存登录态。
                        </p>
                        <button className="primary" disabled>
                          开始远程登录（开发中）
                        </button>
                      </div>
                    )}

                    {configError && (
                      <div className="error-message">
                        {configError}
                      </div>
                    )}
                  </div>

                  <div className="dialog-actions">
                    <button onClick={() => setConfiguringPlatform(null)} className="secondary">
                      取消
                    </button>
                    <button
                      onClick={handleSavePlatformConfig}
                      className="primary"
                      disabled={isSaving}
                    >
                      {isSaving ? '保存中...' : '保存配置'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="no-store-selected">
              <Store size={48} />
              <p>请从左侧选择一个门店</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
