import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CreateAsistenteDto } from "./dto/create-asistente.dto";
import { AsistentesService } from "./asistentes.service";

@ApiTags("asistentes")
@Controller("asistentes")
export class AsistentesController {
  constructor(private readonly service: AsistentesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateAsistenteDto) {
    return this.service.create(dto);
  }
}
