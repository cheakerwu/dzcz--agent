/**
 * 工具注册表
 * 
 * ## 职责
 * 
 * 1. 管理工具插件的注册
 * 2. 提供工具查询接口
 * 3. 管理工具配置
 * 
 * ## 注意
 * 
 * 此注册表主要用于内部管理，实际的工具加载由 `tool-loader.ts` 负责。
 * 
 * ### 工具加载流程
 * 
 * 1. `tool-loader.ts` 导入所有内置工具
 * 2. 调用每个工具的 `create()` 方法创建实例
 * 3. 将工具实例注册到此注册表
 * 4. 返回工具数组给 Agent Runtime
 * 
 * ### 历史遗留
 * 
 * `loadFromDirectory()` 方法是历史遗留代码，当前架构下不再使用。
 * 所有工具都在 `tool-loader.ts` 中显式导入和加载。
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolPlugin, ToolCreateOptions, ToolLoadResult, ToolConfig } from './tool-interface';
import { getErrorMessage } from '../../../shared/utils/error-handler';

/**
 * 工具注册表类
 */
export class ToolRegistry {
  private plugins = new Map<string, ToolPlugin>();
  private loadedTools = new Map<string, AgentTool[]>();
  private toolConfigs = new Map<string, ToolConfig>();
  
  /**
   * 注册工具插件
   * 
   * @param plugin - 工具插件
   */
  register(plugin: ToolPlugin): void {
    const { id } = plugin.metadata;
    
    if (this.plugins.has(id)) {
      console.warn(`⚠️ 工具 ${id} 已注册，将被覆盖`);
    }
    
    this.plugins.set(id, plugin);
    console.log(`✅ 工具已注册: ${id} (${plugin.metadata.name})`);
  }
  
  /**
   * 从目录加载工具
   * 
   * @param directory - 工具目录
   * @param options - 创建选项
   * @returns 加载结果
   */
  async loadFromDirectory(
    directory: string,
    options: ToolCreateOptions
  ): Promise<ToolLoadResult[]> {
    const results: ToolLoadResult[] = [];
    
    if (!existsSync(directory)) {
      console.warn(`⚠️ 工具目录不存在: ${directory}`);
      return results;
    }
    
    console.log(`📂 扫描工具目录: ${directory}`);
    
    try {
      const entries = readdirSync(directory);
      
      for (const entry of entries) {
        const fullPath = join(directory, entry);
        const stat = statSync(fullPath);
        
        // 只处理文件，不递归加载子目录
        if (!stat.isFile()) {
          continue;
        }
        
        // 跳过非 TypeScript/JavaScript 文件
        const ext = extname(entry);
        if (ext !== '.ts' && ext !== '.js' && ext !== '.mjs') {
          continue;
        }
        
        // 跳过测试文件和类型定义文件
        if (entry.includes('.test.') || entry.includes('.spec.') || entry.endsWith('.d.ts')) {
          continue;
        }
        
        try {
          const result = await this.loadToolFromPath(fullPath, options);
          if (result) {
            results.push(result);
          }
        } catch (error) {
          console.error(`❌ 加载工具失败: ${fullPath}`, error);
          results.push({
            plugin: {
              metadata: {
                id: entry,
                name: entry,
                description: '加载失败',
                version: '0.0.0',
              },
              create: () => [],
            },
            tools: [],
            status: 'error',
            error: getErrorMessage(error),
          });
        }
      }
    } catch (error) {
      console.error(`❌ 扫描工具目录失败: ${directory}`, error);
    }
    
    return results;
  }
  
  /**
   * 从文件路径加载工具
   * 
   * @param filePath - 文件路径
   * @param options - 创建选项
   * @returns 加载结果
   */
  private async loadToolFromPath(
    filePath: string,
    options: ToolCreateOptions
  ): Promise<ToolLoadResult | null> {
    try {
      // 动态导入模块
      const module = await import(filePath);
      
      // 查找导出的工具插件
      const plugin = module.default || module.plugin || module.toolPlugin;
      
      if (!plugin || !plugin.metadata || !plugin.create) {
        console.warn(`⚠️ ${filePath} 不是有效的工具插件`);
        return null;
      }
      
      // 注册插件
      this.register(plugin);
      
      // 检查是否启用
      const config = this.toolConfigs.get(plugin.metadata.id);
      if (config && !config.enabled) {
        console.log(`⏭️ 工具已禁用: ${plugin.metadata.id}`);
        return {
          plugin,
          tools: [],
          status: 'disabled',
        };
      }
      
      // 初始化插件
      if (plugin.initialize) {
        await plugin.initialize(options);
      }
      
      // 创建工具实例
      const toolsOrTool = await plugin.create({
        ...options,
        config: config?.config,
      });
      
      const tools = Array.isArray(toolsOrTool) ? toolsOrTool : [toolsOrTool];
      
      // 保存工具实例
      this.loadedTools.set(plugin.metadata.id, tools);
      
      console.log(`✅ 工具已加载: ${plugin.metadata.id} (${tools.length} 个工具)`);
      
      return {
        plugin,
        tools,
        status: 'loaded',
      };
    } catch (error) {
      console.error(`❌ 加载工具失败: ${filePath}`, error);
      throw error;
    }
  }
  
  /**
   * 获取所有已加载的工具
   * 
   * @returns 工具数组
   */
  getAllTools(): AgentTool[] {
    const allTools: AgentTool[] = [];
    
    for (const tools of this.loadedTools.values()) {
      allTools.push(...tools);
    }
    
    return allTools;
  }
  
  /**
   * 获取工具插件
   * 
   * @param id - 工具 ID
   * @returns 工具插件
   */
  getPlugin(id: string): ToolPlugin | undefined {
    return this.plugins.get(id);
  }
  
  /**
   * 获取工具实例
   * 
   * @param id - 工具 ID
   * @returns 工具实例数组
   */
  getTools(id: string): AgentTool[] | undefined {
    return this.loadedTools.get(id);
  }
  
  /**
   * 设置工具配置
   * 
   * @param id - 工具 ID
   * @param config - 工具配置
   */
  setToolConfig(id: string, config: ToolConfig): void {
    this.toolConfigs.set(id, config);
  }
  
  /**
   * 获取工具配置
   * 
   * @param id - 工具 ID
   * @returns 工具配置
   */
  getToolConfig(id: string): ToolConfig | undefined {
    return this.toolConfigs.get(id);
  }
  
  /**
   * 清理所有工具
   */
  async cleanup(): Promise<void> {
    console.log('🔄 清理工具...');
    
    for (const plugin of this.plugins.values()) {
      if (plugin.cleanup) {
        try {
          await plugin.cleanup();
        } catch (error) {
          console.error(`❌ 清理工具失败: ${plugin.metadata.id}`, error);
        }
      }
    }
    
    this.plugins.clear();
    this.loadedTools.clear();
    
    console.log('✅ 工具清理完成');
  }
  
  /**
   * 获取工具列表（用于 UI 显示）
   * 
   * @returns 工具元数据数组
   */
  getToolList(): Array<{
    id: string;
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    category?: string;
  }> {
    const list: Array<{
      id: string;
      name: string;
      description: string;
      version: string;
      enabled: boolean;
      category?: string;
    }> = [];
    
    for (const plugin of this.plugins.values()) {
      const config = this.toolConfigs.get(plugin.metadata.id);
      
      list.push({
        id: plugin.metadata.id,
        name: plugin.metadata.name,
        description: plugin.metadata.description,
        version: plugin.metadata.version,
        enabled: config?.enabled !== false,
        category: plugin.metadata.category,
      });
    }
    
    return list;
  }
}

/**
 * 全局工具注册表实例
 */
let globalRegistry: ToolRegistry | null = null;

/**
 * 获取全局工具注册表
 * 
 * @returns 工具注册表实例
 */
export function getToolRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry();
  }
  return globalRegistry;
}
