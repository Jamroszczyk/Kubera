// Server-provided config (from .env via server.js). Best-effort: absent when served statically.

export const config = {
  envApiKey: '',
};

export async function loadConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return config;
    const json = await res.json();
    config.envApiKey = (json.finnhubApiKey || '').trim();
  } catch { /* not running behind server.js */ }
  return config;
}
