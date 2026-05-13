//src/administracion/administracion.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdministracionService } from "./administracion.service";
import { AsistenciasService } from "../asistencias/asistencias.service";
import { ComplementarPonenteDto } from "./dto/complementar-ponente.dto";
import { AsignacionManualDto } from "./dto/asignacion-manual.dto";
import { AsignacionAutomaticaDto } from "./dto/asignacion-automatica.dto";
import { GuardarEvaluacionDto } from "./dto/guardar-evaluacion.dto";
import { CreateSalonDto } from "./dto/create-salon.dto";
import { UpdateSalonDto } from "./dto/update-salon.dto";
import { AsignarProgramacionAutomaticaDto } from "./dto/asignar-programacion-automatica.dto";
import { AsignarProgramacionManualDto } from "./dto/asignar-programacion-manual.dto";
import { CreateAsistenciaDto } from "../asistencias/dto/create-asistencia.dto";

@ApiTags("administracion")
@Controller("administracion")
export class AdministracionController {
  constructor(
    private readonly service: AdministracionService,
    private readonly asistenciasService: AsistenciasService,
  ) {}

  @Get("registros")
  getRegistros(@Query() query: Record<string, any>) {
    return this.service.getRegistros(query);
  }

  @Patch("ponentes/:id/complementar")
  complementarPonente(@Param("id") id: string, @Body() dto: ComplementarPonenteDto) {
    return this.service.complementarPonente(id, dto);
  }

  @Get("ponentes/:documento/evaluadores-disponibles")
  getEvaluadoresDisponibles(@Param("documento") documento: string) {
    return this.service.getEvaluadoresDisponiblesParaPonente(documento);
  }

  @Post("asignaciones/manual")
  asignacionManual(@Body() dto: AsignacionManualDto) {
    return this.service.asignarEvaluadoresManual(dto);
  }

  @Post("asignaciones/automaticas")
  asignacionAutomatica(@Body() dto: AsignacionAutomaticaDto) {
    return this.service.asignarEvaluadoresAutomatico(dto);
  }

  @Post("asignaciones/tardias")
  asignacionTardias() {
    return this.service.asignarEvaluadoresTardias();
  }

  @Get("evaluadores/:documento/ponentes-asignados")
  getPonenciasAsignadas(@Param("documento") documento: string) {
    return this.service.getPonenciasAsignadasAEvaluador(documento);
  }

  @Post("evaluaciones")
  guardarEvaluacion(@Body() dto: GuardarEvaluacionDto) {
    return this.service.guardarEvaluacion(dto);
  }

  @Get("ponentes/:documento/evaluaciones")
  getEvaluacionesDePonente(@Param("documento") documento: string) {
    return this.service.getEvaluacionesDePonente(documento);
  }

  @Post("salones")
  createSalon(@Body() dto: CreateSalonDto) {
    return this.service.createSalon(dto);
  }

  @Get("salones")
  listSalones() {
    return this.service.listSalones();
  }

  @Patch("salones/:id")
  updateSalon(@Param("id") id: string, @Body() dto: UpdateSalonDto) {
    return this.service.updateSalon(id, dto);
  }

  @Get("salones/:id")
  getSalonDetail(@Param("id") id: string) {
    return this.service.getSalonDetail(id);
  }

    @Post("programacion/manual")
  asignarProgramacionManual(@Body() dto: AsignarProgramacionManualDto) {
    return this.service.asignarProgramacionManual(dto);
  }

  @Post("programacion/automatica")
  asignarProgramacionAutomatica(@Body() dto: AsignarProgramacionAutomaticaDto) {
    return this.service.asignarProgramacionAutomatica(dto);
  }

  @Get("programacion")
  getProgramacion(@Query() query: Record<string, any>) {
    return this.service.getProgramacion(query);
  }

  @Get("asistencias")
  getAsistenciasSnapshot() {
    return this.asistenciasService.getAdminSnapshot();
  }

  @Patch("asistencias/configuracion")
  updateAsistenciasConfig(@Body() body: { enabled?: boolean; habilitado?: boolean }) {
    const enabled = body.enabled ?? body.habilitado ?? false;
    return this.asistenciasService.updateConfig(enabled);
  }

  @Post("asistencias")
  createAsistenciaManual(@Body() dto: CreateAsistenciaDto) {
    return this.asistenciasService.registerManual(dto);
  }

  @Post("asistencias/:role")
  createAsistenciaManualByRole(
    @Param("role") role: string,
    @Body() dto: CreateAsistenciaDto,
  ) {
    dto.role = role;
    return this.asistenciasService.registerManual(dto);
  }

  @Post("asistencias/certificados/enviar")
  sendCertificates(
    @Body()
    body: {
      pendingOnly?: boolean;
      retryErrors?: boolean;
      sendEmail?: boolean;
      sendEmails?: boolean;
      emailCertificates?: boolean;
    },
  ) {
    return this.asistenciasService.sendCertificates({
      pendingOnly: body.pendingOnly ?? true,
      retryErrors: body.retryErrors ?? true,
      sendEmail:
        body.sendEmail ?? body.sendEmails ?? body.emailCertificates ?? true,
    });
  }

  @Post("asistencias/certificados/generar")
  generateCertificates(
    @Body()
    body: {
      pendingOnly?: boolean;
      retryErrors?: boolean;
      sendEmail?: boolean;
      sendEmails?: boolean;
      emailCertificates?: boolean;
    },
  ) {
    return this.asistenciasService.sendCertificates({
      pendingOnly: body.pendingOnly ?? true,
      retryErrors: body.retryErrors ?? true,
      sendEmail:
        body.sendEmail ?? body.sendEmails ?? body.emailCertificates ?? true,
    });
  }

  @Delete("asistencias/certificados")
  clearGeneratedCertificates() {
    return this.asistenciasService.clearGeneratedCertificates();
  }

  @Delete("asistencias/certificados/:id")
  deleteGeneratedCertificate(@Param("id") id: string) {
    return this.asistenciasService.deleteGeneratedCertificate(id);
  }

  @Delete("asistencias/:id/certificado")
  deleteGeneratedCertificateAlias(@Param("id") id: string) {
    return this.asistenciasService.deleteGeneratedCertificate(id);
  }

  @Post("asistencias/certificados/:id/borrar")
  deleteGeneratedCertificatePost(@Param("id") id: string) {
    return this.asistenciasService.deleteGeneratedCertificate(id);
  }

  @Post("asistencias/:id/certificado/borrar")
  deleteGeneratedCertificatePostAlias(@Param("id") id: string) {
    return this.asistenciasService.deleteGeneratedCertificate(id);
  }

  @Post("asistencias/certificados/:id/regenerar")
  regenerateCertificate(
    @Param("id") id: string,
    @Body()
    body: {
      sendEmail?: boolean;
      sendEmails?: boolean;
      emailCertificates?: boolean;
    },
  ) {
    return this.asistenciasService.regenerateCertificate(id, {
      sendEmail:
        body.sendEmail ?? body.sendEmails ?? body.emailCertificates ?? true,
    });
  }

  @Post("asistencias/:id/certificado/regenerar")
  regenerateCertificateAlias(
    @Param("id") id: string,
    @Body()
    body: {
      sendEmail?: boolean;
      sendEmails?: boolean;
      emailCertificates?: boolean;
    },
  ) {
    return this.asistenciasService.regenerateCertificate(id, {
      sendEmail:
        body.sendEmail ?? body.sendEmails ?? body.emailCertificates ?? true,
    });
  }
}
