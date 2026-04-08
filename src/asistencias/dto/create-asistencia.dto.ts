import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateAsistenciaDto {
  @IsIn(["ponente", "asistente", "evaluador"])
  role!: string;

  @IsString()
  @IsNotEmpty()
  nombres!: string;

  @IsString()
  @IsNotEmpty()
  apellidos!: string;

  @IsString()
  @IsNotEmpty()
  tipoDocumento!: string;

  @IsString()
  @IsNotEmpty()
  documento!: string;

  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  telefono!: string;

  @IsString()
  @IsNotEmpty()
  institucion!: string;

  @IsString()
  @IsNotEmpty()
  ciudad!: string;

  @IsOptional()
  @IsIn(["qr", "direct"])
  source?: string;
}
