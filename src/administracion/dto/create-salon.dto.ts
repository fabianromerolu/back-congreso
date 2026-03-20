import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateSalonDto {
  @IsString()
  nombre!: string;

  @IsInt()
  @Min(1)
  capacidadPonente!: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}