// src/asistencias/asistencias.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { areEquivalent, normalizeToStore } from "../common/utils/normalizer";
import { PrismaService } from "../prisma/prisma.service";
import { CertificatesService } from "./certificates.service";
import { CreateAsistenciaDto } from "./dto/create-asistencia.dto";

type SendCertificatesOptions = {
  pendingOnly?: boolean;
  retryErrors?: boolean;
};

@Injectable()
export class AsistenciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: CertificatesService,
  ) {}

  async getConfigPublica() {
    const config = await this.getOrCreateConfig();
    return { enabled: config.habilitado };
  }

  async register(dto: CreateAsistenciaDto) {
    const config = await this.getOrCreateConfig();
    const cleanDto = this.normalizeAttendanceInput(dto);

    if (!config.habilitado) {
      throw new BadRequestException("El registro de asistencias no esta habilitado.");
    }

    if (!this.isValidRole(cleanDto.role)) {
      throw new BadRequestException("Rol de asistencia no valido.");
    }

    const roleRecords = await this.prisma.asistenciaRegistro.findMany({
      where: { role: cleanDto.role },
    });
    const existing = roleRecords.find((record) =>
      areEquivalent(record.documento, cleanDto.documento),
    );

    if (existing) {
      throw new BadRequestException(
        "Ya existe un registro de asistencia para este documento y rol.",
      );
    }

    const linkedRegistrationId = await this.certificates.resolveLinkedRegistrationId(
      cleanDto.role,
      cleanDto.documento,
    );

    return this.prisma.asistenciaRegistro.create({
      data: {
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
        source: cleanDto.source ?? "direct",
        linkedRegistrationId,
      },
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
    const statuses = retryErrors ? ["pending", "error"] : ["pending"];
    const where = pendingOnly
      ? { certificateStatus: { in: statuses } }
      : undefined;

    const records = await this.prisma.asistenciaRegistro.findMany({ where });
    const existingErrorRecords = retryErrors
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
    const generatedRecords: Array<Record<string, unknown>> = [];
    const failedRecords: Array<Record<string, unknown>> = [];

    for (const record of records) {
      try {
        const result = await this.certificates.generateCertificate(record);

        const updated = await this.prisma.asistenciaRegistro.update({
          where: { id: record.id },
          data: {
            certificateStatus: "sent",
            certificateSentAt: new Date(),
            certificateError: null,
            linkedRegistrationId:
              result.linkedRegistrationId ?? record.linkedRegistrationId,
          },
        });

        generated += 1;
        generatedRecords.push(this.serializeCertificateRecord(updated));
      } catch (error) {
        failed += 1;
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

    return {
      message: `Proceso finalizado. Generados: ${generated}. Fallidos: ${failed}.`,
      sent: generated,
      enviados: generated,
      generated,
      generados: generated,
      failed,
      fallidos: failed,
      processed: records.length,
      procesados: records.length,
      retryErrors,
      generatedRecords,
      registrosGenerados: generatedRecords,
      failedRecords,
      registrosFallidos: failedRecords,
    };
  }

  lookupCertificateByDocument(documento: string) {
    return this.certificates.lookupByDocument(documento);
  }

  getCertificateDownload(recordId: string) {
    return this.certificates.getDownloadFile(recordId);
  }

  private async getOrCreateConfig() {
    const existing = await this.prisma.asistenciaConfig.findFirst();
    if (existing) return existing;

    return this.prisma.asistenciaConfig.create({
      data: { habilitado: false },
    });
  }

  private isValidRole(role?: string): role is "ponente" | "asistente" | "evaluador" {
    return role === "ponente" || role === "asistente" || role === "evaluador";
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
      institucion: normalizeToStore(dto.institucion) ?? "",
      ciudad: normalizeToStore(dto.ciudad) ?? "",
      semillero: normalizeToStore(dto.semillero) ?? "",
    };
  }

  private serializeCertificateRecord(record: {
    id: string;
    role: string;
    nombres: string;
    apellidos: string;
    documento: string;
    email: string;
    semillero?: string | null;
    certificateStatus: string;
    certificateError: string | null;
    certificateSentAt: Date | null;
    linkedRegistrationId: string | null;
  }) {
    return {
      id: record.id,
      role: record.role,
      nombres: record.nombres,
      apellidos: record.apellidos,
      fullName: `${record.nombres} ${record.apellidos}`.trim(),
      documento: record.documento,
      email: record.email,
      semillero: record.semillero,
      certificateStatus: record.certificateStatus,
      certificateError: record.certificateError,
      certificateSentAt: record.certificateSentAt,
      linkedRegistrationId: record.linkedRegistrationId,
    };
  }
}
