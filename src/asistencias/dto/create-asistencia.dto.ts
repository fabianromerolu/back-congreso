import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";

export class CreateAsistenciaDto {
  @IsOptional()
  @IsIn(["ponente", "asistente", "evaluador"])
  role?: string;

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
  profesion?: string;

  @IsOptional()
  @IsString()
  posgrado?: string;

  @IsOptional()
  @IsString()
  universidadPosgrado?: string;

  @IsString()
  @IsNotEmpty()
  ciudad!: string;

  @IsOptional()
  @IsString()
  semillero?: string;

  @IsOptional()
  @IsString()
  tituloPonencia?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  ponenciaIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  ponenciasEvaluadas?: string[];

  @IsOptional()
  @IsIn(["qr", "direct"])
  source?: string;
}
