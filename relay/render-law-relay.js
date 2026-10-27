// 의뢰인 Render 서비스(자치법규 MCP)에 붙이는 법제처 중계 라우트 — Express 예시
// 환경변수: LAW_OC(법제처 인증값), LAW_RELAY_SECRET(Vercel과 같은 값)
// 사용: app.get('/law-relay', lawRelay)
const crypto = require('node:crypto');
const ALLOWED = new Set(['law', 'eflaw', 'lawjosub', 'eflawjosub', 'ordin', 'admrul', 'admrulOldAndNew', 'oldAndNew', 'thdCmp', 'lsDelegated', 'lnkLsOrdJo', 'lnkOrd', 'lsJoHstInf', 'lstrm']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const cache = new Map();
let window = { start: Date.now(), n: 0 };

module.exports = async function lawRelay(req, res) {
  const ts = Number(req.get('X-Relay-Ts') || 0);
  const sig = req.get('X-Relay-Sig') || '';
  if (Math.abs(Date.now() / 1000 - ts) > 60) return res.status(401).send('expired');
  const q = new URLSearchParams(req.query);
  const sorted = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const expect = crypto.createHmac('sha256', process.env.LAW_RELAY_SECRET).update(`${ts}\n${sorted}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig.padEnd(expect.length).slice(0, expect.length)))) return res.status(401).send('bad signature');
  const ep = q.get('ep');
  const target = q.get('target');
  if (!['lawSearch', 'lawService'].includes(ep) || !ALLOWED.has(target)) return res.status(403).send('not allowed');
  if (Date.now() - window.start > 60_000) window = { start: Date.now(), n: 0 };
  if (++window.n > 60) return res.status(429).send('rate limit');
  q.delete('ep');
  q.set('OC', process.env.LAW_OC);
  const url = `https://www.law.go.kr/DRF/${ep}.do?${q}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return res.type(hit.type).send(hit.body);
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.law.go.kr/' } });
  const body = await r.text();
  const type = r.headers.get('content-type') || 'application/json';
  if (r.ok) cache.set(url, { at: Date.now(), body, type });
  res.set('X-Relay-Upstream-Ms', String(Date.now() - t0)).status(r.status).type(type).send(body);
};
