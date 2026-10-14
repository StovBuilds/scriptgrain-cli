import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/main.js';

const words = (n, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const jres = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function harness(routes) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cli-'));
  const env = { SCRIPTGRAIN_CONFIG_DIR: path.join(tmp, 'cfg'), SCRIPTGRAIN_API_URL: 'https://api.test' };
  const calls = [];
  let out = '', err = '';
  const q = { ...routes };
  const io = {
    env,
    fetch: async (url, init) => {
      const key = `${init.method} ${url.replace('https://api.test', '')}`;
      calls.push({ key, auth: init.headers.authorization, body: init.body && JSON.parse(init.body) });
      const h = q[key];
      if (!h) throw new Error('unmocked ' + key);
      return typeof h === 'function' ? h() : h;
    },
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
    sleep: async () => {},
    interactive: false,
    pollMs: 0,
    pollTimeoutMs: 1000,
  };
  const run = (argv, extra = {}) => main(argv, { ...io, ...extra });
  return { tmp, env, calls, run, out: () => out, err: () => err, reset: () => { out = ''; err = ''; }, cfgFile: path.join(env.SCRIPTGRAIN_CONFIG_DIR, 'config.json') };
}

const GUEST = { guest_token: 'sg_guest_abc', expires_at: '2026-10-21T00:00:00Z', claim_url: 'https://scriptgrain.com/claim/xyz', limits: { profiles: 1, extractions: 1, generations: 0 } };

test('try -> create -> poll -> claim, config is mode 600', async () => {
  let polls = 0;
  const h = harness({
    'POST /v1/guest': jres(201, GUEST),
    'POST /v1/profiles': jres(202, { profile_id: 'p1', job_id: 'j', status: 'processing' }),
    'GET /v1/profiles/p1': () => (++polls < 3 ? jres(200, { id: 'p1', status: 'processing', progress_percent: 40 }) : jres(200, { id: 'p1', status: 'complete', narrative: 'Dry and direct.', attributes: { tone: 'wry' } })),
    'GET /v1/guest': () => jres(200, { claimed: false, archived: false, expires_at: GUEST.expires_at, claim_url: GUEST.claim_url }),
  });
  assert.equal(await h.run(['try']), 0);
  assert.match(h.out(), /sg_guest|Claim link: https:\/\/scriptgrain.com\/claim\/xyz/);
  assert.equal(fs.statSync(h.cfgFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(h.cfgFile)).mode & 0o777, 0o700);
  assert.equal(JSON.parse(fs.readFileSync(h.cfgFile, 'utf8')).guest_token, 'sg_guest_abc');

  const f = path.join(h.tmp, 'a.md');
  fs.writeFileSync(f, '# Title here\n' + words(80));
  h.reset();
  assert.equal(await h.run(['profile', 'create', f, '--yes', '--json']), 0);
  const res = JSON.parse(h.out());
  assert.equal(res.status, 'complete');
  assert.equal(res.samples_sent[0].words, 83);
  assert.equal(res.samples_sent[0].first_line, '# Title here');
  assert.equal(res.claim_url, GUEST.claim_url);
  assert.equal(polls, 3);
  assert.equal(h.calls.find((c) => c.key === 'POST /v1/profiles').auth, 'Bearer sg_guest_abc');

  h.reset();
  assert.equal(await h.run(['claim']), 0);
  assert.match(h.out(), /Claim your profile: https:\/\/scriptgrain.com\/claim\/xyz/);
  h.reset();
  assert.equal(await h.run(['status', '--json']), 0);
  assert.equal(JSON.parse(h.out()).claimed, false);
});

test('confirmation: shows first line + words, refuses without tty or --yes, sends nothing', async () => {
  const h = harness({});
  const f = path.join(h.tmp, 'a.txt');
  fs.writeFileSync(f, 'Hello there\n' + words(60));
  assert.equal(await h.run(['profile', 'create', f, '--key', 'sg_live_k']), 2);
  assert.match(h.err(), /"Hello there" \(62 words\)/);
  assert.match(h.err(), /--yes/);
  assert.equal(h.calls.length, 0);
  // interactive decline
  h.reset();
  assert.equal(await h.run(['profile', 'create', f, '--key', 'sg_live_k'], { interactive: true, confirm: async () => false }), 2);
  assert.equal(h.calls.length, 0);
});

test('--no-wait returns after create', async () => {
  const h = harness({ 'POST /v1/profiles': jres(202, { profile_id: 'p9', status: 'processing' }) });
  const f = path.join(h.tmp, 'a.txt');
  fs.writeFileSync(f, words(60));
  assert.equal(await h.run(['profile', 'create', f, '--yes', '--no-wait', '--name', 'Me', '--key', 'sg_live_k']), 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.name, 'Me');
  assert.deepEqual(h.calls[0].body.samples.length, 1);
});

test('--dir and --stdin gather samples; stdin needs --yes', async () => {
  const h = harness({ 'POST /v1/profiles': jres(202, { profile_id: 'p9', status: 'processing' }) });
  const d = path.join(h.tmp, 'd');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'one.txt'), words(60));
  fs.writeFileSync(path.join(d, 'two.md'), words(10));
  fs.writeFileSync(path.join(d, 'skip.pdf'), 'nope');
  assert.equal(await h.run(['profile', 'create', '--dir', d, '--stdin', '--key', 'sg_live_k'], { readStdin: async () => words(5) }), 2);
  assert.equal(await h.run(['profile', 'create', '--dir', d, '--stdin', '--yes', '--no-wait', '--key', 'sg_live_k'], { readStdin: async () => words(5) }), 0);
  assert.equal(h.calls[0].body.samples.length, 3);
});

test('local validation errors send nothing', async () => {
  const h = harness({});
  const mk = (n, words_) => { const f = path.join(h.tmp, n); fs.writeFileSync(f, words_); return f; };
  const k = ['--yes', '--key', 'sg_live_k'];
  assert.equal(await h.run(['profile', 'create', ...k]), 2);                                   // none
  assert.equal(await h.run(['profile', 'create', mk('short.txt', words(10)), ...k]), 2);      // <50
  assert.equal(await h.run(['profile', 'create', mk('big.txt', words(5001)), ...k]), 2);      // >5000
  assert.equal(await h.run(['profile', 'create', mk('x.pdf', words(80)), ...k]), 2);          // ext
  assert.equal(await h.run(['profile', 'create', ...Array.from({ length: 21 }, (_, i) => mk(`s${i}.txt`, words(60))), ...k]), 2);
  assert.equal(await h.run(['profile', 'create', '/nonexistent.txt', ...k]), 2);
  assert.equal(h.calls.length, 0);
  // guest total cap
  fs.mkdirSync(path.dirname(h.cfgFile), { recursive: true });
  const big = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => mk(n + '.txt', words(4900)));
  assert.equal(await h.run(['profile', 'create', ...big, '--yes', '--key', 'sg_guest_t']), 2);
  assert.match(h.err(), /25000/);
});

test('403 guest_not_allowed prints the claim link', async () => {
  const h = harness({ 'POST /v1/guest': jres(201, GUEST), 'GET /v1/profiles': () => jres(403, { error: { code: 'guest_not_allowed', message: 'nope' } }) });
  await h.run(['try']);
  h.reset();
  assert.equal(await h.run(['profile', 'list']), 1);
  assert.match(h.err(), /claim your profile to start writing in this voice/i);
  assert.match(h.err(), /scriptgrain.com\/claim\/xyz/);
  h.reset();
  assert.equal(await h.run(['profile', 'list', '--json']), 1);
  const e = JSON.parse(h.out()).error;
  assert.equal(e.code, 'guest_not_allowed');
  assert.equal(e.claim_url, GUEST.claim_url);
});

test('401 guest_expired / guest_claimed, 429, 503', async () => {
  const h = harness({
    'GET /v1/guest': () => jres(401, { error: { code: 'guest_expired', message: 'expired' } }),
    'POST /v1/guest': jres(429, { error: { code: 'rate_limited', message: 'slow' } }, { 'retry-after': '60' }),
  });
  assert.equal(await h.run(['status', '--key', 'sg_guest_x']), 1);
  assert.match(h.err(), /expired/);
  assert.equal(await h.run(['try', '--json']), 1);
  assert.equal(JSON.parse(h.out()).error.code, 'rate_limited');
  const h2 = harness({ 'GET /v1/guest': () => jres(401, { error: { code: 'guest_claimed', message: 'c' } }), 'POST /v1/guest': jres(503, { error: { code: 'guest_unavailable', message: 'full' } }) });
  assert.equal(await h2.run(['status', '--key', 'sg_guest_x']), 1);
  assert.match(h2.err(), /login/);
  assert.equal(await h2.run(['try']), 1);
  assert.match(h2.err(), /unavailable/);
  assert.equal(fs.existsSync(h2.cfgFile), false);
});

test('check and compare hit the documented routes', async () => {
  const h = harness({
    'POST /v1/voice-match': jres(200, { voice_match_score: 0.88, voice_match_notes: 'close', word_count: 30 }),
    'POST /v1/compare-voice': jres(200, { results: [{ label: 'b.txt', score: 0.4, band: 'off voice' }], summary: { average: 0.4 } }),
  });
  const a = path.join(h.tmp, 'a.txt'), b = path.join(h.tmp, 'b.txt');
  fs.writeFileSync(a, words(130)); fs.writeFileSync(b, words(130, 'x'));
  assert.equal(await h.run(['check', a, '--profile', 'p1', '--key', 'sg_live_k']), 0);
  assert.match(h.out(), /0\.88/);
  assert.deepEqual(h.calls[0].body.profile_id, 'p1');
  h.reset();
  assert.equal(await h.run(['compare', a, b, '--key', 'sg_live_k']), 0);
  assert.equal(h.calls[1].body.others.length, 1);
  assert.equal(await h.run(['compare', a, '--key', 'sg_live_k']), 2);
});

test('login stores key (mode 600), key precedence, logout clears', async () => {
  const h = harness({ 'GET /v1/profiles': jres(200, { data: [{ id: 'p1', status: 'complete', sample_count: 3, name: 'X' }] }) });
  assert.equal(await h.run(['login', '--key', 'bad']), 2);
  assert.equal(await h.run(['login', '--key', 'sg_live_stored']), 0);
  assert.equal(fs.statSync(h.cfgFile).mode & 0o777, 0o600);
  assert.equal(await h.run(['profile', 'list']), 0);
  assert.equal(h.calls[0].auth, 'Bearer sg_live_stored');
  await h.run(['profile', 'list', '--key', 'sg_live_flag']);
  assert.equal(h.calls[1].auth, 'Bearer sg_live_flag');
  await h.run(['profile', 'list'], { env: { ...h.env, SCRIPTGRAIN_API_KEY: 'sg_live_env' } });
  assert.equal(h.calls[2].auth, 'Bearer sg_live_env');
  assert.equal(await h.run(['logout']), 0);
  assert.equal(await h.run(['profile', 'list']), 2);
  assert.match(h.err(), /try/);
});

test('failed extraction exits non-zero; unknown command exits 2', async () => {
  const h = harness({
    'POST /v1/profiles': jres(202, { profile_id: 'p1', status: 'processing' }),
    'GET /v1/profiles/p1': jres(200, { id: 'p1', status: 'failed', last_error: 'boom' }),
  });
  const f = path.join(h.tmp, 'a.txt');
  fs.writeFileSync(f, words(60));
  assert.equal(await h.run(['profile', 'create', f, '--yes', '--key', 'sg_live_k']), 1);
  assert.match(h.err(), /boom/);
  assert.equal(await h.run(['frobnicate']), 2);
});
