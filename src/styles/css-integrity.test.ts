import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('..', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

/** Strip comments and quoted strings so their braces do not count. */
function stripNoise(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

describe('stylesheet integrity', () => {
  // A rule left unclosed does not fail the build: esbuild reads what follows as
  // CSS nesting and silently prefixes every later selector with the open one,
  // which is how the whole app once shipped without its design tokens.
  it.each(cssFiles(srcDir).map((f) => relative(srcDir, f)))('%s closes every rule', (name) => {
    const css = stripNoise(readFileSync(join(srcDir, name), 'utf8'));
    let depth = 0;
    for (const char of css) {
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      expect(depth, 'a } without a matching {').toBeGreaterThanOrEqual(0);
    }
    expect(depth, 'an unclosed { — later rules become nested').toBe(0);
  });
});
