import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const sourceFiles = execFileSync('rg', ['--files', 'src/main', 'src/server', 'src/renderer', 'scripts'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

const movedRoots = [
  ['src/main/admin-control-plane', 'src/main/domains/admin-control-plane'],
  ['src/main/agent-runtime', 'src/main/domains/agent-runtime'],
  ['src/main/analytics', 'src/main/domains/analytics'],
  ['src/main/browser-act', 'src/main/domains/browser-act'],
  ['src/main/connectors', 'src/main/domains/connectors'],
  ['src/main/prompts', 'src/main/domains/prompts'],
  ['src/main/scheduled-tasks', 'src/main/domains/scheduled-tasks'],
  ['src/main/session', 'src/main/domains/sessions'],
  ['src/main/store-matcher', 'src/main/domains/stores'],
  ['src/main/tools', 'src/main/domains/tools'],
  ['src/main/config', 'src/main/infrastructure/config/constants'],
  ['src/main/context', 'src/main/infrastructure/context'],
  ['src/main/database', 'src/main/infrastructure/database'],
  ['src/main/ipc', 'src/main/infrastructure/ipc'],
  ['src/main/utils', 'src/main/infrastructure/utils'],
  ['src/main/browser', 'src/main/infrastructure/browser'],
];

const movedFiles = [
  ['src/main/config.ts', 'src/main/infrastructure/config/index.ts'],
  ['src/main/config/constants.ts', 'src/main/infrastructure/config/constants/app-constants.ts'],
  ['src/main/gateway.ts', 'src/main/infrastructure/gateway/gateway.ts'],
  ['src/main/gateway-tab.ts', 'src/main/infrastructure/gateway/gateway-tab.ts'],
  ['src/main/gateway-message.ts', 'src/main/infrastructure/gateway/gateway-message.ts'],
  ['src/main/gateway-connector.ts', 'src/main/infrastructure/gateway/gateway-connector.ts'],
  ['src/main/index.ts', 'src/main/app/electron/index.ts'],
  ['src/main/preload.ts', 'src/main/app/preload/preload.ts'],
];

function normalizePath(value) {
  return value.split(sep).join('/');
}

function applyMove(path) {
  const normalized = normalizePath(path);
  for (const [from, to] of movedFiles) {
    const base = from.replace(/\.ts$/, '');
    if (normalized === base || normalized === from) {
      return to.replace(/\.ts$/, '');
    }
  }
  for (const [from, to] of movedRoots) {
    if (normalized === from || normalized.startsWith(`${from}/`)) {
      return `${to}${normalized.slice(from.length)}`;
    }
  }
  return normalized;
}

function unapplyMove(path) {
  const normalized = normalizePath(path);
  for (const [from, to] of movedFiles) {
    const toBase = to.replace(/\.ts$/, '');
    const fromBase = from.replace(/\.ts$/, '');
    if (normalized === toBase || normalized === to) {
      return fromBase;
    }
  }
  for (const [from, to] of movedRoots) {
    if (normalized === to || normalized.startsWith(`${to}/`)) {
      return `${from}${normalized.slice(to.length)}`;
    }
  }
  return normalized;
}

function toSpecifier(fromFile, targetNoExt) {
  const fromDir = dirname(resolve(root, fromFile));
  const target = resolve(root, targetNoExt);
  let next = normalizePath(relative(fromDir, target));
  if (!next.startsWith('.')) next = `./${next}`;
  return next;
}

function moduleExists(target) {
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    `${target}.mjs`,
    `${target}.json`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
    `${target}/index.js`,
    `${target}/index.mjs`,
  ];
  return candidates.some(candidate => existsSync(resolve(root, candidate)));
}

function candidateFromKnownRoot(parts) {
  const rootMappings = new Map([
    ['admin-control-plane', ['domains', 'admin-control-plane']],
    ['agent-runtime', ['domains', 'agent-runtime']],
    ['analytics', ['domains', 'analytics']],
    ['browser-act', ['domains', 'browser-act']],
    ['connectors', ['domains', 'connectors']],
    ['prompts', ['domains', 'prompts']],
    ['scheduled-tasks', ['domains', 'scheduled-tasks']],
    ['session', ['domains', 'sessions']],
    ['sessions', ['domains', 'sessions']],
    ['store-matcher', ['domains', 'stores']],
    ['stores', ['domains', 'stores']],
    ['tools', ['domains', 'tools']],
    ['browser', ['infrastructure', 'browser']],
    ['config', ['infrastructure', 'config']],
    ['context', ['infrastructure', 'context']],
    ['database', ['infrastructure', 'database']],
    ['gateway', ['infrastructure', 'gateway']],
    ['ipc', ['infrastructure', 'ipc']],
    ['utils', ['infrastructure', 'utils']],
  ]);

  for (const marker of ['domains', 'infrastructure']) {
    const index = parts.indexOf(marker);
    if (index >= 0) {
      const target = `src/main/${parts.slice(index).join('/')}`;
      if (moduleExists(target)) return target;
    }
  }

  for (const marker of ['shared', 'types']) {
    const index = parts.indexOf(marker);
    if (index >= 0) {
      const target = `src/${parts.slice(index).join('/')}`;
      if (moduleExists(target)) return target;
    }
  }

  for (let index = 0; index < parts.length; index += 1) {
    const mappedRoot = rootMappings.get(parts[index]);
    if (!mappedRoot) continue;

    let rest = parts.slice(index + 1);
    if (parts[index] === 'config' && rest[0] === 'constants' && rest[1] === 'index') {
      rest = ['index', ...rest.slice(2)];
    }
    if (parts[index] === 'config' && rest[0] === 'constants' && rest[1] === 'constants') {
      rest = ['constants', ...rest.slice(2)];
    }

    const target = `src/main/${[...mappedRoot, ...rest].join('/')}`;
    if (moduleExists(target)) return target;
  }

  return null;
}

function rewriteSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  const currentAbs = resolve(dirname(resolve(root, fromFile)), specifier);
  const currentRel = normalizePath(relative(root, currentAbs));
  if (moduleExists(currentRel)) return specifier;

  const parts = normalizePath(specifier).split('/').filter(part => part && part !== '.');
  const knownTarget = candidateFromKnownRoot(parts);
  if (knownTarget) return toSpecifier(fromFile, knownTarget);

  const oldFromFile = unapplyMove(fromFile);
  const oldTargetAbs = resolve(dirname(resolve(root, oldFromFile)), specifier);
  const oldTargetRel = normalizePath(relative(root, oldTargetAbs));
  if (!oldTargetRel.startsWith('src/')) return specifier;
  const newTargetRel = oldTargetRel.startsWith('src/main/') ? applyMove(oldTargetRel) : oldTargetRel;
  if (!moduleExists(newTargetRel)) return specifier;
  return toSpecifier(fromFile, newTargetRel);
}

for (const file of sourceFiles) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
  let content = readFileSync(file, 'utf8');
  const original = content;
  content = content.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, prefix, specifier, suffix) => {
    return `${prefix}${rewriteSpecifier(file, specifier)}${suffix}`;
  });
  content = content.replace(/(require\(\s*['"])(\.[^'"]+)(['"]\s*\))/g, (_, prefix, specifier, suffix) => {
    return `${prefix}${rewriteSpecifier(file, specifier)}${suffix}`;
  });
  content = content.replace(/(import\(\s*['"])(\.[^'"]+)(['"]\s*\))/g, (_, prefix, specifier, suffix) => {
    return `${prefix}${rewriteSpecifier(file, specifier)}${suffix}`;
  });
  if (content !== original) {
    writeFileSync(file, content);
  }
}
