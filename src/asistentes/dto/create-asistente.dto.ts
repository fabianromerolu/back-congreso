import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length } from "class-validator";

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

  // opcionales
  @ApiProperty({ required: false }) @IsOptional() @IsString()
  universidad?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString()
  programa?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString()
  semestre?: string;
}
