const nodemailer = require('nodemailer');

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  // honeypot anti-spam
  if (b.website) return res.status(200).json({ success: true });

  const lead = {
    Nome: String(b.nome || '').slice(0, 120),
    WhatsApp: String(b.telefone || '').slice(0, 40),
    Delivery: String(b.empresa || '').slice(0, 120),
    Instagram: String(b.instagram || '').slice(0, 80),
    'Faturamento médio mensal': String(b.faturamento || '').slice(0, 60),
  };
  if (!lead.Nome || !lead.WhatsApp) return res.status(400).json({ success: false, message: 'Dados incompletos' });

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.LEAD_TO || user;
  if (!user || !pass) return res.status(500).json({ success: false, message: 'E-mail não configurado' });

  const rows = Object.entries(lead)
    .map(([k, v]) => `<tr><td style="padding:8px 12px;background:#f4f0eb;font-weight:700">${esc(k)}</td><td style="padding:8px 12px">${esc(v)}</td></tr>`)
    .join('');
  const digits = lead.WhatsApp.replace(/\D/g, '');
  const wa = digits ? `https://wa.me/55${digits}` : '';

  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({
      from: `"LP Kurtz" <${user}>`,
      to,
      subject: `Novo lead LP Kurtz — ${lead.Delivery || lead.Nome}`,
      text: Object.entries(lead).map(([k, v]) => `${k}: ${v}`).join('\n') + (wa ? `\n\nChamar no WhatsApp: ${wa}` : ''),
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0a0a0a">
        <h2 style="margin:0 0 14px;color:#E8450A">Novo lead — Diagnóstico gratuito</h2>
        <table style="border-collapse:collapse;border:1px solid #eee">${rows}</table>
        ${wa ? `<p style="margin-top:18px"><a href="${wa}" style="background:#25D366;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Chamar no WhatsApp</a></p>` : ''}
      </div>`,
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('lead mail error', e);
    return res.status(500).json({ success: false, message: 'Falha no envio' });
  }
};
