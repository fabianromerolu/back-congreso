import { ArrayMinSize, IsArray, IsOptional, IsString } from "class-validator";

export class AsignacionManualDto {
  @IsOptional()
  @IsString()
  ponenteId?: string;

  @IsOptional()
  @IsString()
  ponenteDocumento?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  evaluadorIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  evaluadorDocumentos?: string[];
}