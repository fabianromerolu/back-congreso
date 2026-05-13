import { Injectable } from "@nestjs/common";
import type { AsistenciaRegistro } from "@prisma/client";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

type CertificateEmailResult =
  | { sent: true; skipped: false; message: string }
  | { sent: false; skipped: true; message: string };

@Injectable()
export class CertificateEmailService {
  async sendCertificate(
    record: AsistenciaRegistro,
    pdfPath: string,
    filename: string,
  ): Promise<CertificateEmailResult> {
    const transportConfig = this.getTransportConfig();

    if (!transportConfig) {
      return {
        sent: false,
        skipped: true,
        message:
          "SMTP no configurado. El certificado fue generado, pero no se envio por correo.",
      };
    }

    const transporter = nodemailer.createTransport(transportConfig);
    const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;

    await transporter.sendMail({
      from,
      to: record.email,
      subject: "Certificado de participacion - Congreso UCC Monteria",
      text: [
        `Hola ${this.fullName(record)},`,
        "",
        "Adjuntamos tu certificado generado para el Congreso UCC Monteria.",
        "",
        "Cordialmente,",
        "Equipo organizador",
      ].join("\n"),
      html: [
        `<p>Hola <strong>${this.escapeHtml(this.fullName(record))}</strong>,</p>`,
        "<p>Adjuntamos tu certificado generado para el Congreso UCC Monteria.</p>",
        "<p>Cordialmente,<br/>Equipo organizador</p>",
      ].join(""),
      attachments: [
        {
          filename,
          path: pdfPath,
          contentType: "application/pdf",
        },
      ],
    });

    return {
      sent: true,
      skipped: false,
      message: "Certificado enviado al correo registrado.",
    };
  }

  private getTransportConfig(): SMTPTransport.Options | null {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM ?? user;

    if (!host || !from) return null;

    return {
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: user && pass ? { user, pass } : undefined,
    };
  }

  private fullName(record: Pick<AsistenciaRegistro, "nombres" | "apellidos">) {
    return `${record.nombres} ${record.apellidos}`.trim();
  }

  private escapeHtml(value: string) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
