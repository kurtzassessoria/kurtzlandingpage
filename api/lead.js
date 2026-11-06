const nodemailer = require('nodemailer');
const crypto = require('crypto');

const PIXEL_ID = process.env.META_PIXEL_ID || '1522959416682572';
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (v, n) => String(v || '').slice(0, n);
const sha = v => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

// Conversions API (server-side). Only runs if META_CAPI_TOKEN is set in Vercel.
async function sendCapi({ eventId, lead, b, req }) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token || !eventId) return 'desligado';
  let ph = lead.WhatsApp.replace(/\D/g, '');
  if (ph && !ph.startsWith('55')) ph = '55' + ph;
  const parts = lead.Nome.trim().split(/\s+/);
  const user_data = { country: [sha('br')] };
  if (ph) user_data.ph = [sha(ph)];
  if (parts[0]) user_data.fn = [sha(parts[0])];
  if (parts.length > 1) user_data.ln = [sha(parts.slice(1).join(' '))];
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (ip) user_data.client_ip_address = ip;
  if (req.headers['user-agent']) user_data.client_user_agent = req.headers['user-agent'];
  if (b.fbp) user_data.fbp = clip(b.fbp, 200);
  if (b.fbc) user_data.fbc = clip(b.fbc, 300);
  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: clip(eventId, 100),
      action_source: 'website',
      event_source_url: clip(b.page_url, 500) || undefined,
      user_data,
      custom_data: { content_name: 'Diagnóstico gratuito', faturamento: lead['Faturamento médio mensal'] },
    }],
  };
  if (process.env.META_TEST_CODE) payload.test_event_code = process.env.META_TEST_CODE;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) { console.error('capi', r.status, await r.text()); return 'erro ' + r.status; }
    return 'ok';
  } catch (e) {
    console.error('capi error', e);
    return 'erro';
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      funcao: 'ok',
      GMAIL_USER: process.env.GMAIL_USER ? 'configurado' : 'FALTANDO',
      GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD ? 'configurado' : 'FALTANDO',
      META_CAPI_TOKEN: process.env.META_CAPI_TOKEN ? 'configurado' : 'não configurado (opcional)',
      PIXEL: PIXEL_ID,
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  // honeypot anti-spam
  if (b.website) return res.status(200).json({ success: true });

  const lead = {
    Nome: clip(b.nome, 120),
    WhatsApp: clip(b.telefone, 40),
    Delivery: clip(b.empresa, 120),
    Instagram: clip(b.instagram, 80),
    'Faturamento médio mensal': clip(b.faturamento, 60),
  };
  if (!lead.Nome || !lead.WhatsApp) return res.status(400).json({ success: false, message: 'Dados incompletos' });

  const attr = {
    Fonte: clip(b.utm_source, 80),
    Meio: clip(b.utm_medium, 80),
    Campanha: clip(b.utm_campaign, 150),
    Conjunto: clip(b.utm_term, 150),
    'Anúncio': clip(b.utm_content, 150),
  };
  const fromMeta = !!b.fbclid || /facebook|instagram|meta|^fb|^ig/i.test(attr.Fonte);
  const origem = attr.Campanha ? attr.Campanha : (fromMeta ? 'Meta' : (attr.Fonte || 'Orgânico / direto'));
  const origemRows = { 'Origem': fromMeta ? 'Anúncio Meta' : (attr.Fonte || 'Orgânico / direto'), ...attr, 'Página': clip(b.landing || b.page_url, 300) };
  Object.keys(origemRows).forEach(k => { if (!origemRows[k]) delete origemRows[k]; });

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.LEAD_TO || user;
  if (!user || !pass) return res.status(500).json({ success: false, message: 'E-mail não configurado' });

  const table = obj => Object.entries(obj)
    .map(([k, v]) => `<tr><td style="padding:8px 12px;background:#f4f0eb;font-weight:700;white-space:nowrap">${esc(k)}</td><td style="padding:8px 12px">${esc(v)}</td></tr>`)
    .join('');
  const digits = lead.WhatsApp.replace(/\D/g, '');
  const wa = digits ? `https://wa.me/55${digits}` : '';

  const capiP = sendCapi({ eventId: b.event_id, lead, b, req });

  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({
      from: `"LP Kurtz" <${user}>`,
      to,
      subject: `Novo lead LP Kurtz [${origem}] — ${lead.Delivery || lead.Nome}`,
      text:
        Object.entries(lead).map(([k, v]) => `${k}: ${v}`).join('\n') +
        '\n\n— Origem —\n' + Object.entries(origemRows).map(([k, v]) => `${k}: ${v}`).join('\n') +
        (wa ? `\n\nChamar no WhatsApp: ${wa}` : ''),
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0a0a0a">
        <h2 style="margin:0 0 14px;color:#E8450A">Novo lead — Diagnóstico gratuito</h2>
        <table style="border-collapse:collapse;border:1px solid #eee">${table(lead)}</table>
        <h3 style="margin:22px 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#555">Origem do lead</h3>
        <table style="border-collapse:collapse;border:1px solid #eee;font-size:14px">${table(origemRows)}</table>
        ${wa ? `<p style="margin-top:18px"><a href="${wa}" style="background:#25D366;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Chamar no WhatsApp</a></p>` : ''}
      </div>`,
    });
    await capiP;
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('lead mail error', e);
    return res.status(500).json({ success: false, message: 'Falha no envio' });
  }
};
