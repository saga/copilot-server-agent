import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillMeta {
  name: string;
  description?: string;
  directory: string;
}

/**
 * 内置技能目录 server/skills/。
 * 路径基于本文件位置解析，tsx(dev, src/skills) 与 tsc(dist, dist/skills) 下都指向 server/skills。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN_SKILL_DIR = path.resolve(here, '../../skills');

/** 极简 frontmatter 解析（只取 name/description，不引入 yaml 依赖） */
function parseFrontmatter(md: string): { name?: string; description?: string } {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*(name|description)\s*:\s*(.+?)\s*$/);
    if (m) {
      const key = m[1] as 'name' | 'description';
      out[key] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}

/**
 * 发现某目录下的技能：直接子目录中含 SKILL.md 的即为一个技能
 * （对应官方 skills 文档的目录结构约定）。
 */
export function discoverSkills(dir: string): SkillMeta[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((sub) => existsSync(path.join(dir, sub, 'SKILL.md')))
    .map((sub) => {
      const md = readFileSync(path.join(dir, sub, 'SKILL.md'), 'utf-8');
      const fm = parseFrontmatter(md);
      return {
        name: fm.name || sub,
        ...(fm.description ? { description: fm.description } : {}),
        directory: path.join(dir, sub),
      };
    });
}

/**
 * 解析本次会话的 skillDirectories：
 * - 默认带上内置 server/skills（`noBuiltinSkills: true` 可关掉）
 * - 额外目录不存在直接抛错（路由层转为 400），避免静默“技能没加载”
 */
export function resolveSkillDirectories(opts: {
  extra?: string[];
  includeBuiltin?: boolean;
}): string[] {
  const dirs: string[] = [];
  if (opts.includeBuiltin !== false && existsSync(BUILTIN_SKILL_DIR)) {
    dirs.push(BUILTIN_SKILL_DIR);
  }
  for (const d of opts.extra ?? []) {
    const abs = path.resolve(d);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new Error(`技能目录不存在：${d}（解析为 ${abs}）`);
    }
    dirs.push(abs);
  }
  return [...new Set(dirs)];
}
