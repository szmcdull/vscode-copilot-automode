import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', '..');
}

describe('install documentation (root READMEs)', () => {
  it('README.md 收口到 npm install + npm run install:vscode、.artifacts 产物与运行时目录', async () => {
    const text = await readFile(path.join(repoRoot(), 'README.md'), 'utf8');
    expect(text).toMatch(/npm install/);
    expect(text).toContain('npm run install:vscode');
    expect(text).toContain('.artifacts/auto-mode.vsix');
    expect(text).toMatch(/~\/\.auto-mode\/vscode-plugin|\.auto-mode\/vscode-plugin/);
    expect(text).toMatch(/settings\.json/i);
    expect(text).toMatch(/merge|update|safe/i);
    // 旧的手工安装路径不应再作为主路径出现
    expect(text).not.toContain('adapter-vscode/auto-mode');
    expect(text).not.toContain('code --install-extension ./adapter-vscode');
    expect(text).not.toContain('/absolute/path/to/auto-mode/plugin-vscode-hooks');
  });

  it('README.md 说明先安装 adapter-vscode 依赖，再从仓库根运行 install:vscode', async () => {
    const text = await readFile(path.join(repoRoot(), 'README.md'), 'utf8');
    expect(text).toMatch(/cd adapter-vscode[\s\S]{0,80}npm install/);
    expect(text).toMatch(/### 2\.[\s\S]{0,120}```bash[\s\S]{0,40}npm run install:vscode/);
    expect(text).not.toMatch(/### 2\.[\s\S]{0,120}```bash[\s\S]{0,40}cd \.\./);
    expect(text).not.toMatch(/### 1\.[\s\S]{0,120}repository root[\s\S]{0,80}npm install/i);
  });

  it('README.md 提醒迁移旧的 repo-local plugin 路径，避免两份 plugin 来源并存', async () => {
    const text = await readFile(path.join(repoRoot(), 'README.md'), 'utf8');
    expect(text).toContain('chat.pluginLocations');
    expect(text).toMatch(/plugin-vscode-hooks/);
    expect(text).toMatch(/preserve|keeps|append|appends|retains/i);
    expect(text).toMatch(/remove the old repo-local entry|remove the old .*plugin-vscode-hooks/i);
  });

  it('README.md 不把 host plugins 描述成无条件启用，并提醒显式关闭时需手动开启', async () => {
    const text = await readFile(path.join(repoRoot(), 'README.md'), 'utf8');
    expect(text).toContain('chat.plugins.enabled');
    expect(text).toMatch(/missing|缺失/i);
    expect(text).toMatch(/if you have explicitly disabled host plugins|if you explicitly disabled host plugins/i);
    expect(text).not.toMatch(/enable host plugins and point/i);
    expect(text).not.toMatch(/will enable host plugins/i);
  });

  it('README.md 不把 adapter-vscode/README.md 当作常规安装主入口', async () => {
    const text = await readFile(path.join(repoRoot(), 'README.md'), 'utf8');
    if (text.includes('adapter-vscode/README.md')) {
      expect(text).toMatch(/adapter-vscode\/README\.md[\s\S]{0,160}(development|implementation|internal|details)/i);
    }
  });

  it('README_cn.md 与英文版一致的安装入口与产物路径', async () => {
    const text = await readFile(path.join(repoRoot(), 'README_cn.md'), 'utf8');
    expect(text).toMatch(/npm install/);
    expect(text).toContain('npm run install:vscode');
    expect(text).toContain('.artifacts/auto-mode.vsix');
    expect(text).toMatch(/~\/\.auto-mode\/vscode-plugin|\.auto-mode\/vscode-plugin/);
    expect(text).toMatch(/settings\.json/i);
    expect(text).toMatch(/合并|更新|安全|safe|merge|update/i);
    expect(text).not.toContain('adapter-vscode/auto-mode');
    expect(text).not.toContain('code --install-extension ./adapter-vscode');
    expect(text).not.toContain('/absolute/path/to/auto-mode/plugin-vscode-hooks');
  });

  it('README_cn.md 说明先安装 adapter-vscode 依赖，再从仓库根运行 install:vscode', async () => {
    const text = await readFile(path.join(repoRoot(), 'README_cn.md'), 'utf8');
    expect(text).toMatch(/cd adapter-vscode[\s\S]{0,80}npm install/);
    expect(text).toMatch(/### 2\.[\s\S]{0,120}```bash[\s\S]{0,40}npm run install:vscode/);
    expect(text).not.toMatch(/### 2\.[\s\S]{0,120}```bash[\s\S]{0,40}cd \.\./);
    expect(text).not.toMatch(/### 1\.[\s\S]{0,120}仓库根目录[\s\S]{0,80}npm install/);
  });

  it('README_cn.md 提醒迁移旧的 repo-local plugin 路径，避免两份 plugin 来源并存', async () => {
    const text = await readFile(path.join(repoRoot(), 'README_cn.md'), 'utf8');
    expect(text).toContain('chat.pluginLocations');
    expect(text).toMatch(/plugin-vscode-hooks/);
    expect(text).toMatch(/保留|追加|附加/);
    expect(text).toMatch(/移除旧的 repo-local 条目|移除旧的.*plugin-vscode-hooks|删除旧的.*plugin-vscode-hooks/);
  });

  it('README_cn.md 不把 host plugins 描述成无条件启用，并提醒显式关闭时需手动开启', async () => {
    const text = await readFile(path.join(repoRoot(), 'README_cn.md'), 'utf8');
    expect(text).toContain('chat.plugins.enabled');
    expect(text).toMatch(/缺失|missing/i);
    expect(text).toMatch(/如果你曾显式关闭|若你曾显式关闭|需手动开启|需要手动开启/);
    expect(text).not.toMatch(/启用宿主插件并将\s*`chat\.pluginLocations`/);
    expect(text).not.toMatch(/会启用宿主插件/);
  });

  it('README_cn.md 不把 adapter-vscode/README.md 当作常规安装主入口', async () => {
    const text = await readFile(path.join(repoRoot(), 'README_cn.md'), 'utf8');
    if (text.includes('adapter-vscode/README.md')) {
      expect(text).toMatch(/adapter-vscode\/README\.md[\s\S]{0,160}(开发|实现细节|内部细节|仅供开发)/);
    }
  });
});

describe('install documentation (plugin-vscode-hooks README)', () => {
  it('说明仓库 plugin 为开发态，安装后生效目录为 ~/.auto-mode/vscode-plugin', async () => {
    const text = await readFile(path.join(repoRoot(), 'plugin-vscode-hooks', 'README.md'), 'utf8');
    expect(text).toMatch(/~\/\.auto-mode\/vscode-plugin|\.auto-mode\/vscode-plugin/);
    expect(text).toMatch(/source|development|dev|源码|开发/i);
    expect(text).toContain('npm run install:vscode');
  });

  it('将 repo-local 路径与安装态 runtime 路径明确分成 development-only 语义', async () => {
    const text = await readFile(path.join(repoRoot(), 'plugin-vscode-hooks', 'README.md'), 'utf8');
    expect(text).toMatch(/adapter-vscode\/dist\/hooks\/cli\.js[\s\S]{0,120}(development|development-only|local|source|repo)/i);
    expect(text).toMatch(/\.\/*scripts\/\*\.sh[\s\S]{0,120}(development|development-only|local|source|repo)/i);
    expect(text).toMatch(/\.\.\/adapter-vscode\/dist\/hooks\/cli\.js[\s\S]{0,120}(development|development-only|local|source|repo)/i);
    expect(text).toMatch(/~\/\.auto-mode\/hook-cli\/dist\/hooks\/cli\.js/);
  });

  it('提醒从旧 repo-local chat.pluginLocations 迁移到安装态路径', async () => {
    const text = await readFile(path.join(repoRoot(), 'plugin-vscode-hooks', 'README.md'), 'utf8');
    expect(text).toContain('chat.pluginLocations');
    expect(text).toMatch(/plugin-vscode-hooks/);
    expect(text).toMatch(/~\/\.auto-mode\/vscode-plugin/);
    expect(text).toMatch(/preserve|append|retain|保留|追加|附加/i);
    expect(text).toMatch(/remove the old repo-local entry|remove the old .*plugin-vscode-hooks|移除旧的.*plugin-vscode-hooks/i);
  });

  it('plugin README 的安装前置说明依赖安装发生在 adapter-vscode，而不是仓库根 npm install', async () => {
    const text = await readFile(path.join(repoRoot(), 'plugin-vscode-hooks', 'README.md'), 'utf8');
    expect(text).toMatch(/cd adapter-vscode[\s\S]{0,80}npm install[\s\S]{0,40}cd \.\./);
    expect(text).not.toMatch(/After you run \*\*`npm install`\*\* and \*\*`npm run install:vscode`\*\* from the \*\*repository root\*\*/);
  });
});
