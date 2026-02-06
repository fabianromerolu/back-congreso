import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CreateEvaluadorDto } from "./dto/create-evaluador.dto";
import { EvaluadoresService } from "./evaluadores.service";
import { UpdateVerificadoDto } from "../common/dto/update-verificado.dto";
import { AgendaItemDto } from "../common/dto/agenda-item.dto";

@ApiTags("evaluadores")
@Controller("evaluadores")
export class EvaluadoresController {
  constructor(private readonly service: EvaluadoresService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateEvaluadorDto) {
    return this.service.create(dto);
  }

  @Patch(":id/verificado")
  setVerificado(@Param("id") id: string, @Body() body: UpdateVerificadoDto) {
    return this.service.setVerificado(id, body.verificado);
  }

  // acepta 1 o muchas franjas
  @Post(":id/agenda")
  addAgenda(
    @Param("id") id: string,
    @Body() body: AgendaItemDto | AgendaItemDto[],
  ) {
    const items = Array.isArray(body) ? body : [body];
    return this.service.addAgenda(id, items);
  }
}
