import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CreateEvaluadorDto } from "./dto/create-evaluador.dto";
import { EvaluadoresService } from "./evaluadores.service";

@ApiTags("evaluadores")
@Controller("evaluadores")
export class EvaluadoresController {
  constructor(private readonly service: EvaluadoresService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("firmaDigitalPng", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  create(@Body() dto: CreateEvaluadorDto, @UploadedFile() file?: Express.Multer.File) {
    return this.service.create(dto, file);
  }
}
