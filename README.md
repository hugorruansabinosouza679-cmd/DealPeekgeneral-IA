# DealPeek AI (Render)

Backend de IA para o site DealPeek.

## 1. Conta e chave grátis (Groq)

1. Acesse https://console.groq.com  
2. Crie conta → **API Keys** → Create API Key  
3. Copie a chave (`gsk_...`)

## 2. Subir no Render

1. Acesse https://render.com e faça login (GitHub)  
2. **New +** → **Web Service**  
3. Conecte o repositório que contém esta pasta `dealpeek-ai-server`  
   - Ou faça upload/deploy desta pasta como root do serviço  
4. Configurações:
   - **Runtime:** Node  
   - **Build Command:** `npm install`  
   - **Start Command:** `npm start`  
   - **Instance:** Free  
5. Em **Environment** adicione:
   - `GROQ_API_KEY` = sua chave Groq  
6. Create Web Service e espere o deploy  
7. Copie a URL, exemplo: `https://dealpeek-ai-xxxx.onrender.com`

## 3. Ligar no site

No `index.html`, em `DP_CLOUD`:

```js
aiBackendUrl: 'https://SUA-URL.onrender.com',
```

Sem barra no final.

Publique o `index.html` no GitHub Pages e teste a bolinha de **Ajuda**.

## Notas

- Plano free do Render pode “dormir”; a primeira pergunta depois de um tempo pode demorar ~30s.  
- Não coloque a chave Groq no frontend se o repo for público — só no Render.  
- Endpoint de saúde: `GET /health`
