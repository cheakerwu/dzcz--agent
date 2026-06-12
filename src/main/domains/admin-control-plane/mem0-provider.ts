export interface Mem0MemoryProvider {
  isEnabled(): boolean;
  addMemory(input: {
    id: string;
    content: string;
    scope: string;
    metadata: Record<string, unknown>;
  }): Promise<{ providerMemoryId?: string; status: 'synced' | 'disabled' | 'error'; error?: string }>;
  deleteMemory(providerMemoryId: string): Promise<{ status: 'deleted' | 'disabled' | 'error'; error?: string }>;
}

interface OptionalMem0ProviderConfig {
  enabled?: boolean;
  userId?: string;
  agentId?: string;
}

export class OptionalMem0Provider implements Mem0MemoryProvider {
  private clientPromise: Promise<any> | null = null;

  constructor(private readonly config: OptionalMem0ProviderConfig = {}) {}

  isEnabled(): boolean {
    return this.config.enabled === true;
  }

  async addMemory(input: {
    id: string;
    content: string;
    scope: string;
    metadata: Record<string, unknown>;
  }): Promise<{ providerMemoryId?: string; status: 'synced' | 'disabled' | 'error'; error?: string }> {
    if (!this.isEnabled()) {
      return { status: 'disabled' };
    }

    try {
      const client = await this.getClient();
      const metadata = {
        ...input.metadata,
        dianbotMemoryId: input.id,
        scope: input.scope,
      };
      const messages = [{ role: 'user', content: input.content }];
      const result = await client.add(messages, {
        userId: this.config.userId || 'dianbot-admin',
        agentId: this.config.agentId || 'dianbot',
        metadata,
      });
      const providerMemoryId =
        typeof result === 'string'
          ? result
          : result?.id || result?.memory_id || result?.results?.[0]?.id || input.id;
      return { status: 'synced', providerMemoryId };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteMemory(providerMemoryId: string): Promise<{ status: 'deleted' | 'disabled' | 'error'; error?: string }> {
    if (!this.isEnabled()) {
      return { status: 'disabled' };
    }

    try {
      const client = await this.getClient();
      if (typeof client.delete === 'function') {
        await client.delete(providerMemoryId);
      } else if (typeof client.deleteMemory === 'function') {
        await client.deleteMemory(providerMemoryId);
      }
      return { status: 'deleted' };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = this.createClient();
    }
    return this.clientPromise;
  }

  private async createClient(): Promise<any> {
    const mod: any = await import('mem0ai/oss');
    const Memory = mod.Memory || mod.default?.Memory || mod.default;
    if (!Memory) {
      throw new Error('mem0ai/oss did not export Memory');
    }
    return new Memory();
  }
}
