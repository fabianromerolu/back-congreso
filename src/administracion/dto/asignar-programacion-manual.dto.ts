import { IsOptional, IsString } from "class-validator";

export class AsignarProgramacionManualDto {
  @IsOptional()
  @IsString()
  ponenteId?: string;

  @IsOptional()
  @IsString()
  ponenteDocumento?: string;

  @IsString()
  salonId!: string;

  @IsString()
  fecha!: string; // YYYY-MM-DD

  @IsString()
  inicio!: string; // HH:mm

  @IsString()
  fin!: string; // HH:mm
}