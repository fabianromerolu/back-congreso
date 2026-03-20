import { IsEmail, IsOptional, IsString } from "class-validator";

export class ComplementarPonenteDto {
  @IsOptional()
  @IsString()
  nombres2?: string;

  @IsOptional()
  @IsString()
  apellidos2?: string;

  @IsOptional()
  @IsString()
  tipoDocumento2?: string;

  @IsOptional()
  @IsString()
  documento2?: string;

  @IsOptional()
  @IsEmail()
  email2?: string;

  @IsOptional()
  @IsString()
  telefono2?: string;

  @IsOptional()
  @IsString()
  universidad?: string;

  @IsOptional()
  @IsString()
  programa?: string;

  @IsOptional()
  @IsString()
  semestre?: string;

  @IsOptional()
  @IsString()
  grupoInvestigacion?: string;

  @IsOptional()
  @IsString()
  semillero?: string;
}