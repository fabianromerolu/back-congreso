import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateEvaluadorDto } from "./dto/create-evaluador.dto";

@Injectable()
export class EvaluadoresService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEvaluadorDto) {
    return this.prisma.evaluador.create({ data: dto });
  }

  async list() {
    return this.prisma.evaluador.findMany({
      orderBy: { createdAt: "desc" },
      include: { agenda: true },
    });
  }

  async setVerificado(id: string, verificado: boolean) {
    const exists = await this.prisma.evaluador.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Evaluador no encontrado.");

    return this.prisma.evaluador.update({
      where: { id },
      data: { verificado },
    });
  }

  async addAgenda(id: string, items: Array<{ fecha: string; inicio: string; fin: string }>) {
    const exists = await this.prisma.evaluador.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Evaluador no encontrado.");

    const created = await this.prisma.evaluadorAgenda.createMany({
      data: items.map((it) => ({
        evaluadorId: id,
        fecha: new Date(`${it.fecha}T00:00:00.000Z`),
        inicio: it.inicio,
        fin: it.fin,
      })),
    });

    await this.prisma.evaluador.update({
      where: { id },
      data: { agendado: true },
    });

    return { ok: true, created: created.count };
  }
}
