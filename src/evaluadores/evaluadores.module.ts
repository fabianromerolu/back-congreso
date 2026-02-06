import { Module } from "@nestjs/common";
import { EvaluadoresController } from "./evaluadores.controller";
import { EvaluadoresService } from "./evaluadores.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [EvaluadoresController],
  providers: [EvaluadoresService],
  exports: [EvaluadoresService],
})
export class EvaluadoresModule {}
