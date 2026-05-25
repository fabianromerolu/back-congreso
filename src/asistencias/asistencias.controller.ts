// src/asistencias/asistencias.controller.ts
import { Body, Controller, Get, InternalServerErrorException, Param, Post, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { CertificateAccess } from "./certificates.service";
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
  async downloadCertificate(@Param("id") id: string, @Res() res: Response) {
    return this.sendCertificatePdf(id, res, "attachment");
  }

  @Get("certificados/:id/ver")
  async previewCertificate(@Param("id") id: string, @Res() res: Response) {
    return this.sendCertificatePdf(id, res, "inline");
  }

  @Post(":role")
  register(@Param("role") role: string, @Body() dto: CreateAsistenciaDto) {
    dto.role = role;
    return this.service.register(dto);
  }

  private async sendCertificatePdf(
    id: string,
    res: Response,
    disposition: "attachment" | "inline",
  ) {
    let file = await this.service.getCertificateDownload(id);

    if (file.type === "remote") {
      const remoteBuffer = await this.fetchRemotePdf(file.url);

      if (remoteBuffer) {
        return this.endPdfResponse(res, file, disposition, remoteBuffer);
      }

      file = await this.service.regenerateCertificateForDownload(id);
    }

    if (file.type === "remote") {
      const remoteBuffer = await this.fetchRemotePdf(file.url);

      if (remoteBuffer) {
        return this.endPdfResponse(res, file, disposition, remoteBuffer);
      }

      throw new InternalServerErrorException(
        "No se pudo obtener ni regenerar el PDF del certificado.",
      );
    }

    this.setPdfHeaders(res, file.filename, disposition);
    file.stream.pipe(res);
  }

  private async fetchRemotePdf(url: string) {
    const remote = await fetch(url).catch(() => null);

    if (!remote?.ok) {
      return null;
    }

    return Buffer.from(await remote.arrayBuffer());
  }

  private endPdfResponse(
    res: Response,
    file: CertificateAccess,
    disposition: "attachment" | "inline",
    buffer: Buffer,
  ) {
    this.setPdfHeaders(res, file.filename, disposition);
    res.setHeader("Content-Length", String(buffer.length));
    res.end(buffer);
  }

  private setPdfHeaders(
    res: Response,
    filename: string,
    disposition: "attachment" | "inline",
  ) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${filename.replace(/"/g, "")}"`,
    );
  }
}
