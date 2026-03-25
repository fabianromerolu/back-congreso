//src/administracion/dto/asignar-salones-automatico.dto.ts
import { IsBoolean, IsOptional } from "class-validator";

export class AsignarSalonesAutomaticoDto {
  @IsOptional()
  @IsBoolean()
  agruparPorLineaTematica?: boolean;
}