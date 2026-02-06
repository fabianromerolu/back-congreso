import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateVerificadoDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  verificado!: boolean;
}
