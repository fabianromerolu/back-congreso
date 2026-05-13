// src/asistencias/asistencias.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AsistenciasController } from "./asistencias.controller";
import { AsistenciasService } from "./asistencias.service";
import { CertificatesService } from "./certificates.service";
import { CertificateEmailService } from "./certificate-email.service";

@Module({
  imports: [PrismaModule],
  controllers: [AsistenciasController],
  providers: [AsistenciasService, CertificatesService, CertificateEmailService],
  exports: [AsistenciasService],
})
export class AsistenciasModule {}
