import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { createClient, ApiError } from './api.js';
import { DEFAULT_API_URL, readConfig, updateConfig, writeConfig, configPath } from './config.js';
import { collectSamples, validateSamples, firstLine, UsageError, countWords } from './samples.js';
import { HELP } from './help.js';

export const VERSION = '0.1.0';

const OPTIONS = {
  json: { type: 'boolean' },
  key: { type: 'string' },
  'api-url': { type: 'string' },
  dir: { type: 'string' },
  name: { type: 'string' },
  stdin: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  'no-wait': { type: 'boolean' },
  profile: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

async function readStdin() {
  let s = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) s += c;
  return s;
}

async function askYesNo(question) {
  const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stderr });
  try {
    const a = await rl.question(question + ' [y/N] ');
    return /^y(es)?$/i.test(a.trim());
  } finally {
    rl.close();
  }
}

const defaultIo = () => ({
  fetch: globalThis.fetch,
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  readStdin,
  confirm: askYesNo,
  interactive: Boolean(process.stdin.isTTY),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs: 3000,
  pollTimeoutMs: 5 * 60 * 1000,
});

/** Run the CLI. Returns the exit code. `io` is injectable for tests. */
export async function main(argv, ioOverrides = {}) {
  const io = { ...defaultIo(), ...ioOverrides };
  let args;
  try {
    args = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    io.stderr(`${e.message}\nRun "scriptgrain --help".\n`);
    return 2;
  }
  const { values: v, positionals: pos } = args;
  const json = Boolean(v.json);
  const say = (obj, human) => io.stdout(json ? JSON.stringify(obj, null, 2) + '\n' : human.join('\n') + '\n');

  if (v.version) { io.stdout(VERSION + '\n'); return 0; }
  if (v.help || pos.length === 0 || pos[0] === 'help') { io.stdout(HELP); return pos.length === 0 && !v.help ? 2 : 0; }

  const cfg = readConfig(io.env);
  const baseUrl = v['api-url'] || io.env.SCRIPTGRAIN_API_URL || cfg.api_url || DEFAULT_API_URL;
  const token = v.key || io.env.SCRIPTGRAIN_API_KEY || cfg.api_key || cfg.guest_token;
  const isGuest = Boolean(token && token.startsWith('sg_guest_'));
  const client = (t = token) => createClient({ baseUrl, token: t, fetch: io.fetch });
  const needToken = () => {
    if (!token) throw new UsageError('Not signed in. Run "scriptgrain try" for a free guest session, or "scriptgrain login".');
  };

  try {
    const [cmd, sub] = pos;
    switch (cmd) {
      case 'try': {
        const g = await client(null).mintGuest();
        updateConfig({ guest_token: g.guest_token, guest_expires_at: g.expires_at, claim_url: g.claim_url, api_url: v['api-url'] || cfg.api_url }, io.env);
        say({ ok: true, expires_at: g.expires_at, claim_url: g.claim_url, limits: g.limits, config: configPath(io.env) }, [
          'Guest session started (no account needed).',
          `  Expires:    ${g.expires_at}`,
          `  Claim link: ${g.claim_url}`,
          `  Limits:     ${g.limits ? `${g.limits.profiles} profile, ${g.limits.extractions} analysis, ${g.limits.generations} generations` : 'n/a'}`,
          '',
          'Next: scriptgrain profile create <files...>   (use the user\'s own writing, exact words)',
          'Claim the profile before it expires to keep it and start writing in this voice.',
        ]);
        return 0;
      }
      case 'profile': {
        if (sub === 'create') return await profileCreate({ v, pos: pos.slice(2), io, client, needToken, isGuest, json, say, cfg });
        if (sub === 'list') {
          needToken();
          const r = await client().listProfiles();
          const rows = r.data || [];
          say(r, rows.length ? rows.map((p) => `${p.id}  ${p.status}  ${p.sample_count ?? '?'} samples  ${p.name || ''}`) : ['No profiles.']);
          return 0;
        }
        if (sub === 'show') {
          needToken();
          if (!pos[2]) throw new UsageError('Usage: scriptgrain profile show <id>');
          const p = await client().getProfile(pos[2]);
          say(p, describeProfile(p));
          return 0;
        }
        throw new UsageError('Usage: scriptgrain profile create|list|show');
      }
      case 'check': {
        needToken();
        if (!pos[1] || !v.profile) throw new UsageError('Usage: scriptgrain check <file> --profile <id>');
        const text = readText(pos[1]);
        const r = await client().voiceMatch({ profile_id: v.profile, text });
        say(r, [`Voice match: ${r.voice_match_score}`, ...(r.voice_match_notes ? [String(r.voice_match_notes)] : [])]);
        return 0;
      }
      case 'compare': {
        needToken();
        const [, main_, ...others] = pos;
        if (!main_ || others.length < 1 || others.length > 3) throw new UsageError('Usage: scriptgrain compare <main> <other> [<other> [<other>]]  (1-3 others)');
        const mk = (p) => ({ label: p, text: readText(p) });
        const r = await client().compareVoice({ main: mk(main_), others: others.map(mk) });
        const rows = (r.results || []).map((x) => `${x.label}: ${x.score} (${x.band})`);
        say(r, [`Compared against ${main_}`, ...rows, ...(r.summary ? [`Average ${r.summary.average}`] : [])]);
        return 0;
      }
      case 'claim':
      case 'status': {
        needToken();
        if (!isGuest) {
          say({ type: 'account', claimed: true }, ['Signed in with an API key (a full account). Nothing to claim.']);
          return 0;
        }
        const s = await client().guestStatus();
        const url = s.claim_url || cfg.claim_url;
        say({ type: 'guest', ...s, claim_url: url }, [
          s.claimed ? 'Claimed. Run "scriptgrain login" with your sg_live_ key.' : cmd === 'claim' ? `Claim your profile: ${url}` : 'Guest session',
          `  Expires: ${s.expires_at}`,
          ...(cmd === 'status' ? [`  Claim link: ${url}`] : []),
          ...(s.archived ? ['  Archived: the claim link still restores it.'] : []),
        ]);
        return 0;
      }
      case 'login': {
        let key = v.key;
        if (!key) {
          if (!io.interactive) throw new UsageError('Pass --key sg_live_... (no terminal to prompt).');
          const rl = (await import('node:readline/promises')).createInterface({ input: process.stdin, output: process.stderr });
          key = (await rl.question('API key (sg_live_...): ')).trim();
          rl.close();
        }
        if (!/^sg_live_\S+$/.test(key)) throw new UsageError('That does not look like an sg_live_ API key.');
        updateConfig({ api_key: key }, io.env);
        say({ ok: true, config: configPath(io.env) }, [`Key stored in ${configPath(io.env)} (mode 600).`]);
        return 0;
      }
      case 'logout': {
        const next = { ...cfg };
        delete next.api_key; delete next.guest_token; delete next.guest_expires_at; delete next.claim_url;
        writeConfig(next, io.env);
        say({ ok: true }, ['Stored credentials removed.']);
        return 0;
      }
      default:
        throw new UsageError(`Unknown command "${cmd}". Run "scriptgrain --help".`);
    }
  } catch (e) {
    return fail(e, { io, json, cfg, isGuest });
  }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { throw new UsageError(`Cannot read ${p}: ${e.code || e.message}`); }
}

function describeProfile(p) {
  const lines = [`Profile ${p.id || ''}  status: ${p.status}`];
  if (p.status === 'processing' && p.progress_percent != null) lines.push(`  progress: ${p.progress_percent}%`);
  if (p.status === 'failed') lines.push(`  error: ${p.last_error || 'unknown'}`);
  if (p.confidence_score != null) lines.push(`  confidence: ${p.confidence_score}`);
  if (p.narrative) lines.push('', String(p.narrative));
  if (p.attributes && typeof p.attributes === 'object') {
    const entries = Object.entries(p.attributes).slice(0, 8);
    if (entries.length) {
      lines.push('', 'Top attributes:');
      for (const [k, val] of entries) {
        const s = typeof val === 'string' ? val : JSON.stringify(val);
        lines.push(`  ${k}: ${s.length > 100 ? s.slice(0, 99) + '…' : s}`);
      }
    }
  }
  return lines;
}

async function profileCreate({ v, pos, io, client, needToken, isGuest, json, say, cfg }) {
  needToken();
  if (v.stdin && !v.yes) throw new UsageError('--stdin uses up standard input, so it cannot prompt. Show the user what you are sending, then pass --yes.');
  const stdinText = v.stdin ? await io.readStdin() : undefined;
  const samples = collectSamples({ files: pos, dir: v.dir, stdinText });
  const { total } = validateSamples(samples, { guest: isGuest });

  const preview = samples.map((s) => ({ source: s.source, first_line: firstLine(s.text), words: s.words }));
  if (!json || !v.yes) {
    io.stderr(`About to send ${samples.length} sample(s), ${total} words, to ScriptGrain:\n`);
    for (const p of preview) io.stderr(`  ${p.source}: "${p.first_line}" (${p.words} words)\n`);
  }
  if (!v.yes) {
    if (!io.interactive) throw new UsageError('Confirmation needed and no terminal to ask. Show the user the list above, then re-run with --yes.');
    if (!(await io.confirm('Send these?'))) throw new UsageError('Cancelled. Nothing was sent.');
  }

  const body = { samples: samples.map((s) => s.text) };
  if (v.name) body.name = v.name;
  const c = client();
  const created = await c.createProfile(body);
  const id = created.profile_id;
  if (v['no-wait']) {
    say({ ...created, samples_sent: preview }, [`Profile ${id} is processing. Check with: scriptgrain profile show ${id}`]);
    return 0;
  }
  io.stderr('Analysing your writing…\n');
  const started = Date.now();
  let p;
  for (;;) {
    p = await c.getProfile(id);
    if (p.status === 'complete' || p.status === 'failed') break;
    if (Date.now() - started > io.pollTimeoutMs) throw new ApiError(0, 'poll_timeout', `Still processing after ${Math.round(io.pollTimeoutMs / 1000)}s. Check later: scriptgrain profile show ${id}`);
    await io.sleep(io.pollMs);
  }
  if (p.status === 'failed') throw new ApiError(0, 'extraction_failed', `Profile extraction failed: ${p.last_error || 'unknown error'}`);
  const claim = isGuest ? readConfigClaim(io, cfg) : undefined;
  say({ ...p, samples_sent: preview, ...(claim ? { claim_url: claim } : {}) }, [
    ...describeProfile(p),
    ...(claim ? ['', `Claim it to keep it and start writing in this voice: ${claim}`] : []),
  ]);
  return 0;
}

const readConfigClaim = (io, cfg) => readConfig(io.env).claim_url || cfg.claim_url;

function fail(e, { io, json, cfg, isGuest }) {
  let code = 'error', message = e.message, status, extra = {};
  let exit = 1;
  if (e instanceof UsageError) { code = 'invalid_usage'; exit = 2; }
  else if (e instanceof ApiError) {
    code = e.code; status = e.status;
    const claim = cfg.claim_url;
    if (code === 'guest_not_allowed') {
      message = 'Guest sessions cannot do that.' + (claim ? ` Claim your profile to start writing in this voice: ${claim}` : ' Claim your profile to start writing in this voice.');
      extra.claim_url = claim;
    } else if (code === 'guest_expired') {
      message = `Your guest session has expired.${claim ? ` The claim link still works: ${claim}` : ''} Run "scriptgrain try" to start a new one.`;
      extra.claim_url = claim;
    } else if (code === 'guest_claimed') {
      message = 'This guest session has been claimed. Create an API key in your account and run "scriptgrain login".';
    } else if (code === 'rate_limited') {
      message = `Rate limited.${e.retryAfter ? ` Retry in ${e.retryAfter}s.` : ' Try again later.'}`;
      if (e.retryAfter) extra.retry_after = e.retryAfter;
    } else if (code === 'guest_unavailable') {
      message = `Guest sessions are unavailable right now (${e.message}). Sign up free at https://scriptgrain.com.`;
    } else if (e.status === 401) {
      message = `${e.message} Check your key or run "scriptgrain login".`;
    }
    if (e.requestId) extra.request_id = e.requestId;
  }
  if (json) io.stdout(JSON.stringify({ error: { code, message, ...(status ? { status } : {}), ...extra } }, null, 2) + '\n');
  else io.stderr(`Error: ${message}\n`);
  return exit;
}
