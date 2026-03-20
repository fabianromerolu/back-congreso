import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateSalonDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacidadPonente?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}