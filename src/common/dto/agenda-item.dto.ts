import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";

export class AgendaItemDto {
  @ApiProperty({ example: "2026-05-14" })
  @IsString()
  @IsNotEmpty()
  fecha!: string; // YYYY-MM-DD

  @ApiProperty({ example: "14:00" })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "inicio debe ser HH:MM" })
  inicio!: string;

  @ApiProperty({ example: "18:00" })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "fin debe ser HH:MM" })
  fin!: string;
}
