import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAsistenteDto } from "./dto/create-asistente.dto";
import { sanitizeDeep } from "../common/utils/normalizer";

@Injectable()
export class AsistentesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAsistenteDto) {
    const cleanDto = sanitizeDeep(dto);
    return this.prisma.asistente.create({ data: cleanDto });
  }

  async list() {
    return this.prisma.asistente.findMany({
      orderBy: { createdAt: "desc" },
    });
  }
}