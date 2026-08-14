declare namespace VoiceUP {
  type SettingType = 'text' | 'number' | 'range' | 'boolean' | 'select' | 'image';
  interface SettingField { key: string; label: string; description?: string; type: SettingType; default?: unknown; min?: number; max?: number; step?: number; options?: Array<string | { value: string; label: string }>; }
  interface User { id: string; clientId?: string; name: string; color: string; }
  interface PluginIdentity { id: string; name: string; icon?: string; }
  interface PluginApi {
    settings: Record<string, any>;
    systemMessage(room: string, textChannel: string, text: string, options?: { name?: string; color?: string; avatar?: string; avatarSetting?: string; pluginId?: string }): void;
    botCommand(room: string, payload?: Record<string, any>): void;
    media: { list(): string[]; url(name: string): string };
    storage: { get<T>(key: string, fallback: T): T; set<T>(key: string, value: T): T; delete(key: string): void };
    log(message: string): void;
  }
  interface MessageContext { text: string; room: string; textChannel: string; voiceChannel: string; user: User; serverIsCloud: boolean; plugin: PluginIdentity; api: PluginApi; }
  interface LifecycleContext { plugin: PluginIdentity; api: PluginApi; }
  interface AdminContext extends LifecycleContext { action: string; payload: Record<string, any>; }
  interface PluginDefinition {
    id: string; name: string; version?: string; description?: string; icon?: string; settings?: SettingField[];
    onTextMessage(context: MessageContext): void | Promise<void>;
    onEnable?(context: LifecycleContext): void | Promise<void>;
    onDisable?(context: LifecycleContext): void | Promise<void>;
    getAdminState?(context: LifecycleContext): unknown;
    onAdminAction?(context: AdminContext): { ok?: boolean; message?: string } | Promise<{ ok?: boolean; message?: string }>;
  }
}
