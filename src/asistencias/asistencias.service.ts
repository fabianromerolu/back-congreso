// src/asistencias/asistencias.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAsistenciaDto } from "./dto/create-asistencia.dto";

@Injectable()
export class AsistenciasService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfigPublica() {
    const config = await this.getOrCreateConfig();
    return { enabled: config.habilitado };
  }

  async register(dto: CreateAsistenciaDto) {
    const config = await this.getOrCreateConfig();

    if (!config.habilitado) {
      throw new BadRequestException("El registro de asistencias no está habilitado.");
    }

    const existing = await this.prisma.asistenciaRegistro.findFirst({
      where: { documento: dto.documento, role: dto.role },
    });

    if (existing) {
      throw new BadRequestException("Ya existe un registro de asistencia para este documento y rol.");
    }

    return this.prisma.asistenciaRegistro.create({
      data: {
        role: dto.role,
        nombres: dto.nombres,
        apellidos: dto.apellidos,
        tipoDocumento: dto.tipoDocumento,
        documento: dto.documento,
        email: dto.email,
        telefono: dto.telefono,
        institucion: dto.institucion,
        ciudad: dto.ciudad,
        source: dto.source ?? "direct",
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

  async sendCertificates(pendingOnly: boolean) {
    const where = pendingOnly
      ? { certificateStatus: "pending" }
      : undefined;

    const records = await this.prisma.asistenciaRegistro.findMany({ where });

    if (!records.length) {
      return { message: "No hay registros pendientes.", sent: 0, enviados: 0, failed: 0, fallidos: 0 };
    }

    // Stub: marks all pending as sent without actual email dispatch.
    // Connect an email service here when available.
    await this.prisma.asistenciaRegistro.updateMany({
      where,
      data: {
        certificateStatus: "sent",
        certificateSentAt: new Date(),
        certificateError: null,
      },
    });

    return {
      message: `${records.length} certificado(s) marcados como enviados.`,
      sent: records.length,
      enviados: records.length,
      failed: 0,
      fallidos: 0,
    };
  }

  private async getOrCreateConfig() {
    const existing = await this.prisma.asistenciaConfig.findFirst();
    if (existing) return existing;

    return this.prisma.asistenciaConfig.create({
      data: { habilitado: false },
    });
  }
}
