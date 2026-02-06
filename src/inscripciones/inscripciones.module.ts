import { Module } from "@nestjs/common";
import { InscripcionesController } from "./inscripciones.controller";
import { PonentesModule } from "../ponentes/ponentes.module";
import { EvaluadoresModule } from "../evaluadores/evaluadores.module";
import { AsistentesModule } from "../asistentes/asistentes.module";

@Module({
  imports: [PonentesModule, EvaluadoresModule, AsistentesModule],
  controllers: [InscripcionesController],
})
export class InscripcionesModule {}
