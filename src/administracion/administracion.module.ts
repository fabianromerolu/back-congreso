import { Module } from "@nestjs/common";
import { AdministracionController } from "./administracion.controller";
import { AdministracionService } from "./administracion.service";
import { PrismaService } from "../prisma/prisma.service";
import { AsistenciasModule } from "../asistencias/asistencias.module";

@Module({
  imports: [AsistenciasModule],
  controllers: [AdministracionController],
  providers: [AdministracionService, PrismaService],
})
export class AdministracionModule {}