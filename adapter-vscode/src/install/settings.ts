const CHAT_PLUGINS_ENABLED = 'chat.plugins.enabled';
const CHAT_PLUGIN_LOCATIONS = 'chat.pluginLocations';

type PluginLocationMap = Record<string, unknown>;

function normalizePluginLocations(value: unknown): PluginLocationMap {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }

  return {};
}

/**
 * 合并 VS Code 用户 settings：在保留无关字段的前提下，补全 chat 插件相关键。
 */
export function mergeVscodeSettings(
  existing: Record<string, unknown>,
  pluginLocationAbsPath: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };

  if (!(CHAT_PLUGINS_ENABLED in out)) {
    out[CHAT_PLUGINS_ENABLED] = true;
  }

  const prev = out[CHAT_PLUGIN_LOCATIONS];
  const locations = normalizePluginLocations(prev);
  locations[pluginLocationAbsPath] = true;
  out[CHAT_PLUGIN_LOCATIONS] = locations;

  return out;
}
