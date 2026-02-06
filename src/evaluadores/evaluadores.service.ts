import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CloudinaryService } from "../cloudinary/cloudinary.service";
import { CreateEvaluadorDto } from "./dto/create-evaluador.dto";
import type { Express } from "express";

@Injectable()
export class EvaluadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(dto: CreateEvaluadorDto, firma?: Express.Multer.File) {
    if (!firma) throw new BadRequestException("Falta firmaDigitalPng (PNG).");

    const folder = "congreso/evaluadores";
    const upFirma = await this.cloudinary.uploadPng(
      firma.buffer,
      firma.originalname,
      folder,
    );

    return this.prisma.evaluador.create({
      data: {
        ...dto,
        firmaDigitalUrl: upFirma.secure_url,
      },
    });
  }

  async list() {
    return this.prisma.evaluador.findMany({ orderBy: { createdAt: "desc" } });
  }
}
