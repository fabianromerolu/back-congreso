import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAsistenteDto } from "./dto/create-asistente.dto";

@Injectable()
export class AsistentesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAsistenteDto) {
    return this.prisma.asistente.create({ data: dto });
  }

  async list() {
    return this.prisma.asistente.findMany({ orderBy: { createdAt: "desc" } });
  }
}
