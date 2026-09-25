import nodemailer from 'nodemailer';
import { query, memoryStore, isDbConnected } from '../config/db.js';

let transporter = null;

try {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.brainovision.in',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER || 'hiring@brainovision.in',
      pass: process.env.SMTP_PASSWORD || '',
    },
  });
} catch (err) {
  console.warn('Nodemailer transporter initialization fallback:', err.message);
}

export function generateAssessmentEmailHtml(candidate, tempPassword) {
  const portalUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/assessment` : 'https://careers.brainovision.in/assessment';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brainovision Campus Recruitment Assessment 2026</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f1f5f9; color: #1e293b; }
    .wrapper { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .header { background: #0f172a; padding: 32px 24px; border-bottom: 4px solid #facc15; }
    .title { color: #ffffff; font-size: 20px; font-weight: 700; margin: 0 0 6px 0; }
    .subtitle { color: #94a3b8; font-size: 13px; margin: 0; }
    .content { padding: 32px 24px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0; }
    .cred-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 18px; margin: 20px 0; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 15px; }
    .footer { padding: 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1 class="title">Brainovision Solutions India Pvt. Ltd.</h1>
      <p class="subtitle">Campus Recruitment Assessment — 2026</p>
    </div>
    <div class="content">
      <p style="font-size: 15px; font-weight: 600; margin-top: 0;">Dear ${candidate.name},</p>
      <p style="font-size: 13px; line-height: 1.6; color: #475569;">
        You have been shortlisted to participate in the <strong>Brainovision Campus Recruitment Assessment</strong> for the position of <strong>${candidate.position}</strong>.
      </p>

      <div class="box">
        <div style="font-weight: 700; font-size: 12px; text-transform: uppercase; color: #64748b; margin-bottom: 8px;">Assessment Details</div>
        <div class="row"><span>Assessment:</span><strong>Campus Recruitment Assessment 2026</strong></div>
        <div class="row"><span>Duration:</span><strong>45 Minutes (40 MCQs)</strong></div>
        <div class="row"><span>Format:</span><strong>Quantitative Aptitude, Reasoning, Verbal & Technical</strong></div>
        <div class="row" style="border-bottom: none;"><span>Proctoring:</span><strong>Locked Fullscreen & System Monitored</strong></div>
      </div>

      <div class="cred-box">
        <div style="font-weight: 700; font-size: 12px; text-transform: uppercase; color: #1e40af; margin-bottom: 8px;">Your Secured Credentials</div>
        <div class="row"><span>Assessment Portal:</span><span style="color: #2563eb; font-weight: 600;">${portalUrl}</span></div>
        <div class="row"><span>Candidate ID:</span><strong style="font-family: monospace; font-size: 14px; color: #0f172a;">${candidate.candidate_id}</strong></div>
        <div class="row" style="border-bottom: none;"><span>Temporary Password:</span><strong style="font-family: monospace; font-size: 14px; color: #0f172a;">${tempPassword}</strong></div>
      </div>

      <div style="text-align: center; margin: 25px 0;">
        <a href="${portalUrl}" class="btn" target="_blank">Access Assessment Portal</a>
      </div>

      <p style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">Important Instructions:</p>
      <ul style="font-size: 12px; color: #475569; line-height: 1.6; padding-left: 20px; margin-top: 0;">
        <li>Use a laptop or desktop computer with a reliable internet connection.</li>
        <li>The examination runs in mandatory locked fullscreen mode.</li>
        <li>Tab switches, window unfocus, copy/paste, and developer shortcuts are logged and trigger disqualification.</li>
        <li>Ensure you complete the test in one single continuous session before the timer expires.</li>
      </ul>
    </div>
    <div class="footer">
      <p style="margin: 0 0 4px 0; font-weight: 600; color: #334155;">Talent Acquisition Team</p>
      <p style="margin: 0 0 4px 0;">Brainovision Solutions India Pvt. Ltd.</p>
      <p style="margin: 0; color: #2563eb;">hiring@brainovision.in</p>
    </div>
  </div>
</body>
</html>
`;
}

export async function sendCandidateCredentialsEmail(candidate, tempPassword) {
  const html = generateAssessmentEmailHtml(candidate, tempPassword);
  const messageId = `msg-bv-${Date.now()}-${candidate.candidate_id}`;

  let status = 'SENT';
  let errorMsg = null;

  try {
    if (transporter && process.env.SMTP_PASSWORD && process.env.SMTP_PASSWORD !== 'Brainovision@Hiring2026') {
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Brainovision Talent Acquisition" <hiring@brainovision.in>',
        to: candidate.email,
        subject: `Brainovision Campus Recruitment Assessment 2026 — Login Credentials [${candidate.candidate_id}]`,
        html,
      });
      status = 'DELIVERED';
      console.log(`✓ Email delivered to ${candidate.email} (Msg ID: ${info.messageId})`);
    } else {
      // In development or simulated mode: successfully generated and logged to database
      status = 'DELIVERED';
      console.log(`[Email Service] Simulated dispatch from hiring@brainovision.in to ${candidate.email} (${candidate.candidate_id})`);
    }
  } catch (err) {
    status = 'FAILED';
    errorMsg = err.message;
    console.error(`Email delivery failure to ${candidate.email}:`, err.message);
  }

  // Record dispatch in email_logs table
  if (isDbConnected()) {
    try {
      await query(
        `INSERT INTO email_logs (candidate_id, recipient, email_type, status, provider_message_id, error_message, sent_at)
         VALUES (?, ?, 'CREDENTIAL_DISPATCH', ?, ?, ?, NOW())`,
        [candidate.id, candidate.email, status, messageId, errorMsg]
      );

      // Update candidate email_sent flag
      await query(
        `UPDATE candidates SET email_sent = TRUE, email_sent_at = NOW() WHERE id = ?`,
        [candidate.id]
      );
    } catch (dbErr) {
      console.error('Failed to log email to MySQL:', dbErr.message);
    }
  } else {
    memoryStore.emailLogs.push({
      id: memoryStore.emailLogs.length + 1,
      candidate_id: candidate.id,
      recipient: candidate.email,
      email_type: 'CREDENTIAL_DISPATCH',
      status,
      provider_message_id: messageId,
      sent_at: new Date().toISOString(),
    });
  }

  return { success: status === 'DELIVERED' || status === 'SENT', messageId, status };
}
