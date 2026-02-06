import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CloudinaryService } from "../cloudinary/cloudinary.service";
import { CreatePonenteDto } from "./dto/create-ponente.dto";
import type { Express } from "express";

@Injectable()
export class PonentesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(
    dto: CreatePonenteDto,
    files: { archivoPonenciaPdf?: Express.Multer.File[]; cesionDerechosPdf?: Express.Multer.File[] },
  ) {
    const ponencia = files?.archivoPonenciaPdf?.[0];
    const cesion = files?.cesionDerechosPdf?.[0];

    if (!ponencia) throw new BadRequestException("Falta archivoPonenciaPdf (PDF).");
    if (!cesion) throw new BadRequestException("Falta cesionDerechosPdf (PDF).");

    const folder = "congreso/ponentes";
    const [upPonencia, upCesion] = await Promise.all([
      this.cloudinary.uploadPdf(ponencia.buffer, ponencia.originalname, folder),
      this.cloudinary.uploadPdf(cesion.buffer, cesion.originalname, folder),
    ]);

    return this.prisma.ponente.create({
      data: {
        ...dto,
        ponenciaPdfUrl: upPonencia.secure_url,
        cesionDerechosPdfUrl: upCesion.secure_url,
      },
    });
  }

  async list() {
    return this.prisma.ponente.findMany({ orderBy: { createdAt: "desc" } });
  }
}
