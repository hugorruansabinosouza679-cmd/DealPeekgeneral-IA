/**
 * DealPeek AI — backend para Render
 *
 * Variáveis de ambiente no Render:
 *   GROQ_API_KEY  = chave em console.groq.com (recomendada, grátis com limites)
 *   ou OPENAI_API_KEY = se preferir OpenAI
 *   ALLOWED_ORIGIN = opcional, ex: https://seuusuario.github.io
 *   PORT = o Render define sozinho
 */
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED = (process.env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin || ALLOWED.includes('*') || ALLOWED.includes(origin)) return cb(null, true);
      return cb(null, true); // site estático em vários domínios — ajuste se quiser travar
    },
  })
);
app.use(express.json({ limit: '1mb' }));

const SYSTEM = `Você é a IA oficial do site DealPeek (vitrine de ofertas/afiliados no Brasil).
Responda sempre em português do Brasil, de forma clara e útil.
Você ajuda com: buscar/entender preço e descrição de produtos, regras do site, segurança, afiliados, FAQ, publicação, admin, feedback, filtros e problemas comuns.
NÃO invente preços. Se não houver preço no contexto, diga para colar o link e usar “buscar preço”.
NÃO peça cartão, senha ou dados bancários.
Quando fizer sentido, devolva também ações em JSON no final (em uma linha), assim:
ACTIONS:[{"type":"fetch_price"}]
Ações possíveis:
- fetch_price / fetch_link — ler link do formulário de publicar
- fetch_description
- open_channels
- open_feedback
- open_publish
- set_field {"type":"set_field","field":"prod-price","value":"19,90"}
Se não precisar de ação, não coloque ACTIONS.`;

function extractActions(text) {
  const out = { reply: text, actions: [] };
  const m = String(text).match(/ACTIONS:\s*(\[[\s\S]*?\])/i);
  if (m) {
    try {
      out.actions = JSON.parse(m[1]);
    } catch (e) {
      out.actions = [];
    }
    out.reply = String(text)
      .replace(/ACTIONS:\s*\[[\s\S]*?\]/i, '')
      .trim();
  }
  return out;
}

async function callGroq(messages) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      temperature: 0.35,
      max_tokens: 700,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Groq ' + res.status + ': ' + err.slice(0, 200));
  }
  const j = await res.json();
  return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
}

async function callOpenAI(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 700,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('OpenAI ' + res.status + ': ' + err.slice(0, 200));
  }
  const j = await res.json();
  return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'dealpeek-ai',
    hasGroq: !!process.env.GROQ_API_KEY,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/chat', async (req, res) => {
  try {
    const message = String((req.body && req.body.message) || '').trim();
    const context = (req.body && req.body.context) || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    const contextText = JSON.stringify(context).slice(0, 1500);
    const messages = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: 'Contexto do site (JSON):\n' + contextText + '\n\nPergunta do usuário:\n' + message,
      },
    ];

    let content = null;
    if (process.env.GROQ_API_KEY) content = await callGroq(messages);
    else if (process.env.OPENAI_API_KEY) content = await callOpenAI(messages);
    else {
      return res.status(503).json({
        error: 'Configure GROQ_API_KEY ou OPENAI_API_KEY no Render',
        reply:
          'A IA ainda não tem chave no servidor. No Render, em Environment, coloque GROQ_API_KEY (console.groq.com).',
      });
    }

    const parsed = extractActions(content || 'Sem resposta da IA.');
    // Heurística extra: se o usuário pediu preço, sugere ação
    if (/pre[cç]o|buscar link|ler link/i.test(message) && !parsed.actions.length) {
      parsed.actions.push({ type: 'fetch_price' });
    }
    res.json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: String(e.message || e),
      reply: 'A IA falhou agora. Tente de novo em instantes.',
    });
  }
});

app.listen(PORT, () => {
  console.log('DealPeek AI on port', PORT);
});
