import { IsInt, Min } from "class-validator";

export class AsignacionAutomaticaDto {
  @IsInt()
  @Min(1)
  cantidadEvaluadoresPorPonente!: number;
}