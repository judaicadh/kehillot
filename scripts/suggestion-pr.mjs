// Used by .github/workflows/suggestions.yml after scripts/issue-to-record.mjs.
// Commits the new record to a branch and opens a pull request (a draft if validation failed),
// then comments on the issue. Untrusted text from the issue is passed to git and gh as files
// or argument arrays, never through a shell.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts }).trim();
const issue = Number(process.env.ISSUE);
const valid = process.env.VALID === 'true';
const r = JSON.parse(await readFile('.cache/suggestion.json', 'utf8'));
const log = await readFile('.cache/build.log', 'utf8').catch(() => '');
const comment = async (text) => { await writeFile('.cache/comment.md', text); run('gh', ['issue', 'comment', String(issue), '--body-file', '.cache/comment.md']); };

if (!r.ok) {
  await comment(`Thanks for this suggestion. It could not be imported automatically: ${r.summary}\n\nAn editor can add it by hand.`);
  run('gh', ['issue', 'edit', String(issue), '--add-label', 'needs-editing']);
  process.exit(0);
}

const errors = log.split('\n').filter((l) => /^\s+\S/.test(l) && /✗|:/.test(l)).slice(0, 20).join('\n');
const checklist = r.needsEditing.map((t) => `- [ ] ${t}`).join('\n');
const body = [
  `Closes #${issue}.`, '',
  r.summary, '',
  checklist ? `### Before merging\n\n${checklist}` : '### Before merging\n\n- [ ] Check the record against the cited source.',
  '', valid ? '✅ The build validated this record.' : `⚠️ The build did not validate yet, so this is a draft. Fix these, then mark it ready:\n\n\`\`\`\n${errors || log.slice(-1500)}\n\`\`\``,
  '', '_Opened automatically when the suggestion was labelled `accepted`._',
].join('\n');

run('git', ['config', 'user.name', 'kehillot-suggestions[bot]']);
run('git', ['config', 'user.email', 'actions@users.noreply.github.com']);
run('git', ['checkout', '-B', r.branch]);
run('git', ['add', 'data/']);
await writeFile('.cache/commit.txt', `${r.title}\n\nFrom suggestion #${issue}.`);
run('git', ['commit', '-F', '.cache/commit.txt']);
run('git', ['push', '--force', 'origin', r.branch]);
await writeFile('.cache/pr.md', body);
const prArgs = ['pr', 'create', '--head', r.branch, '--base', 'main', '--title', r.title, '--body-file', '.cache/pr.md', '--label', 'suggestion'];
if (!valid) prArgs.push('--draft');
let url;
try { url = run('gh', prArgs); } catch { url = run('gh', ['pr', 'view', r.branch, '--json', 'url', '--jq', '.url']); }
await comment(`Thank you! This suggestion has been accepted and turned into a record for review: ${url}${valid ? '' : ' (it needs a little editing first)'}. It will appear on the site once that pull request is merged.`);
console.log(url);
