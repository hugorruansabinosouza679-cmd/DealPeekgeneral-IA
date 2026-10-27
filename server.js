/**
 * DealPeek AI — backend para Render
 *
 * Env:
 *   GROQ_API_KEY      — principal (console.groq.com)
 *   OPENAI_API_KEY    — opcional: segunda IA para quando a primeira não souber
 *   GROQ_MODEL / OPENAI_MODEL
 *   PORT
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const LEARN_FILE = path.join(__dirname, 'learned.json');
const MAX_MEMORY = 80;

const ALLOWED = (process.env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin || ALLOWED.includes('*') || ALLOWED.includes(origin)) return cb(null, true);
      return cb(null, true);
    },
  })
);
app.use(express.json({ limit: '1mb' }));

const SYSTEM = `Você é a IA do site DealPeek General — prestativa, direta e amigável (estilo assistente moderno, porém mais simples). Português do Brasil.

Você conhece o DealPeek:
- Vitrine de ofertas/afiliados (compra fecha na loja: ML, Shopee…). Sem cartão no DealPeek.
- Publicar: Admin → link automático ou manual; preço obrigatório em promo.
- Admin principal vê bugs/feedbacks; admins publicam; dono aprova admins.
- Nuvem Supabase (dp_store / main); catálogo sincroniza ~5s.
- Botão amarelo = ajuda IA; botão escuro esquerdo = relatar bug/melhoria.
- Regras: oferta real, preço certo, descrição do produto, sem golpe/+18/spam.

NÃO invente preços. NÃO peça cartão/senha/CPF.
Se o bloco MEMÓRIA APRENDIDA tiver algo útil, use.
Se realmente não souber, diga com honestidade e oriente no site.

AÇÕES opcionais no final:
ACTIONS:[{"type":"fetch_price"}]
Tipos: fetch_price, fetch_link, fetch_description, open_channels, open_feedback, open_publish,
set_field com field/value.`;

function loadMemory() {
  try {
    if (fs.existsSync(LEARN_FILE)) {
      const j = JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8'));
      return Array.isArray(j) ? j : [];
    }
  } catch (e) {
    console.warn('learn load', e.message);
  }
  return [];
}

function saveMemory(list) {
  try {
    fs.writeFileSync(LEARN_FILE, JSON.stringify(list.slice(-MAX_MEMORY), null, 0), 'utf8');
  } catch (e) {
    console.warn('learn save', e.message);
  }
}

let memory = loadMemory();

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s) {
  return new Set(normalize(s).split(' ').filter((w) => w.length > 2));
}

function similarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => {
    if (B.has(t)) inter++;
  });
  return inter / Math.max(A.size, B.size);
}

function findLearned(question, limit) {
  const scored = memory
    .map((item) => ({ item, score: similarity(question, item.q) }))
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit || 4);
  return scored;
}

function learn(question, answer, source) {
  const q = String(question || '').trim().slice(0, 400);
  const a = String(answer || '').trim().slice(0, 1200);
  if (q.length < 3 || a.length < 8) return;
  // evita lixo / erros
  if (/configure GROQ|sem resposta|falhou agora|API key/i.test(a)) return;
  const nq = normalize(q);
  const idx = memory.findIndex((m) => normalize(m.q) === nq);
  const row = { q, a, source: source || 'ai', t: Date.now() };
  if (idx >= 0) memory[idx] = row;
  else memory.push(row);
  if (memory.length > MAX_MEMORY) memory = memory.slice(-MAX_MEMORY);
  saveMemory(memory);
}

function looksUnsure(text) {
  const t = String(text || '').toLowerCase();
  if (!t || t.length < 12) return true;
  return /n[aã]o sei|n[aã]o tenho certeza|n[aã]o posso ajudar|n[aã]o tenho informa|desculpe,? n[aã]o|fora do meu conhecimento|n[aã]o encontrei/.test(
    t
  );
}

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

async function callGroq(messages, model) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.45,
      max_tokens: 1200,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Groq ' + res.status + ': ' + err.slice(0, 220));
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
      temperature: 0.4,
      max_tokens: 1200,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('OpenAI ' + res.status + ': ' + err.slice(0, 220));
  }
  const j = await res.json();
  return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
}

/** Segunda opinião: outro modelo Groq ou OpenAI */
async function callTeacher(messages) {
  // 1) OpenAI se tiver chave
  if (process.env.OPENAI_API_KEY) {
    try {
      const t = await callOpenAI(messages);
      if (t) return { text: t, source: 'openai' };
    } catch (e) {
      console.warn('teacher openai', e.message);
    }
  }
  // 2) Outro modelo Groq
  if (process.env.GROQ_API_KEY) {
    const alt = process.env.GROQ_TEACHER_MODEL || 'llama-3.1-8b-instant';
    try {
      const t = await callGroq(messages, alt);
      if (t) return { text: t, source: 'groq-alt:' + alt };
    } catch (e) {
      console.warn('teacher groq', e.message);
    }
  }
  return null;
}

function buildMessages(message, context, learnedHits) {
  let memBlock = '';
  if (learnedHits && learnedHits.length) {
    memBlock =
      '\n\nMEMÓRIA APRENDIDA (respostas anteriores úteis):\n' +
      learnedHits
        .map((h, i) => i + 1 + ') P: ' + h.item.q + '\nR: ' + h.item.a)
        .join('\n\n');
  }
  const contextText = JSON.stringify(context || {}).slice(0, 1500);
  return [
    { role: 'system', content: SYSTEM + memBlock },
    {
      role: 'user',
      content: 'Contexto do site (JSON):\n' + contextText + '\n\nPergunta do usuário:\n' + message,
    },
  ];
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'dealpeek-ai',
    hasGroq: !!process.env.GROQ_API_KEY,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    learned: memory.length,
  });
});

app.get('/health', (_req, res) => res.json({ ok: true, learned: memory.length }));

app.get('/api/memory', (_req, res) => {
  res.json({ count: memory.length, items: memory.slice(-20) });
});

app.post('/api/chat', async (req, res) => {
  try {
    const message = String((req.body && req.body.message) || '').trim();
    const context = (req.body && req.body.context) || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    // 1) Memória: resposta muito parecida já aprendida
    const hits = findLearned(message, 4);
    if (hits[0] && hits[0].score >= 0.72) {
      return res.json({
        reply: hits[0].item.a,
        actions: /pre[cç]o|buscar link/i.test(message) ? [{ type: 'fetch_price' }] : [],
        learned: true,
        source: 'memory',
      });
    }

    if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: 'no api key',
        reply:
          'A IA ainda não tem chave no servidor. No Render, coloque GROQ_API_KEY (console.groq.com).',
      });
    }

    const messages = buildMessages(message, context, hits);

    // 2) IA principal
    let content = null;
    let source = 'primary';
    try {
      if (process.env.GROQ_API_KEY) {
        content = await callGroq(messages);
        source = 'groq';
      } else {
        content = await callOpenAI(messages);
        source = 'openai';
      }
    } catch (e) {
      console.warn('primary fail', e.message);
      content = null;
    }

    // 3) Se falhou ou ficou insegura → puxa outra IA e APRENDE
    if (!content || looksUnsure(content)) {
      const teacher = await callTeacher([
        ...messages,
        {
          role: 'user',
          content:
            'A resposta anterior foi insuficiente ou insegura. Responda melhor a pergunta do usuário, com foco no DealPeek e em português do Brasil.',
        },
      ]);
      if (teacher && teacher.text) {
        content = teacher.text;
        source = teacher.source;
        const parsedTeacher = extractActions(content);
        learn(message, parsedTeacher.reply, source);
        if (/pre[cç]o|buscar link|ler link/i.test(message) && !parsedTeacher.actions.length) {
          parsedTeacher.actions.push({ type: 'fetch_price' });
        }
        return res.json({
          reply: parsedTeacher.reply,
          actions: parsedTeacher.actions,
          learned: true,
          source,
        });
      }
    }

    const parsed = extractActions(content || 'Não consegui responder agora. Tente de novo em instantes.');
    // 4) Aprende respostas boas da IA principal
    if (content && !looksUnsure(parsed.reply)) {
      learn(message, parsed.reply, source);
    }
    if (/pre[cç]o|buscar link|ler link/i.test(message) && !parsed.actions.length) {
      parsed.actions.push({ type: 'fetch_price' });
    }
    res.json({
      reply: parsed.reply,
      actions: parsed.actions,
      learned: false,
      source,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: String(e.message || e),
      reply: 'A IA falhou agora. Tente de novo em instantes.',
    });
  }
});

app.listen(PORT, () => {
  console.log('DealPeek AI on port', PORT, '| memory', memory.length);
});
