import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AsistenciaRegistro, Evaluador, Ponente } from "@prisma/client";
import { execFile } from "child_process";
import { createReadStream, existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import JSZip from "jszip";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { PrismaService } from "../prisma/prisma.service";
import { areEquivalent } from "../common/utils/normalizer";

const execFileAsync = promisify(execFile);

const CERTIFICATE_ROLES = ["ponente", "asistente", "evaluador"] as const;
type CertificateRole = (typeof CERTIFICATE_ROLES)[number];

type CertificateTemplateData = {
  role: CertificateRole;
  fullName: string;
  documento: string;
  linkedRegistrationId?: string | null;
  ponente?: {
    autor1: string;
    documento1: string;
    autor2?: string;
    documento2?: string;
    tituloPonencia: string;
    semillero?: string | null;
  };
  evaluador?: {
    universidad: string;
    ponencias: string[];
  };
};

type GeneratedCertificate = {
  role: CertificateRole;
  fullName: string;
  generatedAt: Date | null;
  downloadUrl: string;
  filename: string;
};

const TEMPLATE_FILENAMES: Record<CertificateRole, string> = {
  asistente: "PLANTILLA ASISTENTE.docx",
  evaluador: "PLANTILLA EVALUADOR.docx",
  ponente: "PLANTILLA PONENTE.docx",
};

const EVALUADOR_SAMPLE_BLOCK =
  /<w:p[^>]*>[\s\S]*?LA EVOLUCI[\s\S]*?DERECHOS HUMANOS[\s\S]*?<\/w:p>/;

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  async generateCertificate(record: AsistenciaRegistro) {
    const data = await this.buildTemplateData(record);
    const templatePath = this.getTemplatePath(data.role);
    const outputBase = await this.getCertificateOutputBase(record);
    const docxPath = `${outputBase}.docx`;
    const pdfPath = `${outputBase}.pdf`;

    const templateBuffer = await readFile(templatePath);
    const zip = await JSZip.loadAsync(templateBuffer);
    const documentFile = zip.file("word/document.xml");

    if (!documentFile) {
      throw new BadRequestException("La plantilla no contiene word/document.xml.");
    }

    const originalXml = await documentFile.async("string");
    const documentXml = this.fillTemplateXml(originalXml, data);

    zip.file("word/document.xml", documentXml);

    const generatedDocx = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });

    await writeFile(docxPath, generatedDocx);
    await this.convertDocxToPdf(docxPath, pdfPath);

    return {
      docxPath,
      pdfPath,
      linkedRegistrationId: data.linkedRegistrationId,
    };
  }

  async lookupByDocument(documento: string) {
    const cleanDocument = String(documento ?? "").trim();
    if (!cleanDocument) {
      throw new BadRequestException("Debes digitar la cedula o documento.");
    }

    const allRecords = await this.prisma.asistenciaRegistro.findMany({
      orderBy: { createdAt: "desc" },
    });
    const records = allRecords.filter((record) =>
      areEquivalent(record.documento, cleanDocument),
    );

    if (!records.length) {
      return {
        status: "not_registered",
        message:
          "No se encuentra registrado en las asistencias del evento; por ende no se puede generar el certificado.",
        certificates: [],
      };
    }

    const certificates: GeneratedCertificate[] = [];

    for (const record of records) {
      if (!this.isCertificateRole(record.role)) continue;
      if (record.certificateStatus !== "sent") continue;

      const pdfPath = await this.getCertificatePdfPath(record);
      if (!existsSync(pdfPath)) continue;

      certificates.push({
        role: record.role,
        fullName: this.fullName(record.nombres, record.apellidos),
        generatedAt: record.certificateSentAt,
        downloadUrl: `/asistencias/certificados/${record.id}/descargar`,
        filename: this.getPublicFilename(record),
      });
    }

    if (certificates.length) {
      return {
        status: "generated",
        message: "El certificado ya esta generado y listo para descargar.",
        certificates,
      };
    }

    const errorRecords = records.filter((record) => record.certificateStatus === "error");

    if (errorRecords.length) {
      return {
        status: "error",
        message:
          errorRecords[0].certificateError ??
          "El certificado no se pudo generar. Contacta al equipo organizador.",
        certificates: [],
        records: errorRecords.map((record) => ({
          id: record.id,
          role: record.role,
          certificateStatus: record.certificateStatus,
          certificateError: record.certificateError,
        })),
      };
    }

    return {
      status: "pending",
      message: "El certificado aun no ha sido generado por el equipo del evento.",
      certificates: [],
      records: records.map((record) => ({
        id: record.id,
        role: record.role,
        certificateStatus: record.certificateStatus,
      })),
    };
  }

  async getDownloadFile(recordId: string) {
    const record = await this.prisma.asistenciaRegistro.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      throw new NotFoundException("Certificado no encontrado.");
    }

    if (record.certificateStatus !== "sent") {
      throw new BadRequestException("El certificado aun no ha sido generado.");
    }

    const pdfPath = await this.getCertificatePdfPath(record);

    if (!existsSync(pdfPath)) {
      throw new NotFoundException("El archivo PDF del certificado no esta disponible.");
    }

    return {
      stream: createReadStream(pdfPath),
      path: pdfPath,
      filename: this.getPublicFilename(record),
    };
  }

  async getGeneratedCertificateFile(record: AsistenciaRegistro) {
    const pdfPath = await this.getCertificatePdfPath(record);

    if (!existsSync(pdfPath)) {
      throw new NotFoundException("El archivo PDF del certificado no esta disponible.");
    }

    return {
      path: pdfPath,
      filename: this.getPublicFilename(record),
    };
  }

  async deleteGeneratedFiles(record: AsistenciaRegistro) {
    const outputBase = await this.getCertificateOutputBase(record);
    const paths = [`${outputBase}.docx`, `${outputBase}.pdf`];
    let deleted = 0;

    for (const path of paths) {
      if (!existsSync(path)) continue;

      await unlink(path);
      deleted += 1;
    }

    return { deletedFiles: deleted };
  }

  async resolveLinkedRegistrationId(role: string, documento: string) {
    if (role === "ponente") {
      const ponente = await this.findPonenteByDocumento(documento);
      return ponente?.id ?? null;
    }

    if (role === "evaluador") {
      const evaluador = await this.findEvaluadorByDocumento(documento);
      return evaluador?.id ?? null;
    }

    if (role === "asistente") {
      const asistente = await this.findAsistenteByDocumento(documento);
      return asistente?.id ?? null;
    }

    return null;
  }

  private async buildTemplateData(record: AsistenciaRegistro): Promise<CertificateTemplateData> {
    if (!this.isCertificateRole(record.role)) {
      throw new BadRequestException("Rol de asistencia no valido para certificado.");
    }

    const base = {
      role: record.role,
      fullName: this.fullName(record.nombres, record.apellidos),
      documento: record.documento,
    };

    if (record.role === "asistente") {
      const linkedRegistrationId =
        record.linkedRegistrationId ??
        (await this.resolveLinkedRegistrationId(record.role, record.documento));

      return {
        ...base,
        linkedRegistrationId,
      };
    }

    if (record.role === "ponente") {
      const ponente = await this.findPonenteByDocumento(record.documento);

      if (!ponente) {
        return {
          ...base,
          linkedRegistrationId: null,
          ponente: {
            autor1: base.fullName,
            documento1: record.documento,
            tituloPonencia:
              record.tituloPonencia || "PONENCIA PRESENTADA EN EL MARCO DEL EVENTO",
            semillero: record.semillero || "NO REGISTRA",
          },
        };
      }

      const autor2 = this.fullName(ponente.nombres2, ponente.apellidos2);

      return {
        ...base,
        fullName: this.fullName(ponente.nombres, ponente.apellidos),
        linkedRegistrationId: ponente.id,
        ponente: {
          autor1: this.fullName(ponente.nombres, ponente.apellidos),
          documento1: ponente.documento,
          autor2: autor2 || undefined,
          documento2: ponente.documento2 ?? undefined,
          tituloPonencia: record.tituloPonencia || ponente.tituloPonencia,
          semillero: record.semillero || ponente.semillero,
        },
      };
    }

    const evaluador = await this.findEvaluadorByDocumento(record.documento);
    const manualPonencias = this.readStoredPonencias(record.ponenciasEvaluadas);

    if (!evaluador) {
      if (!manualPonencias.length) {
        throw new BadRequestException(
          "No se encontro una inscripcion de evaluador asociada a este documento ni ponencias manuales para el certificado.",
        );
      }

      return {
        ...base,
        linkedRegistrationId: null,
        evaluador: {
          universidad: record.institucion,
          ponencias: manualPonencias,
        },
      };
    }

    const ponencias = manualPonencias.length
      ? manualPonencias
      : await this.findPonenciasAsignadasAEvaluador(evaluador.id);

    if (!ponencias.length) {
      throw new BadRequestException(
        "El evaluador no tiene ponencias asignadas para incluir en el certificado.",
      );
    }

    return {
      ...base,
      fullName: this.fullName(evaluador.nombres, evaluador.apellidos),
      linkedRegistrationId: evaluador.id,
      evaluador: {
        universidad: evaluador.universidad,
        ponencias,
      },
    };
  }

  private fillTemplateXml(xml: string, data: CertificateTemplateData) {
    if (data.role === "asistente") {
      return this.replaceSequence(xml, [
        ["XXXXXXXXXXXX", this.upper(data.fullName)],
        ["XXXXXX", data.documento],
      ]);
    }

    if (data.role === "ponente") {
      if (!data.ponente) {
        throw new BadRequestException("Faltan datos de ponente para el certificado.");
      }

      let output = this.replaceSequence(xml, [
        ["XXXXXXXXXXXX", this.upper(data.ponente.autor1)],
        ["XXXXXX", data.ponente.documento1],
      ]);

      if (data.ponente.autor2 && data.ponente.documento2) {
        output = this.replaceSequence(output, [
          ["XXXXXXXXXXXXXX", this.upper(data.ponente.autor2)],
          ["XXXXX", data.ponente.documento2],
        ]);
      } else {
        output = this.removeParagraphContainingText(output, "XXXXXXXXXXXXXX");
        output = this.removeParagraphContainingText(output, "XXXXX");
      }

      return this.replaceSequence(output, [
        ["XXXXXXXXXXXXXXXX", this.upper(data.ponente.tituloPonencia)],
        ["XXXXXX", this.upper(data.ponente.semillero || "NO REGISTRA")],
      ]);
    }

    if (!data.evaluador) {
      throw new BadRequestException("Faltan datos de evaluador para el certificado.");
    }

    return this.replaceSequence(xml, [
      ["XXXXXXXXXXXXXX", this.upper(data.fullName)],
      ["XXXXXXX", data.documento],
      ["Universidad XXXXXXX", this.upper(data.evaluador.universidad)],
    ]).replace(
      EVALUADOR_SAMPLE_BLOCK,
      this.buildEvaluatorTitleParagraphs(data.evaluador.ponencias),
    );
  }

  private replaceSequence(xml: string, replacements: Array<[string, string]>) {
    return replacements.reduce(
      (current, [search, value]) => this.replaceFirstText(current, search, value),
      xml,
    );
  }

  private replaceFirstText(xml: string, search: string, value: string) {
    const escapedSearch = this.escapeRegExp(search);
    const regex = new RegExp(`(<w:t(?:\\s+[^>]*)?>)${escapedSearch}(</w:t>)`);
    return xml.replace(regex, `$1${this.escapeXml(value)}$2`);
  }

  private removeParagraphContainingText(xml: string, search: string) {
    const exactTextNode = new RegExp(
      `<w:t(?:\\s+[^>]*)?>${this.escapeRegExp(search)}</w:t>`,
    );

    return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) =>
      exactTextNode.test(paragraph) ? "" : paragraph,
    );
  }

  private buildEvaluatorTitleParagraphs(titles: string[]) {
    const limitedTitles = titles.slice(0, 9);
    const size = limitedTitles.length > 6 ? "16" : limitedTitles.length > 3 ? "18" : "20";

    return limitedTitles
      .map((title) => {
        const safeTitle = this.escapeXml(this.upper(title));
        return [
          "<w:p>",
          '<w:pPr><w:pStyle w:val="Prrafodelista"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:right="128"/><w:jc w:val="both"/><w:rPr><w:bCs/><w:i/><w:iCs/>',
          `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
          "</w:rPr></w:pPr>",
          "<w:r><w:rPr><w:b/><w:bCs/>",
          `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
          `</w:rPr><w:t>${safeTitle}</w:t></w:r>`,
          "</w:p>",
        ].join("");
      })
      .join("");
  }

  private async findPonenciasAsignadasAEvaluador(evaluadorId: string) {
    const asignaciones = await this.prisma.ponenteEvaluador.findMany({
      where: {
        evaluadorId,
        activo: true,
      },
      include: {
        ponente: true,
      },
      orderBy: { assignedAt: "asc" },
    });

    return asignaciones
      .map((asignacion) => asignacion.ponente?.tituloPonencia)
      .filter((titulo): titulo is string => Boolean(titulo?.trim()))
      .slice(0, 9);
  }

  private readStoredPonencias(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, 9);
  }

  private getTemplatePath(role: CertificateRole) {
    const filename = TEMPLATE_FILENAMES[role];
    const configuredDir = process.env.CERTIFICATE_TEMPLATE_DIR;
    const candidates = [
      configuredDir ? resolve(configuredDir) : null,
      resolve(process.cwd(), "templates", "certificates"),
      "C:\\Users\\FROMERO\\Desktop\\PLANTILLAS CERTIFICADO",
    ].filter((value): value is string => Boolean(value));

    const found = candidates
      .map((dir) => join(dir, filename))
      .find((templatePath) => existsSync(templatePath));

    if (!found) {
      throw new BadRequestException(`No se encontro la plantilla ${filename}.`);
    }

    return found;
  }

  private async getCertificateOutputBase(record: AsistenciaRegistro) {
    const outputDir = resolve(
      process.env.CERTIFICATE_OUTPUT_DIR ?? join(process.cwd(), "certificados-generados"),
    );

    await mkdir(outputDir, { recursive: true });

    return join(outputDir, `${record.role}-${record.id}`);
  }

  private async getCertificatePdfPath(record: AsistenciaRegistro) {
    return `${await this.getCertificateOutputBase(record)}.pdf`;
  }

  private async convertDocxToPdf(docxPath: string, pdfPath: string) {
    await mkdir(dirname(pdfPath), { recursive: true });

    const libreOfficePath = this.findLibreOfficePath();

    if (libreOfficePath) {
      await execFileAsync(
        libreOfficePath,
        ["--headless", "--convert-to", "pdf", "--outdir", dirname(pdfPath), docxPath],
        { timeout: 120000, windowsHide: true },
      );

      const generatedPdf = join(
        dirname(pdfPath),
        `${basename(docxPath, ".docx")}.pdf`,
      );

      if (!existsSync(generatedPdf)) {
        throw new BadRequestException("LibreOffice no genero el PDF del certificado.");
      }

      return;
    }

    if (process.platform === "win32") {
      await this.convertWithWordCom(docxPath, pdfPath);
      return;
    }

    throw new BadRequestException(
      "No se encontro LibreOffice para convertir los certificados a PDF.",
    );
  }

  private findLibreOfficePath() {
    const configured = process.env.LIBREOFFICE_PATH;
    const candidates = [
      configured,
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
      "/usr/bin/libreoffice",
      "/usr/bin/soffice",
    ].filter((value): value is string => Boolean(value));

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  private async convertWithWordCom(docxPath: string, pdfPath: string) {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$word = $null",
      "$doc = $null",
      "try {",
      "  $word = New-Object -ComObject Word.Application",
      "  $word.Visible = $false",
      `  $doc = $word.Documents.Open(${this.toPowerShellString(docxPath)}, $false, $true)`,
      `  $doc.ExportAsFixedFormat(${this.toPowerShellString(pdfPath)}, 17)`,
      "} finally {",
      "  if ($doc -ne $null) { $doc.Close($false) | Out-Null }",
      "  if ($word -ne $null) { $word.Quit() | Out-Null }",
      "}",
    ].join("\n");

    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 120000, windowsHide: true },
    );

    if (!existsSync(pdfPath)) {
      throw new BadRequestException("Microsoft Word no genero el PDF del certificado.");
    }
  }

  private async findPonenteByDocumento(documento: string): Promise<Ponente | null> {
    const ponentes = await this.prisma.ponente.findMany();
    return (
      ponentes.find(
        (ponente) =>
          areEquivalent(ponente.documento, documento) ||
          areEquivalent(ponente.documento2, documento),
      ) ?? null
    );
  }

  private async findEvaluadorByDocumento(documento: string): Promise<Evaluador | null> {
    const evaluadores = await this.prisma.evaluador.findMany();
    return evaluadores.find((evaluador) => areEquivalent(evaluador.documento, documento)) ?? null;
  }

  private async findAsistenteByDocumento(documento: string) {
    const asistentes = await this.prisma.asistente.findMany();
    return asistenteOrNull(
      asistentes.find((asistente) => areEquivalent(asistente.documento, documento)),
    );
  }

  private isCertificateRole(role: string): role is CertificateRole {
    return CERTIFICATE_ROLES.includes(role as CertificateRole);
  }

  private fullName(nombres?: string | null, apellidos?: string | null) {
    return [nombres, apellidos]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  private upper(value: string) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  private getPublicFilename(record: AsistenciaRegistro) {
    const name = this.slugify(this.fullName(record.nombres, record.apellidos));
    return `certificado-${record.role}-${name || record.documento}.pdf`;
  }

  private slugify(value: string) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  }

  private escapeXml(value: string) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private toPowerShellString(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
  }
}

function asistenteOrNull<T>(value: T | undefined): T | null {
  return value ?? null;
}
