import { Body, Controller, Post, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { FileFieldsInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

import { CreatePonenteDto } from "../ponentes/dto/create-ponente.dto";
import { CreateEvaluadorDto } from "../evaluadores/dto/create-evaluador.dto";
import { CreateAsistenteDto } from "../asistentes/dto/create-asistente.dto";

import { PonentesService } from "../ponentes/ponentes.service";
import { EvaluadoresService } from "../evaluadores/evaluadores.service";
import { AsistentesService } from "../asistentes/asistentes.service";
import type { Express } from "express";

@ApiTags("inscripciones")
@Controller("inscripciones")
export class InscripcionesController {
  constructor(
    private readonly ponentes: PonentesService,
    private readonly evaluadores: EvaluadoresService,
    private readonly asistentes: AsistentesService,
  ) {}

  @Post("asistente")
  async asistente(@Body() dto: CreateAsistenteDto) {
    await this.asistentes.create(dto);
    return { ok: true };
  }

  @Post("ponente")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "archivoPonenciaPdf", maxCount: 1 },
        { name: "cesionDerechosPdf", maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } },
    ),
  )
  async ponente(
    @Body() dto: CreatePonenteDto,
    @UploadedFiles()
    files: { archivoPonenciaPdf?: Express.Multer.File[]; cesionDerechosPdf?: Express.Multer.File[] },
  ) {
    await this.ponentes.create(dto, files);
    return { ok: true };
  }

  @Post("evaluador")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("firmaDigitalPng", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async evaluador(@Body() dto: CreateEvaluadorDto, @UploadedFile() file?: Express.Multer.File) {
    await this.evaluadores.create(dto, file);
    return { ok: true };
  }
}
