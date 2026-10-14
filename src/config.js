import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_API_URL = 'https://api.scriptgrain.com';

export function configDir(env = process.env) {
  if (env.SCRIPTGRAIN_CONFIG_DIR) return env.SCRIPTGRAIN_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'scriptgrain');
}

export function configPath(env) {
  return path.join(configDir(env), 'config.json');
}

export function readConfig(env) {
  try {
    return JSON.parse(fs.readFileSync(configPath(env), 'utf8')) || {};
  } catch {
    return {};
  }
}

/** Write config with directory 700 and file 600 (it holds credentials). */
export function writeConfig(cfg, env) {
  const dir = configDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configPath(env);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function updateConfig(patch, env) {
  const cfg = { ...readConfig(env), ...patch };
  for (const k of Object.keys(cfg)) if (cfg[k] === undefined || cfg[k] === null) delete cfg[k];
  writeConfig(cfg, env);
  return cfg;
}
