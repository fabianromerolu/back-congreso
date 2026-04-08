// src/asistencias/asistencias.controller.ts
import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AsistenciasService } from "./asistencias.service";
import { CreateAsistenciaDto } from "./dto/create-asistencia.dto";

@ApiTags("asistencias")
@Controller("asistencias")
export class AsistenciasController {
  constructor(private readonly service: AsistenciasService) {}

  @Get("configuracion-publica")
  getConfigPublica() {
    return this.service.getConfigPublica();
  }

  @Post(":role")
  register(@Param("role") role: string, @Body() dto: CreateAsistenciaDto) {
    dto.role = role;
    return this.service.register(dto);
  }
}
