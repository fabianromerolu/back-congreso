import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, ValidateIf } from "class-validator";

const DOC_TYPES = ["CC", "TI", "CE", "PAS"] as const;
const ES_DOCENTE = ["si", "no"] as const;

export class CreateEvaluadorDto {
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

  @ApiProperty() @IsString() @IsNotEmpty()
  pais!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  ciudad!: string;

  // pregrado
  @ApiProperty({ description: "Universidad donde cursó el pregrado" })
  @IsString()
  @IsNotEmpty()
  universidad!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  profesion!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  posgrado!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  universidadPosgrado!: string;

  @ApiProperty({ enum: ES_DOCENTE }) @IsIn(ES_DOCENTE as unknown as string[])
  esDocente!: string;

  // Solo si es docente
  @ApiProperty({ required: false })
  @ValidateIf((o) => o.esDocente === "si")
  @IsString()
  @IsNotEmpty()
  programaDocencia?: string;

  @ApiProperty({ required: false, description: "Universidad donde trabaja como docente" })
  @ValidateIf((o) => o.esDocente === "si")
  @IsString()
  @IsNotEmpty()
  universidadDocencia?: string;
}
