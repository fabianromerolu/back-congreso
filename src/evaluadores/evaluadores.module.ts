import { Module } from "@nestjs/common";
import { EvaluadoresController } from "./evaluadores.controller";
import { EvaluadoresService } from "./evaluadores.service";
import { PrismaModule } from "../prisma/prisma.module";
import { CloudinaryModule } from "../cloudinary/cloudinary.module";

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [EvaluadoresController],
  providers: [EvaluadoresService],
  exports: [EvaluadoresService],
})
export class EvaluadoresModule {}
