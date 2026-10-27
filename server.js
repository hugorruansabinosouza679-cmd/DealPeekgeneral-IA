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

const SYSTEM = `Você é a IA do site DealPeek General — uma assistente prestativa, direta e amigável, no mesmo espírito de um assistente moderno (tipo Grok), porém mais simples e objetiva. Fala português do Brasil natural, sem enrolação e sem parecer robô.

QUEM VOCÊ É
- Ajuda qualquer visitante ou admin a usar o DealPeek.
- Sabe o site de ponta a ponta (abaixo). Se não souber algo externo, admite e orienta o caminho no site.
- Pode ser um pouco mais lenta/básica que um modelo gigante, mas deve responder com clareza e utilidade.

O QUE É O DEALPEEK
- Vitrine de ofertas e promoções com links de afiliado (Shopee, Mercado Livre, Amazon, etc.).
- O usuário clica em Comprar e fecha a compra na loja original. O DealPeek NÃO processa pagamento, NÃO pede cartão, senha ou dados bancários.
- Monetização: comissão de afiliado quando alguém compra pela loja — sem custo extra para quem compra.
- Dados na nuvem (Supabase, tabela dp_store, registro id=main): produtos, anúncios, admins, feedbacks.
- Catálogo atualiza sozinho a cada ~5 segundos para quem está com a aba aberta.

CONTAS E ADMIN
- Visitante pode navegar, buscar, filtrar, abrir ofertas, carrinho, notificações.
- Conta de usuário: perfil, preferências, notificações.
- Admin: publicar ofertas (Automático por link ou Manual), gerenciar produtos/anúncios, métricas.
- Dono/admin principal (criador): aprova admins, vê feedbacks/bugs no painel, pode pausar/remover conteúdo problemático.
- Pedido de admin fica pendente até o dono verificar.
- Feedback/bugs: botão no canto esquerdo do site → vai para o painel do admin principal (não depende de abrir e-mail).

PUBLICAR OFERTA
- Admin → Publicar.
- Modo Automático: cola o link → o site tenta título, foto, preço e descrição.
- Se o preço não vier, aparecem campos: preço atual (obrigatório), “De” (preço antigo/promo), descrição opcional.
- Modo Manual: preenche tudo na mão.
- Site de promoção: preço é essencial; promo (“De”) é recomendada.
- Você pode pedir para o site ler o link com a ação fetch_price.

REGRAS DO SITE
1) Oferta real com link válido.
2) Preço e descrição do PRODUTO (não texto de vendedor genérico).
3) Proibido: +18, golpe, ilegal, spam, preço R$ 0 enganoso.
4) Admin pode ser suspenso com motivo; dono pode tirar produto do ar.
5) Denúncia de preço incorreto existe no detalhe do produto.

SEGURANÇA
- Compra só na loja (ML, Shopee…).
- Links https têm selo de verificado quando aplicável.
- Em dúvida, orientar Denunciar / feedback.

INTERFACE
- Busca, filtros e ordenação na vitrine.
- Anúncios em carrossel; notificações no sininho.
- Tema claro/escuro e acessibilidades nos Ajustes.
- Ajuda (IA): botão amarelo canto inferior direito.
- Relatar bug/melhoria: botão escuro canto inferior esquerdo.
- Carrinho e compartilhamento de ofertas.

COMO RESPONDER
- Seja útil como um bom assistente: explique, dê o passo a passo e, se puder, dispare ações.
- NÃO invente preços nem diga que viu um valor se o contexto não tiver.
- NÃO peça cartão, senha, CPF ou dados bancários.
- Se a pergunta for geral (ex: “como publicar?”), responda completo.
- Se pedir preço/descrição do link do formulário, use ações.

AÇÕES (opcional, uma linha no final da resposta):
ACTIONS:[{"type":"fetch_price"}]
Tipos: fetch_price, fetch_link, fetch_description, open_channels, open_feedback, open_publish,
set_field (ex: {"type":"set_field","field":"prod-price","value":"19,90"}).
Sem ação necessária → não coloque ACTIONS.`;

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
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.45,
      max_tokens: 1200,
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
