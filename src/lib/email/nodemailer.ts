import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "@/lib/config/env";

// Configurazione SMTP Zoho
const transporter: Transporter = nodemailer.createTransport({
  host: env.email.host || "smtp.zoho.eu", // smtp.zoho.com per US
  port: env.email.port || 465,
  secure: process.env.SMTP_SECURE === "true" || true, // true per port 465, false per 587
  auth: {
    user: env.email.user,
    pass: env.email.password,
  },
});

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * Invia email tramite SMTP Zoho
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  try {
    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || "SICS Valutazione"}" <${env.email.user}>`,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      text: options.text || "",
      html: options.html,
    });
  } catch (error) {
    console.error("Errore invio email:", error);
    throw new Error("Impossibile inviare l'email");
  }
}

/**
 * Template email: Sessione valutazione sbloccata
 */
export function getSessioneApertainEmailTemplate(
  nomeUtente: string,
  anno: number,
  urlPiattaforma: string
): string {
  return `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sessione Valutazione Aperta</title>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #1a202c; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #00a1be 0%, #007a91 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">SICS - Valutazione Personale</h1>
    <p style="color: #e6f7fb; margin: 10px 0 0 0;">Create to Solve</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <h2 style="color: #00a1be; margin-top: 0;">Ciao ${nomeUtente},</h2>

    <p style="font-size: 16px; color: #1a202c;">
      La <strong>sessione di valutazione ${anno}</strong> è stata aperta!
    </p>

    <p style="font-size: 16px; color: #1a202c;">
      Puoi ora accedere alla piattaforma per completare la tua autovalutazione.
    </p>

    <div style="background: #f8fafc; border-left: 4px solid #00a1be; padding: 15px; margin: 25px 0;">
      <p style="margin: 0; color: #64748b; font-size: 14px;">
        <strong>Cosa fare:</strong>
      </p>
      <ol style="margin: 10px 0 0 0; padding-left: 20px; color: #64748b; font-size: 14px;">
        <li>Accedi alla piattaforma</li>
        <li>Vai nella sezione "Valutazioni"</li>
        <li>Compila la tua autovalutazione</li>
      </ol>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${urlPiattaforma}/valutazioni"
         style="display: inline-block; background: #00a1be; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Accedi alla Piattaforma
      </a>
    </div>

    <p style="font-size: 14px; color: #64748b; margin-top: 30px;">
      Se hai domande o difficoltà, contatta il tuo responsabile o l'amministratore di sistema.
    </p>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">

    <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">
      © ${new Date().getFullYear()} SICS - Create to Solve<br>
      Questa è una email automatica, si prega di non rispondere.
    </p>
  </div>
</body>
</html>
  `.trim();
}
