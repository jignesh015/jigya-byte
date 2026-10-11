// Read-only audit: reports file names and categories, never credential values.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let temporary;
try {
  let gitArgs = [];
  let hasRepository = false;
  try { hasRepository = git(['rev-parse', '--is-inside-work-tree']).trim() === 'true'; } catch { /* Initial publication. */ }
  if (!hasRepository) {
    temporary = mkdtempSync(join(tmpdir(), 'jigyabyte-audit-'));
    git(['init', '--bare', '--quiet', temporary]);
    gitArgs = [`--git-dir=${temporary}`, `--work-tree=${root}`];
  }
  const files = [...new Set(git([...gitArgs, 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  const issues = new Set();
  const secrets = new Set();
  // Compare local environment credentials against all publishable bytes, including binaries.
  // Skip generated/dependency trees when finding private environment files.
  function collectEnv(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '.expo', '.gradle', '.cxx', 'build', 'artifacts'].includes(entry.name)) collectEnv(path);
      } else if (/^\.env|\.env(?:\.|$)/i.test(entry.name)) {
        for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
          const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/);
          if (!match || !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(match[1])) continue;
          let value = match[2];
          if (/^['"`]/.test(value)) value = value.slice(1, value.lastIndexOf(value[0]));
          else value = value.split(/\s+#/)[0].trim();
          if (value.length >= 8) secrets.add(value);
        }
      }
    }
  }
  collectEnv(root);
  const patterns = [
    ['Google API key', /AIza[\w-]{35}/g],
    ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
    ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
    ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}/g],
    ['npm token', /\bnpm_[A-Za-z0-9]{36,}/g],
    ['Stripe secret key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g],
    ['JWT token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}/g],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
    ['authenticated URL', /https?:\/\/[^\s/"'<>:]+:[^\s/@"'<>]+@/g],
    ['personal Windows path', /[A-Za-z]:[\\/]Users[\\/](?!Public\b|Default\b)[^\s"'<>]+/g],
  ];
  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    if (/(?:^|\/)\.env[^/]*$|\.env(?:\.|$)|\.(?:keystore|jks|p12|pfx|pem|key|sqlite|db)(?:-|$)/i.test(file)) {
      issues.add(`${file}: private environment, signing key or database is publishable`);
    }
    for (const secret of secrets) {
      if (bytes.includes(Buffer.from(secret))) issues.add(`${file}: matches a local environment credential`);
    }
    const text = bytes.toString('utf8');
    for (const [label, pattern] of patterns) {
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split('\n').length;
        issues.add(`${file}:${line}: ${label}`);
      }
    }
  }
  // Prove the root rules cover both real files and future nested env variants.
  const probes = ['.env', '.env.local', '.env.example', 'backend/.env', 'nested/deeper/.env.production',
    'nested/service.env', 'nested/service.env.backup', 'backend/data/backend.sqlite',
    'android/app/debug.keystore', 'android/local.properties', '.idea/workspace.xml',
    'artifacts/backend-launcher/JigyaByte Backend.exe'];
  const ignored = new Set(execFileSync('git', [...gitArgs, 'check-ignore', '--no-index', '--stdin'], {
    cwd: root, encoding: 'utf8', input: probes.join('\n') + '\n',
  }).trim().split(/\r?\n/));
  for (const probe of probes) if (!ignored.has(probe)) issues.add(`${probe}: required ignore rule missing`);
  const template = 'backend/env.example';
  if (!files.includes(template)) issues.add(`${template}: safe setup template is not publishable`);
  console.log(`Scanned ${files.length} publishable files; compared ${secrets.size} local credential values without printing them.`);
  for (const issue of issues) console.error(issue);
  if (issues.size) process.exitCode = 1;
  else console.log('PASS: no local credential matches or recognized secret patterns in publishable files.');
  if (probes.every(probe => ignored.has(probe))) console.log('PASS: environment, signing key, database, IDE and launcher artifact ignore rules.');
  if (!hasRepository) console.log('No Git repository exists here yet; commit history could not be audited.');
  else console.log('This scans current files, including tracked files; it does not audit earlier commits.');
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
