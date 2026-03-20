import { IsBoolean, IsOptional, IsString } from "class-validator";

export class AsignarProgramacionAutomaticaDto {
  @IsString()
  fecha!: string; // YYYY-MM-DD

  @IsString()
  horaInicioJornada!: string; // HH:mm

  @IsString()
  horaFinJornada!: string; // HH:mm

  @IsString()
  duracionMinutosPorPonencia!: string; // "20" o "30"

  @IsOptional()
  @IsBoolean()
  agruparPorLineaTematica?: boolean;
}