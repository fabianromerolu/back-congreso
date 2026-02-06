import { Module } from "@nestjs/common";
import { PonentesController } from "./ponentes.controller";
import { PonentesService } from "./ponentes.service";
import { PrismaModule } from "../prisma/prisma.module";
import { CloudinaryModule } from "../cloudinary/cloudinary.module";

@Module({
  imports: [PrismaModule, CloudinaryModule],
  controllers: [PonentesController],
  providers: [PonentesService],
  exports: [PonentesService],
})
export class PonentesModule {}
