import { IsOptional, IsString } from "class-validator";

export class AsignarSalonManualDto {
  @IsOptional()
  @IsString()
  ponenteId?: string;

  @IsOptional()
  @IsString()
  ponenteDocumento?: string;

  @IsString()
  salonId!: string;
}