// src/asistencias/asistencias.module.ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AsistenciasController } from "./asistencias.controller";
import { AsistenciasService } from "./asistencias.service";

@Module({
  imports: [PrismaModule],
  controllers: [AsistenciasController],
  providers: [AsistenciasService],
  exports: [AsistenciasService],
})
export class AsistenciasModule {}
