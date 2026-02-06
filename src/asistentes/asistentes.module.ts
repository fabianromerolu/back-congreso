import { Module } from "@nestjs/common";
import { AsistentesController } from "./asistentes.controller";
import { AsistentesService } from "./asistentes.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [AsistentesController],
  providers: [AsistentesService],
  exports: [AsistentesService],
})
export class AsistentesModule {}
