import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsNotEmpty, IsString, Length } from "class-validator";

const DOC_TYPES = ["CC", "TI", "CE", "PAS"] as const;

export class CreateAsistenteDto {
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
}
