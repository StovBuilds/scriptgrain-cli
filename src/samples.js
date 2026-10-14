import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = { maxSamples: 20, maxWordsEach: 5000, minWordsOne: 50, maxWordsTotal: 50000, guestWordsTotal: 25000 };

export const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function firstLine(text, max = 80) {
  const l = text.split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
  return l.length > max ? l.slice(0, max - 1) + '…' : l;
}

const isSampleFile = (f) => /\.(txt|md)$/i.test(f);

/** Collect samples from files, a folder (non-recursive) and/or stdin text. */
export function collectSamples({ files = [], dir, stdinText }) {
  const out = [];
  const paths = [...files];
  if (dir) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { throw new UsageError(`Cannot read folder ${dir}: ${e.code || e.message}`); }
    for (const n of names.sort()) if (isSampleFile(n)) paths.push(path.join(dir, n));
  }
  for (const p of paths) {
    if (!isSampleFile(p)) throw new UsageError(`${p}: only .txt and .md files are accepted (one sample per file).`);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch (e) { throw new UsageError(`Cannot read ${p}: ${e.code || e.message}`); }
    out.push({ source: p, text });
  }
  if (stdinText !== undefined) out.push({ source: '<stdin>', text: stdinText });
  return out;
}

export class UsageError extends Error {}

/** Validate locally so nothing is sent that the API would reject. Throws UsageError. */
export function validateSamples(samples, { guest = false } = {}) {
  const L = LIMITS;
  if (samples.length < 1) throw new UsageError('No samples given. Pass .txt/.md files, --dir <folder> or --stdin.');
  if (samples.length > L.maxSamples) throw new UsageError(`Too many samples: ${samples.length} (maximum ${L.maxSamples}).`);
  let total = 0;
  let enough = false;
  for (const s of samples) {
    const w = countWords(s.text);
    s.words = w;
    total += w;
    if (w === 0) throw new UsageError(`${s.source} is empty.`);
    if (w > L.maxWordsEach) throw new UsageError(`${s.source} has ${w} words (maximum ${L.maxWordsEach} per sample). Split it.`);
    if (w >= L.minWordsOne) enough = true;
  }
  if (!enough) throw new UsageError(`At least one sample needs ${L.minWordsOne}+ words.`);
  if (total > L.maxWordsTotal) throw new UsageError(`Total ${total} words exceeds ${L.maxWordsTotal}.`);
  if (guest && total > L.guestWordsTotal) throw new UsageError(`Guest sessions accept ${L.guestWordsTotal} words in total; you gave ${total}. Send fewer pieces or claim your account.`);
  return { total };
}
