import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length } from "class-validator";

const DOC_TYPES = ["CC", "TI", "CE", "PAS"] as const;
const EJES = ["1", "2", "3", "4", "5", "6"] as const;

export class CreatePonenteDto {
  // Ponente 1
  @ApiProperty() @IsString() @IsNotEmpty()
  nombres!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  apellidos!: string;

  @ApiProperty({ enum: DOC_TYPES }) @IsIn(DOC_TYPES as unknown as string[])
  tipoDocumento!: string;

  @ApiProperty() @IsString() @Length(3, 40)
  documento!: string;

  @ApiProperty() @IsEmail()
  email!: string;

  @ApiProperty() @IsString() @Length(7, 30)
  telefono!: string;

  // Ponente 2 (opcional)
  @ApiProperty({ required: false }) @IsOptional() @IsString()
  nombres2?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString()
  apellidos2?: string;

  @ApiProperty({ required: false, enum: DOC_TYPES }) @IsOptional() @IsIn(DOC_TYPES as unknown as string[])
  tipoDocumento2?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(3, 40)
  documento2?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsEmail()
  email2?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(7, 30)
  telefono2?: string;

  // Comunes
  @ApiProperty() @IsString() @IsNotEmpty()
  pais!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  ciudad!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  institucion!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  universidad!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  programa!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  semestre!: string;

  // Nuevos opcionales
  @ApiProperty({ required: false }) @IsOptional() @IsString()
  grupoInvestigacion?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString()
  semillero?: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  tituloPonencia!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  resumen!: string;

  @ApiProperty({ enum: EJES }) @IsIn(EJES as unknown as string[])
  lineaTematica!: string;
}
