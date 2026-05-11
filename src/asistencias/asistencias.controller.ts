// src/asistencias/asistencias.controller.ts
import { Body, Controller, Get, Header, Param, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
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

  @Get("certificados/consulta")
  lookupCertificate(@Query("documento") documento: string) {
    return this.service.lookupCertificateByDocument(documento);
  }

  @Get("certificados/:id/descargar")
  @Header("Content-Type", "application/pdf")
  async downloadCertificate(@Param("id") id: string, @Res() res: Response) {
    const file = await this.service.getCertificateDownload(id);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename.replace(/"/g, "")}"`,
    );

    file.stream.pipe(res);
  }

  @Post(":role")
  register(@Param("role") role: string, @Body() dto: CreateAsistenciaDto) {
    dto.role = role;
    return this.service.register(dto);
  }
}
