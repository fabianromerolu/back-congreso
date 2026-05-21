// src/asistencias/asistencias.service.ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AsistenciaRegistro } from "@prisma/client";
import { areEquivalent, normalizeComparable, normalizeToStore } from "../common/utils/normalizer";
import { PrismaService } from "../prisma/prisma.service";
import { CertificateEmailService } from "./certificate-email.service";
import { CertificatesService } from "./certificates.service";
import { CreateAsistenciaDto } from "./dto/create-asistencia.dto";

type AttendanceRole = "ponente" | "asistente" | "evaluador";

const MAX_STORED_PONENTE_TITLES = 10;

type SendCertificatesOptions = {
  pendingOnly?: boolean;
  retryErrors?: boolean;
  sendEmail?: boolean;
  recordIds?: string[];
};

type RegisterOptions = {
  skipConfig?: boolean;
  upsert?: boolean;
  adminManual?: boolean;
};

type EmailSummary = {
  sent: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class AsistenciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: CertificatesService,
    private readonly certificateEmail: CertificateEmailService,
  ) {}

  async getConfigPublica() {
    const config = await this.getOrCreateConfig();
    return { enabled: config.habilitado };
  }

  async register(dto: CreateAsistenciaDto, options: RegisterOptions = {}) {
    const config = await this.getOrCreateConfig();
    const cleanDto = this.normalizeAttendanceInput(dto);

    if (!options.skipConfig && !config.habilitado) {
      throw new BadRequestException("El registro de asistencias no esta habilitado.");
    }

    if (!this.isValidRole(cleanDto.role)) {
      throw new BadRequestException("Rol de asistencia no valido.");
    }

    const existing = await this.findExistingAttendance(
      cleanDto.role,
      cleanDto.documento,
    );

    if (existing && !options.upsert) {
      if (cleanDto.role === "ponente" && cleanDto.appendPonencias) {
        return this.appendPonenciasToExisting(existing, cleanDto);
      }

      throw new BadRequestException(
        "Ya existe un registro de asistencia para este documento y rol.",
      );
    }

    const linkedRegistrationId = await this.certificates.resolveLinkedRegistrationId(
      cleanDto.role,
      cleanDto.documento,
    );
    const ponenciasEvaluadas = await this.resolvePonenciasEvaluadas(cleanDto);

    if (options.adminManual) {
      this.validateManualAttendance(cleanDto, linkedRegistrationId, ponenciasEvaluadas);
    }

    const data = {
      role: cleanDto.role,
      nombres: cleanDto.nombres,
      apellidos: cleanDto.apellidos,
      tipoDocumento: cleanDto.tipoDocumento,
      documento: cleanDto.documento,
      email: cleanDto.email,
      telefono: cleanDto.telefono,
      institucion: cleanDto.institucion,
      ciudad: cleanDto.ciudad,
      semillero: cleanDto.semillero || null,
      tituloPonencia: cleanDto.tituloPonencia || null,
      ponenciasEvaluadas: ponenciasEvaluadas.length
        ? (ponenciasEvaluadas as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      source: cleanDto.source ?? "direct",
      certificateStatus: "pending",
      certificateSentAt: null,
      certificateError: null,
      linkedRegistrationId,
    };

    if (existing) {
      return this.prisma.asistenciaRegistro.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.asistenciaRegistro.create({ data });
  }

  registerManual(dto: CreateAsistenciaDto) {
    return this.register(dto, {
      skipConfig: true,
      upsert: true,
      adminManual: true,
    });
  }

  async getAdminSnapshot() {
    const [config, records] = await Promise.all([
      this.getOrCreateConfig(),
      this.prisma.asistenciaRegistro.findMany({
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      enabled: config.habilitado,
      habilitado: config.habilitado,
      records,
      registros: records,
    };
  }

  async updateConfig(enabled: boolean) {
    const config = await this.getOrCreateConfig();

    const updated = await this.prisma.asistenciaConfig.update({
      where: { id: config.id },
      data: { habilitado: enabled },
    });

    return { enabled: updated.habilitado, habilitado: updated.habilitado };
  }

  async sendCertificates(options: SendCertificatesOptions = {}) {
    const pendingOnly = options.pendingOnly ?? true;
    const retryErrors = options.retryErrors ?? true;
    const sendEmail = options.sendEmail ?? false;
    const statuses = retryErrors ? ["pending", "error"] : ["pending"];
    const recordIds = this.cleanIds(options.recordIds ?? []);
    const where = recordIds.length
      ? { id: { in: recordIds } }
      : pendingOnly
        ? { certificateStatus: { in: statuses } }
        : undefined;

    const records = await this.prisma.asistenciaRegistro.findMany({ where });

    if (recordIds.length && !records.length) {
      throw new NotFoundException("No se encontro el registro de asistencia indicado.");
    }

    const existingErrorRecords =
      retryErrors || recordIds.length
        ? []
        : await this.prisma.asistenciaRegistro.findMany({
            where: { certificateStatus: "error" },
          });

    if (!records.length) {
      return {
        message: existingErrorRecords.length
          ? "No hay registros pendientes para generar, pero hay registros con error previo."
          : "No hay registros pendientes para generar.",
        sent: 0,
        enviados: 0,
        generated: 0,
        generados: 0,
        failed: 0,
        fallidos: 0,
        processed: 0,
        procesados: 0,
        retryErrors,
        email: { sent: 0, skipped: 0, failed: 0 },
        failedRecords: [],
        registrosFallidos: [],
        existingErrorRecords: existingErrorRecords.map((record) =>
          this.serializeCertificateRecord(record),
        ),
        registrosConError: existingErrorRecords.map((record) =>
          this.serializeCertificateRecord(record),
        ),
      };
    }

    let generated = 0;
    let failed = 0;
    const email: EmailSummary = { sent: 0, skipped: 0, failed: 0 };
    const generatedRecords: Array<Record<string, unknown>> = [];
    const failedRecords: Array<Record<string, unknown>> = [];

    for (const record of records) {
      try {
        const result = await this.certificates.generateCertificate(record);
        const emailResult = sendEmail
          ? await this.sendGeneratedCertificateEmail(record)
          : null;

        if (emailResult?.sent) email.sent += 1;
        if (emailResult?.skipped) email.skipped += 1;

        const updated = await this.prisma.asistenciaRegistro.update({
          where: { id: record.id },
          data: {
            certificateStatus: "sent",
            certificateSentAt: new Date(),
            certificateError: emailResult?.skipped ? emailResult.message : null,
            linkedRegistrationId:
              result.linkedRegistrationId ?? record.linkedRegistrationId,
            certificateUrl: result.certificateUrl ?? null,
            certificatePublicId: result.certificatePublicId ?? null,
          },
        });

        generated += 1;
        generatedRecords.push(
          this.serializeCertificateRecord(updated, {
            emailSent: Boolean(emailResult?.sent),
            emailSkipped: Boolean(emailResult?.skipped),
            emailMessage: emailResult?.message ?? null,
          }),
        );
      } catch (error) {
        failed += 1;
        if (sendEmail) email.failed += 1;

        const message =
          error instanceof Error
            ? error.message
            : "No se pudo generar el certificado.";

        const updated = await this.prisma.asistenciaRegistro.update({
          where: { id: record.id },
          data: {
            certificateStatus: "error",
            certificateError: message,
          },
        });

        failedRecords.push({
          ...this.serializeCertificateRecord(updated),
          error: message,
        });
      }
    }

    const emailMessage = sendEmail
      ? ` Correos enviados: ${email.sent}. Omitidos: ${email.skipped}.`
      : "";

    return {
      message: `Proceso finalizado. Generados: ${generated}. Fallidos: ${failed}.${emailMessage}`,
      sent: generated,
      enviados: generated,
      generated,
      generados: generated,
      failed,
      fallidos: failed,
      processed: records.length,
      procesados: records.length,
      retryErrors,
      email,
      generatedRecords,
      registrosGenerados: generatedRecords,
      failedRecords,
      registrosFallidos: failedRecords,
    };
  }

  async clearGeneratedCertificates() {
    const records = await this.prisma.asistenciaRegistro.findMany({
      where: { certificateStatus: "sent" },
    });

    let deletedFiles = 0;
    let reset = 0;

    for (const record of records) {
      const result = await this.certificates.deleteGeneratedFiles(record);
      deletedFiles += result.deletedFiles;

      await this.resetCertificateRecord(record.id);
      reset += 1;
    }

    return {
      message: `Certificados borrados: ${records.length}. Registros reiniciados: ${reset}.`,
      deleted: records.length,
      eliminados: records.length,
      reset,
      reiniciados: reset,
      affected: reset,
      afectados: reset,
      deletedFiles,
      archivosEliminados: deletedFiles,
    };
  }

  async deleteGeneratedCertificate(recordId: string) {
    const record = await this.findAttendanceRecord(recordId);
    const result = await this.certificates.deleteGeneratedFiles(record);

    await this.resetCertificateRecord(record.id);

    return {
      message: "Certificado borrado y registro listo para regenerar.",
      deleted: 1,
      eliminados: 1,
      reset: 1,
      reiniciados: 1,
      affected: 1,
      afectados: 1,
      deletedFiles: result.deletedFiles,
      archivosEliminados: result.deletedFiles,
    };
  }

  async deleteAttendanceRecord(recordId: string) {
    const record = await this.findAttendanceRecord(recordId);
    await this.certificates.deleteGeneratedFiles(record);
    await this.prisma.asistenciaRegistro.delete({ where: { id: record.id } });

    return {
      message: "Registro de asistencia eliminado correctamente.",
      deleted: 1,
      eliminados: 1,
    };
  }

  async updateAttendanceRecord(
    id: string,
    data: {
      nombres?: string;
      apellidos?: string;
      email?: string;
      telefono?: string;
      ciudad?: string;
      institucion?: string;
      semillero?: string | null;
      tituloPonencia?: string | null;
    },
  ) {
    const record = await this.findAttendanceRecord(id);
    const updateData: Prisma.AsistenciaRegistroUpdateInput = {};

    if (data.nombres !== undefined) updateData.nombres = normalizeToStore(data.nombres);
    if (data.apellidos !== undefined) updateData.apellidos = normalizeToStore(data.apellidos);
    if (data.email !== undefined) updateData.email = data.email.toLowerCase().trim();
    if (data.telefono !== undefined) updateData.telefono = data.telefono.trim();
    if (data.ciudad !== undefined) updateData.ciudad = normalizeToStore(data.ciudad);
    if (data.institucion !== undefined) updateData.institucion = normalizeToStore(data.institucion);
    if ("semillero" in data) updateData.semillero = data.semillero ?? null;
    if ("tituloPonencia" in data) updateData.tituloPonencia = data.tituloPonencia ?? null;

    const updated = await this.prisma.asistenciaRegistro.update({
      where: { id: record.id },
      data: updateData,
    });

    return {
      message: "Registro de asistencia actualizado correctamente.",
      record: updated,
      registro: updated,
    };
  }

  async clearAllAttendanceRecords() {
    const records = await this.prisma.asistenciaRegistro.findMany();
    let deletedFiles = 0;

    for (const record of records) {
      const result = await this.certificates.deleteGeneratedFiles(record);
      deletedFiles += result.deletedFiles;
    }

    const { count } = await this.prisma.asistenciaRegistro.deleteMany();

    return {
      message: `Se eliminaron ${count} registros de asistencia.`,
      deleted: count,
      eliminados: count,
      deletedFiles,
    };
  }

  regenerateCertificate(recordId: string, options: { sendEmail?: boolean } = {}) {
    return this.sendCertificates({
      recordIds: [recordId],
      pendingOnly: false,
      retryErrors: true,
      sendEmail: options.sendEmail ?? true,
    });
  }

  lookupCertificateByDocument(documento: string) {
    return this.certificates.lookupByDocument(documento);
  }

  getCertificateDownload(recordId: string) {
    return this.certificates.getCertificateAccess(recordId);
  }

  private async sendGeneratedCertificateEmail(record: AsistenciaRegistro) {
    const file = await this.certificates.getGeneratedCertificateFile(record);
    return this.certificateEmail.sendCertificate(record, file.path, file.filename);
  }

  private async resetCertificateRecord(id: string) {
    return this.prisma.asistenciaRegistro.update({
      where: { id },
      data: {
        certificateStatus: "pending",
        certificateSentAt: null,
        certificateError: null,
        certificateUrl: null,
        certificatePublicId: null,
      },
    });
  }

  private async findAttendanceRecord(id: string) {
    const record = await this.prisma.asistenciaRegistro.findUnique({
      where: { id },
    });

    if (!record) {
      throw new NotFoundException("Registro de asistencia no encontrado.");
    }

    return record;
  }

  private async getOrCreateConfig() {
    const existing = await this.prisma.asistenciaConfig.findFirst();
    if (existing) return existing;

    return this.prisma.asistenciaConfig.create({
      data: { habilitado: false },
    });
  }

  private isValidRole(role?: string): role is AttendanceRole {
    return role === "ponente" || role === "asistente" || role === "evaluador";
  }

  private async findExistingAttendance(role: AttendanceRole, documento: string) {
    const roleRecords = await this.prisma.asistenciaRegistro.findMany({
      where: { role },
    });

    return (
      roleRecords.find((record) => areEquivalent(record.documento, documento)) ??
      null
    );
  }

  private validateManualAttendance(
    dto: ReturnType<AsistenciasService["normalizeAttendanceInput"]>,
    linkedRegistrationId: string | null,
    ponenciasEvaluadas: string[],
  ) {
    if (dto.role === "ponente" && !linkedRegistrationId && !dto.tituloPonencia) {
      throw new BadRequestException(
        "Debes indicar el nombre de la ponencia presentada por el ponente.",
      );
    }

    if (dto.role === "evaluador" && !ponenciasEvaluadas.length) {
      throw new BadRequestException(
        "Debes seleccionar al menos una ponencia evaluada por el evaluador.",
      );
    }
  }

  private async resolvePonenciasEvaluadas(
    dto: ReturnType<AsistenciasService["normalizeAttendanceInput"]>,
  ) {
    if (dto.role !== "evaluador") return [];

    const ids = this.cleanIds(dto.ponenciaIds ?? []).slice(0, 9);
    const manualTitles = this.cleanTitles(dto.ponenciasEvaluadas ?? []);

    if (!ids.length) return manualTitles.slice(0, 9);

    const ponentes = await this.prisma.ponente.findMany({
      where: { id: { in: ids } },
      select: { id: true, tituloPonencia: true },
    });
    const titlesById = new Map(ponentes.map((ponente) => [ponente.id, ponente.tituloPonencia]));

    const titlesFromIds = ids
      .map((id) => titlesById.get(id))
      .filter((title): title is string => Boolean(title?.trim()));

    return [...titlesFromIds, ...manualTitles]
      .map((title) => normalizeToStore(title) ?? "")
      .filter(Boolean)
      .filter((title, index, arr) => arr.indexOf(title) === index)
      .slice(0, 9);
  }

  private normalizeAttendanceInput(dto: CreateAsistenciaDto) {
    return {
      ...dto,
      nombres: normalizeToStore(dto.nombres) ?? "",
      apellidos: normalizeToStore(dto.apellidos) ?? "",
      tipoDocumento: normalizeToStore(dto.tipoDocumento) ?? "",
      documento: normalizeToStore(dto.documento) ?? "",
      email: normalizeToStore(dto.email) ?? "",
      telefono: normalizeToStore(dto.telefono) ?? "",
      institucion: normalizeToStore(dto.institucion || dto.universidad) ?? "",
      ciudad: normalizeToStore(dto.ciudad) ?? "",
      semillero: normalizeToStore(dto.semillero) ?? "",
      tituloPonencia: normalizeToStore(dto.tituloPonencia) ?? "",
      appendPonencias: Boolean(dto.appendPonencias),
      ponenciasAdicionales: this.cleanTitles(dto.ponenciasAdicionales ?? []),
      source: dto.source ?? "direct",
      ponenciaIds: this.cleanIds(dto.ponenciaIds ?? []),
      ponenciasEvaluadas: this.cleanTitles(dto.ponenciasEvaluadas ?? []),
    };
  }

  private async appendPonenciasToExisting(
    existing: AsistenciaRegistro,
    dto: ReturnType<AsistenciasService["normalizeAttendanceInput"]>,
  ) {
    const currentTitles = this.splitPonenteTitles(existing.tituloPonencia);
    const incomingTitles = this.collectPonenteTitles([
      dto.tituloPonencia,
      ...dto.ponenciasAdicionales,
    ]);

    if (!incomingTitles.length) {
      throw new BadRequestException(
        "Debes indicar al menos una ponencia adicional para anexar al registro.",
      );
    }

    const currentKeys = new Set(currentTitles.map((title) => normalizeComparable(title)));
    const hasNewTitle = incomingTitles.some(
      (title) => !currentKeys.has(normalizeComparable(title)),
    );

    if (!hasNewTitle) {
      throw new BadRequestException(
        "La ponencia indicada ya esta registrada para este ponente.",
      );
    }

    const mergedTitle = this.mergePonenteTitles(currentTitles, incomingTitles).join(" Y ");

    await this.certificates.deleteGeneratedFiles(existing).catch((error) => {
      console.error(
        `[AsistenciasService] No se pudieron borrar certificados locales del registro ${existing.id}:`,
        error instanceof Error ? error.message : error,
      );
    });

    return this.prisma.asistenciaRegistro.update({
      where: { id: existing.id },
      data: {
        tituloPonencia: mergedTitle,
        certificateStatus: "pending",
        certificateSentAt: null,
        certificateError: null,
        certificateUrl: null,
        certificatePublicId: null,
      },
    });
  }

  private cleanIds(values: string[]) {
    return values
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index);
  }

  private cleanTitles(values: string[]) {
    return values
      .map((value) => normalizeToStore(value) ?? "")
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, 9);
  }

  private splitPonenteTitles(value?: string | null) {
    const clean = normalizeToStore(value) ?? "";
    if (!clean) return [];

    return clean
      .split(/\s+Y\s+/i)
      .map((title) => normalizeToStore(title) ?? "")
      .filter(Boolean);
  }

  private collectPonenteTitles(values: string[]) {
    const seen = new Set<string>();
    const titles: string[] = [];

    values.forEach((value) => {
      this.splitPonenteTitles(value).forEach((title) => {
        const key = normalizeComparable(title);
        if (!key || seen.has(key)) return;
        seen.add(key);
        titles.push(title);
      });
    });

    return titles.slice(0, MAX_STORED_PONENTE_TITLES);
  }

  private mergePonenteTitles(currentTitles: string[], incomingTitles: string[]) {
    const seen = new Set<string>();
    const merged: string[] = [];

    [...currentTitles, ...incomingTitles].forEach((title) => {
      const clean = normalizeToStore(title) ?? "";
      const key = normalizeComparable(clean);
      if (!key || seen.has(key)) return;

      seen.add(key);
      merged.push(clean);
    });

    return merged.slice(0, MAX_STORED_PONENTE_TITLES);
  }

  private serializeCertificateRecord(
    record: Pick<
      AsistenciaRegistro,
      | "id"
      | "role"
      | "nombres"
      | "apellidos"
      | "documento"
      | "email"
      | "semillero"
      | "tituloPonencia"
      | "ponenciasEvaluadas"
      | "certificateStatus"
      | "certificateError"
      | "certificateSentAt"
      | "linkedRegistrationId"
    >,
    extra: Record<string, unknown> = {},
  ) {
    return {
      id: record.id,
      role: record.role,
      nombres: record.nombres,
      apellidos: record.apellidos,
      fullName: `${record.nombres} ${record.apellidos}`.trim(),
      documento: record.documento,
      email: record.email,
      semillero: record.semillero,
      tituloPonencia: record.tituloPonencia,
      ponenciasEvaluadas: record.ponenciasEvaluadas,
      certificateStatus: record.certificateStatus,
      certificateError: record.certificateError,
      certificateSentAt: record.certificateSentAt,
      linkedRegistrationId: record.linkedRegistrationId,
      ...extra,
    };
  }
}
