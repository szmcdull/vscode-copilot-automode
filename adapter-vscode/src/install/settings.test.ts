import { describe, expect, it } from 'vitest';
import { mergeVscodeSettings } from './settings.js';

describe('mergeVscodeSettings', () => {
  const pluginPath = '/opt/auto-mode/vscode-plugin';

  it('保留与 chat 无关的字段', () => {
    const merged = mergeVscodeSettings(
      {
        'editor.fontSize': 14,
        'files.autoSave': 'afterDelay',
      },
      pluginPath,
    );
    expect(merged['editor.fontSize']).toBe(14);
    expect(merged['files.autoSave']).toBe('afterDelay');
  });

  it('仅在 chat.plugins.enabled 缺失时补 true', () => {
    const merged = mergeVscodeSettings({}, pluginPath);
    expect(merged['chat.plugins.enabled']).toBe(true);
  });

  it('保留已有 chat.plugins.enabled 值（含 false）', () => {
    expect(
      mergeVscodeSettings({ 'chat.plugins.enabled': false }, pluginPath)['chat.plugins.enabled'],
    ).toBe(false);
    expect(
      mergeVscodeSettings({ 'chat.plugins.enabled': true }, pluginPath)['chat.plugins.enabled'],
    ).toBe(true);
  });

  it('保留已有对象形态的 chat.pluginLocations 并在缺失时追加目标路径且不重复', () => {
    const merged = mergeVscodeSettings(
      {
        'chat.pluginLocations': { '/a': true, '/b': true },
      },
      pluginPath,
    );
    expect(merged['chat.pluginLocations']).toEqual({ '/a': true, '/b': true, [pluginPath]: true });
  });

  it('chat.pluginLocations 缺失时创建对象映射并包含目标路径', () => {
    const merged = mergeVscodeSettings({}, pluginPath);
    expect(merged['chat.pluginLocations']).toEqual({ [pluginPath]: true });
  });

  it('已存在目标路径时不重复写入', () => {
    const merged = mergeVscodeSettings(
      {
        'chat.pluginLocations': { [pluginPath]: true, '/other': true },
      },
      pluginPath,
    );
    expect(merged['chat.pluginLocations']).toEqual({ [pluginPath]: true, '/other': true });
  });

  it('保留 chat.pluginLocations 里的脏数据与混合值，只为目标路径补 true', () => {
    const merged = mergeVscodeSettings(
      {
        'chat.pluginLocations': {
          '/keep-false': false,
          '/keep-string': 'yes',
          '/keep-number': 1,
          '/keep-true': true,
        },
      },
      pluginPath,
    );
    expect(merged['chat.pluginLocations']).toEqual({
      '/keep-false': false,
      '/keep-string': 'yes',
      '/keep-number': 1,
      '/keep-true': true,
      [pluginPath]: true,
    });
  });
});
