// src/asistencias/asistencias.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AsistenciasController } from "./asistencias.controller";
import { AsistenciasService } from "./asistencias.service";
import { CertificatesService } from "./certificates.service";

@Module({
  imports: [PrismaModule],
  controllers: [AsistenciasController],
  providers: [AsistenciasService, CertificatesService],
  exports: [AsistenciasService],
})
export class AsistenciasModule {}
