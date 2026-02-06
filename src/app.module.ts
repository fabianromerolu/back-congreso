import { ConfigModule } from "@nestjs/config";
import { InscripcionesModule } from "./inscripciones/inscripciones.module";
import { PrismaModule } from "./prisma/prisma.module";
import { CloudinaryModule } from "./cloudinary/cloudinary.module";
import { PonentesModule } from "./ponentes/ponentes.module";
import { EvaluadoresModule } from "./evaluadores/evaluadores.module";
import { AsistentesModule } from "./asistentes/asistentes.module";
import { Module } from "@nestjs/common";
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CloudinaryModule,
    PonentesModule,
    EvaluadoresModule,
    AsistentesModule,
    InscripcionesModule,
  ],
})
export class AppModule {}
