/**
 * sync-local-certificates-to-cloudinary.ts
 *
 * Sube los PDFs generados localmente a Cloudinary y actualiza la base de datos
 * de Railway con la URL pública resultante.
 *
 * Uso:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-local-certificates-to-cloudinary.ts
 *
 * O con un .env local que apunte a Railway:
 *   npx tsx --env-file=.env.railway scripts/sync-local-certificates-to-cloudinary.ts
 */

import * as fs from "fs";
import * as path from "path";

// Carga .env automáticamente si existe (dotenv está disponible vía @nestjs/config)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config();
} catch {
  // dotenv no disponible; se usarán las variables de entorno ya establecidas
}

import { v2 as cloudinary } from "cloudinary";
import { PrismaClient } from "@prisma/client";

// ── Validación de variables de entorno ─────────────────────────────────────────
const REQUIRED_ENV = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "DATABASE_URL",
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("❌ Faltan variables de entorno requeridas:", missing.join(", "));
  process.exit(1);
}

// ── Configuración Cloudinary ───────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure: true,
});

const prisma = new PrismaClient();

// ── Constantes ─────────────────────────────────────────────────────────────────
const VALID_ROLES = ["ponente", "asistente", "evaluador"] as const;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ────────────────────────────────────────────────────────────────────

function safePublicId(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugify(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function buildPublicFilename(record: {
  role: string;
  nombres: string;
  apellidos: string;
  documento: string;
}): string {
  const fullName = [record.nombres, record.apellidos]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const slug = slugify(fullName);
  return `certificado-${record.role}-${slug || record.documento}.pdf`;
}

function uploadPdfBuffer(
  buffer: Buffer,
  publicFilename: string,
  folder: string,
): Promise<{ secure_url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: safePublicId(publicFilename),
        resource_type: "raw",
      },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Upload sin resultado"));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const outputDir =
    process.env.CERTIFICATE_OUTPUT_DIR ??
    path.join(process.cwd(), "certificados-generados");

  if (!fs.existsSync(outputDir)) {
    console.error(`❌ Carpeta no encontrada: ${outputDir}`);
    console.error(
      "   Define CERTIFICATE_OUTPUT_DIR o asegúrate de ejecutar desde la raíz del proyecto.",
    );
    process.exit(1);
  }

  const allFiles = fs.readdirSync(outputDir);
  const pdfFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".pdf"));

  console.log(`\n📂 Carpeta: ${outputDir}`);
  console.log(`📄 PDFs encontrados: ${pdfFiles.length}\n`);

  if (!pdfFiles.length) {
    console.log("No hay PDFs para sincronizar.");
    await prisma.$disconnect();
    return;
  }

  let found = 0;
  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const filename of pdfFiles) {
    // Patrón esperado: {role}-{uuid}.pdf
    // Ejemplo: ponente-4c57c56c-a28b-48dd-8b14-2ae7b6183c13.pdf
    const withoutExt = filename.replace(/\.pdf$/i, "");
    const dashIndex = withoutExt.indexOf("-");
    if (dashIndex === -1) {
      console.log(`⏭  Sin guión, ignorando: ${filename}`);
      skipped++;
      continue;
    }

    const role = withoutExt.substring(0, dashIndex);
    const recordId = withoutExt.substring(dashIndex + 1);

    if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
      console.log(`⏭  Rol desconocido "${role}", ignorando: ${filename}`);
      skipped++;
      continue;
    }

    if (!UUID_REGEX.test(recordId)) {
      console.log(`⏭  ID inválido "${recordId}", ignorando: ${filename}`);
      skipped++;
      continue;
    }

    found++;

    try {
      const record = await prisma.asistenciaRegistro.findUnique({
        where: { id: recordId },
      });

      if (!record) {
        console.log(`⚠️  Registro no encontrado en DB: ${recordId} (${filename})`);
        skipped++;
        continue;
      }

      if (record.certificateUrl) {
        console.log(`✅ Ya tiene URL en Cloudinary, omitiendo: ${filename}`);
        skipped++;
        continue;
      }

      const filePath = path.join(outputDir, filename);
      const buffer = fs.readFileSync(filePath);
      const publicFilename = buildPublicFilename(record);

      console.log(`⬆️  Subiendo: ${filename}`);
      console.log(`   → ${publicFilename}`);

      const upload = await uploadPdfBuffer(buffer, publicFilename, "congreso/certificados");

      await prisma.asistenciaRegistro.update({
        where: { id: recordId },
        data: {
          certificateStatus: "sent",
          certificateSentAt: record.certificateSentAt ?? new Date(),
          certificateUrl: upload.secure_url,
          certificatePublicId: upload.public_id,
          certificateError: null,
        },
      });

      console.log(`   ✅ Subido correctamente`);
      uploaded++;
    } catch (error) {
      console.error(
        `   ❌ Error procesando ${filename}:`,
        error instanceof Error ? error.message : error,
      );
      errors++;
    }
  }

  console.log("\n─────────────────────────────");
  console.log(`📊 Resumen`);
  console.log(`   PDFs con patrón válido: ${found}`);
  console.log(`   Subidos a Cloudinary:   ${uploaded}`);
  console.log(`   Omitidos:               ${skipped}`);
  console.log(`   Errores:                ${errors}`);
  console.log("─────────────────────────────\n");

  await prisma.$disconnect();

  if (errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error("❌ Error fatal:", error instanceof Error ? error.message : error);
  prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
