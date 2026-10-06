// Free AI proxy for the EMT study site. Keeps the Groq key on the server.
// Set GROQ_API_KEY in Netlify: Site configuration > Environment variables.
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const env = k => (globalThis.Netlify && Netlify.env && Netlify.env.get(k)) || process.env[k];
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function ask(key, model, messages, wantJson, maxTokens) {
  const body = { model, messages, temperature: wantJson ? 0.2 : 0.5, max_tokens: maxTokens };
  if (wantJson) body.response_format = { type: 'json_object' };
  const res = await fetch(GROQ, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch (e) {}
  return { status: res.status, text: data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content };
}

export default async (req) => {
  const key = env('GROQ_API_KEY');
  if (req.method === 'GET') return json({ ok: !!key });
  if (req.method !== 'POST') return json({ code: 'network' }, 405);
  if (!key) return json({ code: 'sampling_disabled' }, 503);

  // Only accept calls from this site's own pages.
  const origin = req.headers.get('origin');
  if (origin) { try { if (new URL(origin).host !== new URL(req.url).host) return json({ code: 'network' }, 403); } catch (e) { return json({ code: 'network' }, 403); } }

  let b; try { b = await req.json(); } catch (e) { return json({ code: 'network' }, 400); }
  const msgs = Array.isArray(b.messages) ? b.messages : [];
  if (!msgs.length || msgs.length > 60) return json({ code: 'prompt_too_large' }, 400);
  const clean = []; let total = 0;
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return json({ code: 'network' }, 400);
    total += m.content.length; clean.push({ role: m.role, content: m.content });
  }
  if (total > 90000) return json({ code: 'prompt_too_large' }, 400);

  const wantJson = !!b.json;
  const main = env(wantJson ? 'GROQ_MODEL_GRADE' : 'GROQ_MODEL_CHAT') || 'llama-3.3-70b-versatile';
  const backup = env('GROQ_MODEL_BACKUP') || 'llama-3.1-8b-instant';
  const maxTokens = wantJson ? 3000 : 500;
  try {
    let r = await ask(key, main, clean, wantJson, maxTokens);
    if ((r.status === 429 || r.status >= 500 || !r.text) && backup !== main) r = await ask(key, backup, clean, wantJson, maxTokens);
    if (r.status === 429) return json({ code: 'rate_limited' }, 429);
    if (r.status === 413) return json({ code: 'prompt_too_large' }, 413);
    if (!r.text) return json({ code: 'network' }, 502);
    return json({ text: r.text });
  } catch (e) { return json({ code: 'network' }, 502); }
};

export const config = { path: '/api/ai' };
