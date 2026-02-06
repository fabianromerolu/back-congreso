import { IsEmail, IsIn, IsNotEmpty, IsString, Length } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

const DOC_TYPES = ["CC", "TI", "CE", "PAS"] as const;
const EJES = ["1", "2", "3", "4", "5", "6"] as const;

export class CreatePonenteDto {
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

  @ApiProperty() @IsString() @IsNotEmpty()
  institucion!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  universidad!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  programa!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  semestre!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  tituloPonencia!: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  resumen!: string;

  @ApiProperty({ enum: EJES }) @IsIn(EJES as unknown as string[])
  lineaTematica!: string;
}
