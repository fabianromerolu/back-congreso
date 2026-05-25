import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { AsistenciaRegistro, Evaluador, Ponente } from "@prisma/client";
import { execFile } from "child_process";
import { createReadStream, existsSync, readFileSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import JSZip from "jszip";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { CloudinaryService } from "../cloudinary/cloudinary.service";
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

export type CertificateAccess =
  | { type: "remote"; url: string; filename: string }
  | { type: "local"; stream: ReturnType<typeof createReadStream>; path: string; filename: string };

const TEMPLATE_FILENAMES: Record<CertificateRole, string> = {
  asistente: "PLANTILLA ASISTENTE.docx",
  evaluador: "PLANTILLA EVALUADOR.docx",
  ponente: "PLANTILLA PONENTE.docx",
};

// Marcadores de texto que delimitan el bloque de ponencias de muestra en la plantilla evaluador
const EVALUADOR_FIRST_SAMPLE = "LA EVOLUCI";
const EVALUADOR_LAST_SAMPLE = "DERECHOS HUMANOS";

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

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

    let certificateUrl: string | null = null;
    let certificatePublicId: string | null = null;

    try {
      const pdfBuffer = await readFile(pdfPath);
      const upload = await this.cloudinary.uploadPdf(
        pdfBuffer,
        this.getPublicFilename(record),
        "congreso/certificados",
      );
      certificateUrl = upload.secure_url;
      certificatePublicId = upload.public_id;
    } catch (uploadError) {
      console.error(
        `[CertificatesService] Cloudinary upload failed for record ${record.id}:`,
        uploadError instanceof Error ? uploadError.message : uploadError,
      );
    }

    return {
      docxPath,
      pdfPath,
      linkedRegistrationId: data.linkedRegistrationId,
      certificateUrl,
      certificatePublicId,
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

      // Si tiene URL remota, el endpoint /descargar la proxyea con headers correctos
      if (record.certificateUrl) {
        certificates.push({
          role: record.role,
          fullName: this.fullName(record.nombres, record.apellidos),
          generatedAt: record.certificateSentAt,
          downloadUrl: `/asistencias/certificados/${record.id}/descargar`,
          filename: this.getPublicFilename(record),
        });
        continue;
      }

      // Fallback: archivo local en disco
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

  async getCertificateAccess(recordId: string): Promise<CertificateAccess> {
    const record = await this.prisma.asistenciaRegistro.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      throw new NotFoundException("Certificado no encontrado.");
    }

    if (record.certificateStatus !== "sent") {
      throw new BadRequestException("El certificado aun no ha sido generado.");
    }

    const filename = this.getPublicFilename(record);

    const pdfPath = await this.getCertificatePdfPath(record);

    if (existsSync(pdfPath)) {
      return { type: "local", stream: createReadStream(pdfPath), path: pdfPath, filename };
    }

    if (record.certificateUrl) {
      return { type: "remote", url: record.certificateUrl, filename };
    }

    throw new NotFoundException("El archivo PDF del certificado no esta disponible.");
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

    const filled = this.replaceSequence(xml, [
      ["XXXXXXXXXXXXXX", this.upper(data.fullName)],
      ["XXXXXXX", data.documento],
      ["Universidad XXXXXXX", this.upper(data.evaluador.universidad)],
    ]);

    return this.replaceEvaluadorSampleBlock(
      filled,
      this.buildEvaluatorTitleParagraphs(data.evaluador.ponencias),
    );
  }

  private replaceEvaluadorSampleBlock(xml: string, newParagraphs: string): string {
    const firstSampleIdx = xml.indexOf(EVALUADOR_FIRST_SAMPLE);
    const lastSampleIdx = xml.indexOf(EVALUADOR_LAST_SAMPLE);

    if (firstSampleIdx === -1 || lastSampleIdx === -1) {
      throw new BadRequestException(
        "No se encontro el bloque de ponencias de muestra en la plantilla de evaluador.",
      );
    }

    // lastIndexOf("<w:p>") and lastIndexOf("<w:p ") to find the actual <w:p> opener
    // (NOT <w:pPr> or <w:pStyle> which also start with "<w:p")
    const startA = xml.lastIndexOf("<w:p>", firstSampleIdx);
    const startB = xml.lastIndexOf("<w:p ", firstSampleIdx);
    const blockStart = Math.max(startA, startB);

    const blockEnd = xml.indexOf("</w:p>", lastSampleIdx) + "</w:p>".length;

    if (blockStart === -1 || blockEnd <= blockStart) {
      throw new BadRequestException(
        "No se pudo determinar los limites del bloque de ponencias en la plantilla.",
      );
    }

    return xml.substring(0, blockStart) + newParagraphs + xml.substring(blockEnd);
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
    const limitedTitles = titles.slice(0, 10);
    const size = limitedTitles.length > 7 ? "16" : limitedTitles.length > 4 ? "18" : "20";

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
      .slice(0, 10);
  }

  private readStoredPonencias(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, 10);
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
      try {
        await this.convertWithWordCom(docxPath, pdfPath);
        return;
      } catch {
        // Word COM no disponible, continuar al fallback mammoth
      }
    }

    await this.convertDocxViaMammoth(docxPath, pdfPath);
  }

  private async convertDocxViaMammoth(docxPath: string, pdfPath: string): Promise<void> {
    const { default: mammoth } = await import("mammoth");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mammothAny = mammoth as any;
    const result: { value: string } = await mammothAny.convertToHtml({
      path: docxPath,
      convertImage: mammothAny.images.imgElement(async (image: any) => {
        const imageBuffer = await image.read("base64");
        return { src: `data:${image.contentType};base64,${imageBuffer}` };
      }),
    });

    // Preprocesar: párrafos con 20+ espacios → 2 columnas (área de firmas)
    const fixedBody = this.splitSpaceAlignedParagraphs(result.value);

    const html = `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; background: #fff; }
      p { margin: 3px 0; }
      img { max-width: 100%; height: auto; vertical-align: middle; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      td { padding: 4px 8px; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; }
    </style>
  </head>
  <body>${fixedBody}</body>
</html>`;

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });

      await page.evaluate(() => {
        // Primer párrafo con 2+ imágenes → logos → centrar (extraer imágenes limpiamente)
        // Párrafos posteriores con 2+ imágenes → firmas → separar izquierda/derecha
        let logosDone = false;

        document.querySelectorAll("p").forEach((el) => {
          const p = el as HTMLElement;
          const images = p.querySelectorAll("img");
          if (images.length < 2) return;

          if (!logosDone) {
            // Extraer solo las imágenes (sin nodos de texto ni strong wrappers)
            // para evitar que el espacio en blanco entre ellas descuadre el centrado
            const imgElements = Array.from(images) as HTMLElement[];
            const container = document.createElement("div");
            container.style.cssText =
              "display:flex;justify-content:center;align-items:center;gap:40px;margin:8px 0;";
            imgElements.forEach((img) => container.appendChild(img));
            p.replaceWith(container);
            logosDone = true;
          } else {
            const img1 = images[0] as HTMLElement;
            const img2 = images[1] as HTMLElement;
            const container = document.createElement("div");
            container.style.cssText =
              "display:flex;justify-content:space-between;width:100%;margin:6px 0;";
            const leftDiv = document.createElement("div");
            const rightDiv = document.createElement("div");
            leftDiv.appendChild(img1);
            rightDiv.appendChild(img2);
            container.appendChild(leftDiv);
            container.appendChild(rightDiv);
            p.replaceWith(container);
          }
        });
      });

      await page.pdf({
        path: pdfPath,
        width: "1190px",
        height: "842px",
        printBackground: true,
      });
    } finally {
      await browser.close();
    }
  }

  private splitSpaceAlignedParagraphs(html: string): string {
    return html.replace(/<p(\b[^>]*)>([\s\S]*?)<\/p>/g, (match, _attrs, content) => {
      const textOnly = content.replace(/<[^>]+>/g, "");
      // Detectar párrafos con 20+ espacios consecutivos (columnas alineadas por espacios en Word)
      if (!/\S\s{20,}\S/.test(textOnly)) return match;

      // Si el contenido está envuelto en un único tag (<strong>, <em>, etc.), preservarlo en ambas partes
      const wrapperMatch = content.match(/^(<(\w+)[^>]*)>([\s\S]*)<\/\2>$/);
      let leftHtml: string;
      let rightHtml: string;

      if (wrapperMatch) {
        const openTag = `${wrapperMatch[1]}>`;
        const tagName = wrapperMatch[2] as string;
        const closeTag = `</${tagName}>`;
        // filter(Boolean) elimina partes vacías creadas por espacios iniciales/finales >= 20
        const parts = (wrapperMatch[3] as string)
          .split(/\s{20,}/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (parts.length < 2) return match;
        leftHtml = `${openTag}${parts[0]}${closeTag}`;
        rightHtml = `${openTag}${parts[1]}${closeTag}`;
      } else {
        const parts = content
          .split(/\s{20,}/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (parts.length < 2) return match;
        leftHtml = parts[0];
        rightHtml = parts[1];
      }

      if (!leftHtml || !rightHtml) return match;

      return [
        `<div style="display:flex;justify-content:space-between;align-items:flex-start;`,
        `width:100%;margin:3px 0">`,
        `<div style="text-align:left">${leftHtml}</div>`,
        `<div style="text-align:right">${rightHtml}</div>`,
        `</div>`,
      ].join("");
    });
  }

  private buildHtmlCertificate(data: CertificateTemplateData): string {
    const htmlTemplatePath = this.getHtmlTemplatePath(data.role);
    const templateHtml = readFileSync(htmlTemplatePath, "utf-8");

    const eventName = process.env.EVENT_NAME ?? "IV CONGRESO DE SEMILLEROS UCC MONTERIA";
    const eventDate = process.env.EVENT_DATE ?? "Mayo 2025";
    const eventLocation = process.env.EVENT_LOCATION ?? "Monteria, Cordoba";

    let html = templateHtml
      .replace(/\{\{FULL_NAME\}\}/g, this.escapeHtml(this.upper(data.fullName)))
      .replace(/\{\{DOCUMENTO\}\}/g, this.escapeHtml(data.documento))
      .replace(/\{\{EVENT_NAME\}\}/g, this.escapeHtml(eventName))
      .replace(/\{\{EVENT_DATE\}\}/g, this.escapeHtml(eventDate))
      .replace(/\{\{EVENT_LOCATION\}\}/g, this.escapeHtml(eventLocation));

    if (data.role === "ponente" && data.ponente) {
      const autor2Block =
        data.ponente.autor2 && data.ponente.documento2
          ? `<div class="coautor-block">Coautor: <span class="coautor-name">${this.escapeHtml(this.upper(data.ponente.autor2))}</span> &mdash; ${this.escapeHtml(data.ponente.documento2)}</div>`
          : "";

      html = html
        .replace(/\{\{AUTOR2_BLOCK\}\}/g, autor2Block)
        .replace(
          /\{\{TITULO_PONENCIA\}\}/g,
          this.escapeHtml(this.upper(data.ponente.tituloPonencia)),
        )
        .replace(
          /\{\{SEMILLERO\}\}/g,
          this.escapeHtml(this.upper(data.ponente.semillero ?? "NO REGISTRA")),
        );
    }

    if (data.role === "evaluador" && data.evaluador) {
      const items = data.evaluador.ponencias
        .slice(0, 10)
        .map((p) => `<li>${this.escapeHtml(this.upper(p))}</li>`)
        .join("\n");

      html = html
        .replace(
          /\{\{UNIVERSIDAD\}\}/g,
          this.escapeHtml(this.upper(data.evaluador.universidad)),
        )
        .replace(/\{\{PONENCIAS_LIST\}\}/g, items);
    }

    return html;
  }

  private getHtmlTemplatePath(role: CertificateRole): string {
    const configuredDir = process.env.CERTIFICATE_TEMPLATE_DIR;
    const candidates = [
      configuredDir ? resolve(configuredDir) : null,
      resolve(process.cwd(), "templates", "certificates"),
    ].filter((value): value is string => Boolean(value));

    const filename = `${role}.html`;
    const found = candidates.map((dir) => join(dir, filename)).find((p) => existsSync(p));

    if (!found) {
      throw new BadRequestException(`No se encontro la plantilla HTML ${filename}.`);
    }

    return found;
  }

  private async convertHtmlToPdf(html: string, pdfPath: string): Promise<void> {
    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({
        path: pdfPath,
        width: "1190px",
        height: "842px",
        printBackground: true,
      });
    } finally {
      await browser.close();
    }
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

  getPublicFilename(record: AsistenciaRegistro) {
    const name = this.slugify(this.fullName(record.nombres, record.apellidos));
    return `certificado-${record.role}-${name || record.documento}.pdf`;
  }

  private slugify(value: string) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
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

  private escapeHtml(value: string): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private toPowerShellString(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
  }
}

function asistenteOrNull<T>(value: T | undefined): T | null {
  return value ?? null;
}
