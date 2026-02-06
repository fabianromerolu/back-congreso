import { Body, Controller, Get, Param, Patch, Post, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CreatePonenteDto } from "./dto/create-ponente.dto";
import { PonentesService } from "./ponentes.service";
import type { Express } from "express";
import { UpdateVerificadoDto } from "../common/dto/update-verificado.dto";
import { AgendaItemDto } from "../common/dto/agenda-item.dto";

@ApiTags("ponentes")
@Controller("ponentes")
export class PonentesController {
  constructor(private readonly service: PonentesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
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
  create(
    @Body() dto: CreatePonenteDto,
    @UploadedFiles()
    files: {
      archivoPonenciaPdf?: Express.Multer.File[];
      cesionDerechosPdf?: Express.Multer.File[];
    },
  ) {
    return this.service.create(dto, files);
  }

  @Patch(":id/verificado")
  setVerificado(@Param("id") id: string, @Body() body: UpdateVerificadoDto) {
    return this.service.setVerificado(id, body.verificado);
  }

  @Post(":id/agenda")
  addAgenda(
    @Param("id") id: string,
    @Body() body: AgendaItemDto | AgendaItemDto[],
  ) {
    const items = Array.isArray(body) ? body : [body];
    return this.service.addAgenda(id, items);
  }
}
