import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

export class GuardarEvaluacionDto {
  @IsOptional()
  @IsString()
  evaluadorId?: string;

  @IsOptional()
  @IsString()
  evaluadorDocumento?: string;

  @IsOptional()
  @IsString()
  ponenteId?: string;

  @IsOptional()
  @IsString()
  ponenteDocumento?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  puntaje?: number;

  @IsOptional()
  @IsString()
  concepto?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsString()
  decision?: string;

  @IsOptional()
  @IsIn(["BORRADOR", "ENVIADA"])
  estado?: "BORRADOR" | "ENVIADA";
}