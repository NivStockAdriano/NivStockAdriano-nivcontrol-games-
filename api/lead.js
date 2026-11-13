// /api/lead · Diagnóstico NivControl → NivControl Leads · v1 · 13/11/2026
//
// O formulário do jogo (diagnostico/index.html) faz POST JSON aqui, na mesma origem.
// Esta função repassa para a edge leads-diagnostico do NivControl Leads com o segredo NIVLEADS_TOKEN (= secret DIAGNOSTICO_TOKEN da edge).
// O segredo vive só em Environment Variables da Vercel (e no secret da edge). Nunca no HTML nem no repositório.
//
// Env (Vercel → Settings → Environment Variables, Production):
//   NIVLEADS_URL       https://asmiisyayyvlpslfpvdu.supabase.co/functions/v1/leads-diagnostico
//   NIVLEADS_TOKEN     segredo (sensível); é o mesmo valor do secret DIAGNOSTICO_TOKEN da edge
//
// Contrato:
//   POST { nome, whatsapp, email, ... }   (corpo montado por sendLead no jogo)
//   200 { ok: true }          lead gravado (novo ou já existente na fila)
//   400 { error }             dado inválido (nome, WhatsApp ou e-mail)
//   403 { error }             origem diferente do jogo · 405 método · 413 corpo grande
//   502 { error }             NivLeads fora do ar ou recusou: o jogo guarda o lead no navegador para reenviar

const ORIGENS = [/^https:\/\/game\.niv-control\.com$/, /^https:\/\/nivcontrol-games(-[a-z0-9-]+)?\.vercel\.app$/];
const LIMITE = 32 * 1024;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const origem = req.headers.origin || "";
  if (origem && !ORIGENS.some((r) => r.test(origem))) return res.status(403).json({ error: "Origem não permitida" });

  const url = process.env.NIVLEADS_URL;
  const token = process.env.NIVLEADS_TOKEN;
  if (!url || !token) {
    console.error("api/lead: faltam NIVLEADS_URL ou NIVLEADS_TOKEN");
    return res.status(502).json({ error: "Envio indisponível no momento" });
  }

  let corpo = req.body;
  if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { return res.status(400).json({ error: "JSON inválido" }); } }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return res.status(400).json({ error: "JSON inválido" });
  const bruto = JSON.stringify(corpo);
  if (bruto.length > LIMITE) return res.status(413).json({ error: "Formulário grande demais" });

  const ctl = new AbortController();
  const tempo = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-diagnostico-token": token },
      body: bruto,
      signal: ctl.signal,
    });
    const resposta = await r.json().catch(() => ({}));
    if (r.ok) return res.status(200).json({ ok: true });
    if (r.status === 400) return res.status(400).json({ error: resposta.error || "Dados inválidos" });
    console.error("api/lead: NivLeads respondeu", r.status, resposta.error || "");
    return res.status(502).json({ error: "Não foi possível registrar agora" });
  } catch (e) {
    console.error("api/lead: falha ao falar com o NivLeads", e && e.name);
    return res.status(502).json({ error: "Não foi possível registrar agora" });
  } finally {
    clearTimeout(tempo);
  }
};
