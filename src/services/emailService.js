import nodemailer from 'nodemailer';
import { query, memoryStore, isDbConnected } from '../config/db.js';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_FROM =
  process.env.SMTP_FROM ||
  `"Brainovision Talent Acquisition" <${SMTP_USER}>`;

const transporter =
  SMTP_USER && SMTP_PASSWORD
    ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
    })
    : null;


/**
 * Generate assessment credentials email HTML
 */
export function generateAssessmentEmailHtml(candidate, tempPassword) {
  const portalUrl = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/assessment`
    : 'https://careers.brainovision.in/assessment';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>Brainovision Campus Recruitment Assessment 2026</title>

  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
        Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      color: #1e293b;
    }

    .wrapper {
      max-width: 600px;
      margin: 20px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }

    .header {
      background: #0f172a;
      padding: 32px 24px;
      border-bottom: 4px solid #facc15;
    }

    .title {
      color: #ffffff;
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 6px 0;
    }

    .subtitle {
      color: #94a3b8;
      font-size: 13px;
      margin: 0;
    }

    .content {
      padding: 32px 24px;
    }

    .box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 18px;
      margin: 20px 0;
    }

    .cred-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 18px;
      margin: 20px 0;
    }

    .row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #e2e8f0;
      font-size: 13px;
      gap: 15px;
    }

    .btn {
      display: inline-block;
      background: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      margin-top: 15px;
    }

    .footer {
      padding: 24px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>

<body>

  <div class="wrapper">

    <div class="header">
      <h1 class="title">
        Brainovision Solutions India Pvt. Ltd.
      </h1>

      <p class="subtitle">
        Campus Recruitment Assessment — 2026
      </p>
    </div>

    <div class="content">

      <p style="font-size: 15px; font-weight: 600; margin-top: 0;">
        Dear ${candidate.name},
      </p>

      <p style="font-size: 13px; line-height: 1.6; color: #475569;">
        You have been shortlisted to participate in the
        <strong>Brainovision Campus Recruitment Assessment</strong>
        for the position of
        <strong>${candidate.position}</strong>.
      </p>

      <div class="box">

        <div style="
          font-weight: 700;
          font-size: 12px;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 8px;
        ">
          Assessment Details
        </div>

        <div class="row">
          <span>Assessment:</span>
          <strong>Campus Recruitment Assessment 2026</strong>
        </div>

        <div class="row">
          <span>Duration:</span>
          <strong>45 Minutes (40 MCQs)</strong>
        </div>

        <div class="row">
          <span>Format:</span>
          <strong>
            Quantitative Aptitude, Reasoning, Verbal & Technical
          </strong>
        </div>

        <div class="row" style="border-bottom: none;">
          <span>Proctoring:</span>
          <strong>
            Locked Fullscreen & System Monitored
          </strong>
        </div>

      </div>

      <div class="cred-box">

        <div style="
          font-weight: 700;
          font-size: 12px;
          text-transform: uppercase;
          color: #1e40af;
          margin-bottom: 8px;
        ">
          Your Secured Credentials
        </div>

        <div class="row">
          <span>Assessment Portal:</span>

          <span style="
            color: #2563eb;
            font-weight: 600;
            word-break: break-all;
          ">
            ${portalUrl}
          </span>
        </div>

        <div class="row">
          <span>Candidate ID:</span>

          <strong style="
            font-family: monospace;
            font-size: 14px;
            color: #0f172a;
          ">
            ${candidate.candidate_id}
          </strong>
        </div>

        <div class="row" style="border-bottom: none;">
          <span>Temporary Password:</span>

          <strong style="
            font-family: monospace;
            font-size: 14px;
            color: #0f172a;
          ">
            ${tempPassword}
          </strong>
        </div>

      </div>

      <div style="text-align: center; margin: 25px 0;">

        <a
          href="${portalUrl}"
          class="btn"
          target="_blank"
        >
          Access Assessment Portal
        </a>

      </div>

      <p style="
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        color: #64748b;
        margin-bottom: 6px;
      ">
        Important Instructions:
      </p>

      <ul style="
        font-size: 12px;
        color: #475569;
        line-height: 1.6;
        padding-left: 20px;
        margin-top: 0;
      ">

        <li>
          Use a laptop or desktop computer with a reliable internet connection.
        </li>

        <li>
          The examination runs in mandatory locked fullscreen mode.
        </li>

        <li>
          Tab switches, window unfocus, copy/paste, and developer shortcuts
          are logged and trigger disqualification.
        </li>

        <li>
          Ensure you complete the test in one single continuous session
          before the timer expires.
        </li>

      </ul>

    </div>

    <div class="footer">

      <p style="
        margin: 0 0 4px 0;
        font-weight: 600;
        color: #334155;
      ">
        Talent Acquisition Team
      </p>

      <p style="margin: 0 0 4px 0;">
        Brainovision Solutions India Pvt. Ltd.
      </p>

      <p style="margin: 0; color: #2563eb;">
        hiring@brainovision.in
      </p>

    </div>

  </div>

</body>
</html>
`;
}


/**
 * Send candidate credentials email
 */
export async function sendCandidateCredentialsEmail(
  candidate,
  tempPassword
) {
  const html = generateAssessmentEmailHtml(
    candidate,
    tempPassword
  );

  const messageId =
    `msg-bv-${Date.now()}-${candidate.candidate_id}`;

  let status = 'FAILED';
  let errorMsg = null;
  let providerMessageId = null;

  /*
   * Never simulate a successful email.
   * If SMTP credentials are missing, fail explicitly.
   */
  if (!transporter) {
    errorMsg =
      'SMTP is not configured. SMTP_USER and SMTP_PASSWORD are required.';

    console.error(
      `[Email Service] ${errorMsg}`
    );
  } else {
    try {
      const info = await transporter.sendMail({
        from: SMTP_FROM,
        to: candidate.email,

        subject:
          `Brainovision Campus Recruitment Assessment 2026 — ` +
          `Login Credentials [${candidate.candidate_id}]`,

        html,
      });

      status = 'DELIVERED';
      providerMessageId = info.messageId;

      console.log(
        `[OK] Email delivered to ${candidate.email} ` +
        `(Msg ID: ${info.messageId})`
      );

    } catch (err) {
      status = 'FAILED';
      errorMsg = err?.message || 'Unknown SMTP error';

      console.error(
        `[Email Service] Email delivery failed to ` +
        `${candidate.email}:`,
        errorMsg
      );
    }
  }


  /*
   * Log email attempt.
   */
  if (isDbConnected()) {
    try {
      await query(
        `INSERT INTO email_logs
        (
          candidate_id,
          recipient,
          email_type,
          status,
          provider_message_id,
          error_message,
          sent_at
        )
        VALUES (?, ?, 'CREDENTIAL_DISPATCH', ?, ?, ?, NOW())`,
        [
          candidate.id,
          candidate.email,
          status,
          providerMessageId || messageId,
          errorMsg,
        ]
      );

      /*
       * IMPORTANT:
       * Only mark email_sent = TRUE when SMTP
       * actually accepted the email.
       */
      if (status === 'DELIVERED') {
        await query(
          `UPDATE candidates
           SET email_sent = TRUE,
               email_sent_at = NOW()
           WHERE id = ?`,
          [candidate.id]
        );
      }

    } catch (dbErr) {
      console.error(
        '[Email Service] Failed to log email to MySQL:',
        dbErr.message
      );
    }

  } else {

    memoryStore.emailLogs.push({
      id: memoryStore.emailLogs.length + 1,
      candidate_id: candidate.id,
      recipient: candidate.email,
      email_type: 'CREDENTIAL_DISPATCH',
      status,
      provider_message_id:
        providerMessageId || messageId,
      error_message: errorMsg,
      sent_at: new Date().toISOString(),
    });

  }


  return {
    success: status === 'DELIVERED',
    messageId: providerMessageId || messageId,
    status,
    error: errorMsg,
  };
}
