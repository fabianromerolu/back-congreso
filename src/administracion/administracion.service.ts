import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { sanitizeDeep, areEquivalent, normalizeComparable } from "../common/utils/normalizer";
import { ComplementarPonenteDto } from "./dto/complementar-ponente.dto";
import { AsignacionManualDto } from "./dto/asignacion-manual.dto";
import { AsignacionAutomaticaDto } from "./dto/asignacion-automatica.dto";
import { GuardarEvaluacionDto } from "./dto/guardar-evaluacion.dto";
import { CreateSalonDto } from "./dto/create-salon.dto";
import { UpdateSalonDto } from "./dto/update-salon.dto";
import { AsignarProgramacionAutomaticaDto } from "./dto/asignar-programacion-automatica.dto";
import { AsignarProgramacionManualDto } from "./dto/asignar-programacion-manual.dto";

type QueryMap = Record<string, unknown>;

@Injectable()
export class AdministracionService {
  constructor(private readonly prisma: PrismaService) {}

  async getRegistros(query: QueryMap) {
    const coleccion = String(query.coleccion ?? "").toLowerCase();

  const [ponentes, evaluadores, asistentes, asignaciones, evaluaciones, salones, programaciones] =
    await Promise.all([
      this.prisma.ponente.findMany({
        include: {
          agenda: true,
          asignaciones: { include: { evaluador: true, evaluacion: true } },
          evaluaciones: true,
          programaciones: { include: { salon: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.evaluador.findMany({
        include: {
          agenda: true,
          asignaciones: { include: { ponente: true, evaluacion: true } },
          evaluaciones: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.asistente.findMany({
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.ponenteEvaluador.findMany({
        include: {
          ponente: true,
          evaluador: true,
          evaluacion: true,
        },
        orderBy: { assignedAt: "desc" },
      }),
      this.prisma.ponenciaEvaluacion.findMany({
        include: {
          ponente: true,
          evaluador: true,
          asignacion: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.salon.findMany({
        include: {
          programaciones: {
            include: { ponente: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.programacionPonencia.findMany({
        include: {
          ponente: true,
          salon: true,
        },
        orderBy: [{ fecha: "asc" }, { inicio: "asc" }],
      }),
    ]);

    const filters = this.cleanQueryFilters(query);

    const filtered = {
      ponentes: ponentes.filter((row) => this.matchesFilters(row, filters)),
      evaluadores: evaluadores.filter((row) => this.matchesFilters(row, filters)),
      asistentes: asistentes.filter((row) => this.matchesFilters(row, filters)),
      asignaciones: asignaciones.filter((row) => this.matchesFilters(row, filters)),
      evaluaciones: evaluaciones.filter((row) => this.matchesFilters(row, filters)),
      salones: salones.filter((row) => this.matchesFilters(row, filters)),
      programaciones: programaciones.filter((row) => this.matchesFilters(row, filters)),
    };

    if (coleccion) {
      if (!(coleccion in filtered)) {
        throw new BadRequestException("Colección no válida.");
      }

      return {
        coleccion,
        total: (filtered as any)[coleccion].length,
        data: (filtered as any)[coleccion],
      };
    }

    return {
      filtrosAplicados: filters,
      totales: {
        ponentes: filtered.ponentes.length,
        evaluadores: filtered.evaluadores.length,
        asistentes: filtered.asistentes.length,
        asignaciones: filtered.asignaciones.length,
        evaluaciones: filtered.evaluaciones.length,
        salones: filtered.salones.length,
        programaciones: filtered.programaciones.length,
      },
      ...filtered,
    };
  }

  async complementarPonente(id: string, dto: ComplementarPonenteDto) {
    const current = await this.prisma.ponente.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Ponente no encontrado.");

    const cleanDto = sanitizeDeep(dto);
    const data: Record<string, any> = {};

    for (const [key, incoming] of Object.entries(cleanDto)) {
      const currentValue = (current as any)[key];

      if (this.isBlank(currentValue) && !this.isBlank(incoming)) {
        data[key] = incoming;
      }
    }

    if (!Object.keys(data).length) {
      return {
        ok: true,
        updated: false,
        message: "No había campos vacíos para complementar.",
        data: current,
      };
    }

    const updated = await this.prisma.ponente.update({
      where: { id },
      data,
    });

    return {
      ok: true,
      updated: true,
      data: updated,
    };
  }

  async getEvaluadoresDisponiblesParaPonente(documentoPonente: string) {
    const ponente = await this.findPonenteByDocumento(documentoPonente);
    if (!ponente) throw new NotFoundException("Ponente no encontrado.");

    const evaluadores = await this.prisma.evaluador.findMany({
      include: {
        asignaciones: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const compatibles = evaluadores
      .filter((ev) => this.isEvaluadorCompatibleConPonente(ponente, ev))
      .map((ev) => ({
        ...ev,
        cargaActual: ev.asignaciones.filter((a) => a.activo).length,
      }))
      .sort((a, b) => a.cargaActual - b.cargaActual);

    return {
      ponente: {
        id: ponente.id,
        documento: ponente.documento,
        nombres: ponente.nombres,
        apellidos: ponente.apellidos,
        universidad: ponente.universidad,
        tituloPonencia: ponente.tituloPonencia,
      },
      totalCompatibles: compatibles.length,
      evaluadores: compatibles,
    };
  }

  async asignarEvaluadoresManual(dto: AsignacionManualDto) {
    const ponente = dto.ponenteId
      ? await this.prisma.ponente.findUnique({ where: { id: dto.ponenteId } })
      : await this.findPonenteByDocumento(dto.ponenteDocumento ?? "");

    if (!ponente) throw new NotFoundException("Ponente no encontrado.");

    const evaluadores = await this.resolveEvaluadores(dto.evaluadorIds, dto.evaluadorDocumentos);

    if (!evaluadores.length) {
      throw new BadRequestException("Debes enviar al menos un evaluador válido.");
    }

    const incompatibles = evaluadores.filter((ev) => !this.isEvaluadorCompatibleConPonente(ponente, ev));
    if (incompatibles.length) {
      throw new BadRequestException(
        `Hay evaluadores incompatibles por universidad: ${incompatibles
          .map((x) => `${x.nombres} ${x.apellidos}`)
          .join(", ")}`,
      );
    }

    const existentes = await this.prisma.ponenteEvaluador.findMany({
      where: {
        ponenteId: ponente.id,
        evaluadorId: { in: evaluadores.map((x) => x.id) },
      },
    });

    const existentesSet = new Set(existentes.map((x) => `${x.ponenteId}:${x.evaluadorId}`));

    const toCreate = evaluadores
      .filter((ev) => !existentesSet.has(`${ponente.id}:${ev.id}`))
      .map((ev) => ({
        ponenteId: ponente.id,
        evaluadorId: ev.id,
      }));

    if (toCreate.length) {
      await this.prisma.ponenteEvaluador.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    return {
      ok: true,
      ponente: {
        id: ponente.id,
        documento: ponente.documento,
        nombres: ponente.nombres,
        apellidos: ponente.apellidos,
      },
      asignados: toCreate.length,
      evaluadoresAsignados: evaluadores.map((ev) => ({
        id: ev.id,
        documento: ev.documento,
        nombres: ev.nombres,
        apellidos: ev.apellidos,
      })),
    };
  }

  async asignarEvaluadoresAutomatico(dto: AsignacionAutomaticaDto) {
    const cantidad = dto.cantidadEvaluadoresPorPonente;

    const [ponentes, evaluadores, asignacionesExistentes] = await Promise.all([
      this.prisma.ponente.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.evaluador.findMany({
        include: { asignaciones: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.ponenteEvaluador.findMany(),
    ]);

    if (!ponentes.length) {
      throw new BadRequestException("No hay ponentes registrados.");
    }

    if (!evaluadores.length) {
      throw new BadRequestException("No hay evaluadores registrados.");
    }

    const loadMap = new Map<string, number>();
    for (const ev of evaluadores) {
      loadMap.set(ev.id, ev.asignaciones.filter((a) => a.activo).length);
    }

    const existingPairs = new Set(asignacionesExistentes.map((a) => `${a.ponenteId}:${a.evaluadorId}`));
    const inserts: Array<{ ponenteId: string; evaluadorId: string }> = [];
    const resumen: any[] = [];

    for (const ponente of ponentes) {
      const already = asignacionesExistentes.filter((a) => a.ponenteId === ponente.id).length;
      const faltan = Math.max(cantidad - already, 0);

      if (faltan === 0) {
        resumen.push({
          ponenteId: ponente.id,
          documento: ponente.documento,
          tituloPonencia: ponente.tituloPonencia,
          asignados: 0,
          faltantes: 0,
          mensaje: "Ya tenía cupo completo.",
        });
        continue;
      }

      const candidatos = evaluadores
        .filter((ev) => this.isEvaluadorCompatibleConPonente(ponente, ev))
        .filter((ev) => !existingPairs.has(`${ponente.id}:${ev.id}`))
        .sort((a, b) => (loadMap.get(a.id) ?? 0) - (loadMap.get(b.id) ?? 0));

      const seleccionados = candidatos.slice(0, faltan);

      for (const ev of seleccionados) {
        inserts.push({ ponenteId: ponente.id, evaluadorId: ev.id });
        existingPairs.add(`${ponente.id}:${ev.id}`);
        loadMap.set(ev.id, (loadMap.get(ev.id) ?? 0) + 1);
      }

      resumen.push({
        ponenteId: ponente.id,
        documento: ponente.documento,
        tituloPonencia: ponente.tituloPonencia,
        asignados: seleccionados.length,
        faltantes: Math.max(faltan - seleccionados.length, 0),
        evaluadores: seleccionados.map((ev) => ({
          id: ev.id,
          documento: ev.documento,
          nombres: ev.nombres,
          apellidos: ev.apellidos,
        })),
      });
    }

    if (inserts.length) {
      await this.prisma.ponenteEvaluador.createMany({
        data: inserts,
        skipDuplicates: true,
      });
    }

    return {
      ok: true,
      cantidadEvaluadoresPorPonente: cantidad,
      totalAsignacionesCreadas: inserts.length,
      resumen,
    };
  }

  async getPonenciasAsignadasAEvaluador(documentoEvaluador: string) {
    const evaluador = await this.findEvaluadorByDocumento(documentoEvaluador);
    if (!evaluador) throw new NotFoundException("Evaluador no encontrado.");

    const asignaciones = await this.prisma.ponenteEvaluador.findMany({
      where: {
        evaluadorId: evaluador.id,
        activo: true,
      },
      include: {
        ponente: true,
        evaluacion: true,
      },
      orderBy: { assignedAt: "desc" },
    });

    return {
      evaluador: {
        id: evaluador.id,
        documento: evaluador.documento,
        nombres: evaluador.nombres,
        apellidos: evaluador.apellidos,
      },
      total: asignaciones.length,
      asignaciones,
    };
  }

  async guardarEvaluacion(dto: GuardarEvaluacionDto) {
    const ponente = dto.ponenteId
      ? await this.prisma.ponente.findUnique({ where: { id: dto.ponenteId } })
      : await this.findPonenteByDocumento(dto.ponenteDocumento ?? "");

    if (!ponente) throw new NotFoundException("Ponente no encontrado.");

    const evaluador = dto.evaluadorId
      ? await this.prisma.evaluador.findUnique({ where: { id: dto.evaluadorId } })
      : await this.findEvaluadorByDocumento(dto.evaluadorDocumento ?? "");

    if (!evaluador) throw new NotFoundException("Evaluador no encontrado.");

    const asignacion = await this.prisma.ponenteEvaluador.findFirst({
      where: {
        ponenteId: ponente.id,
        evaluadorId: evaluador.id,
        activo: true,
      },
    });

    if (!asignacion) {
      throw new BadRequestException("Ese evaluador no tiene asignada esa ponencia.");
    }

    const data = sanitizeDeep({
      puntaje: dto.puntaje,
      concepto: dto.concepto,
      observaciones: dto.observaciones,
      decision: dto.decision,
      estado: dto.estado ?? "BORRADOR",
    });

    const evaluacion = await this.prisma.ponenciaEvaluacion.upsert({
      where: { asignacionId: asignacion.id },
      create: {
        asignacionId: asignacion.id,
        ponenteId: ponente.id,
        evaluadorId: evaluador.id,
        puntaje: dto.puntaje,
        concepto: data.concepto,
        observaciones: data.observaciones,
        decision: data.decision,
        estado: data.estado ?? "BORRADOR",
      },
      update: {
        puntaje: dto.puntaje,
        concepto: data.concepto,
        observaciones: data.observaciones,
        decision: data.decision,
        estado: data.estado ?? "BORRADOR",
      },
      include: {
        ponente: true,
        evaluador: true,
        asignacion: true,
      },
    });

    return {
      ok: true,
      evaluacion,
    };
  }

  async getEvaluacionesDePonente(documentoPonente: string) {
    const ponente = await this.findPonenteByDocumento(documentoPonente);
    if (!ponente) throw new NotFoundException("Ponente no encontrado.");

    const evaluaciones = await this.prisma.ponenciaEvaluacion.findMany({
      where: { ponenteId: ponente.id },
      include: {
        evaluador: true,
        asignacion: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return {
      ponente: {
        id: ponente.id,
        documento: ponente.documento,
        nombres: ponente.nombres,
        apellidos: ponente.apellidos,
        tituloPonencia: ponente.tituloPonencia,
      },
      total: evaluaciones.length,
      evaluaciones,
    };
  }

  async createSalon(dto: CreateSalonDto) {
    const data = sanitizeDeep(dto);

    return this.prisma.salon.create({
      data: {
        nombre: data.nombre!,
        capacidadPonente: dto.capacidadPonente,
        activo: dto.activo ?? true,
      },
    });
  }

  async listSalones() {
    const salones = await this.prisma.salon.findMany({
      include: {
        programaciones: {
          include: { ponente: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return salones.map((salon) => ({
      ...salon,
      ocupados: salon.programaciones.length,
      disponibles: Math.max(salon.capacidadPonente - salon.programaciones.length, 0),
    }));
  }

  async updateSalon(id: string, dto: UpdateSalonDto) {
    const salon = await this.prisma.salon.findUnique({
      where: { id },
      include: { programaciones: true },
    });

    if (!salon) throw new NotFoundException("Salón no encontrado.");

    if (
      dto.capacidadPonente !== undefined &&
      dto.capacidadPonente < salon.programaciones.length
    ) {
      throw new BadRequestException(
        `La nueva capacidad no puede ser menor que los ${salon.programaciones.length} ponentes ya asignados.`,
      );
    }

    const data = sanitizeDeep(dto);

    return this.prisma.salon.update({
      where: { id },
      data: {
        nombre: data.nombre,
        capacidadPonente: dto.capacidadPonente,
        activo: dto.activo,
      },
    });
  }

  async getSalonDetail(id: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id },
      include: {
        programaciones: {
          include: { ponente: true },
          orderBy: { assignedAt: "asc" },
        },
      },
    });

    if (!salon) throw new NotFoundException("Salón no encontrado.");

    return {
      ...salon,
      ocupados: salon.programaciones.length,
      disponibles: Math.max(salon.capacidadPonente - salon.programaciones.length, 0),
      lineasTematicas: [...new Set(salon.programaciones.map((x) => x.ponente.lineaTematica))],
    };
  }

  private cleanQueryFilters(query: QueryMap) {
    const reserved = new Set(["coleccion"]);
    return Object.fromEntries(
      Object.entries(query).filter(([key, value]) => !reserved.has(key) && value !== undefined && value !== ""),
    );
  }

  private matchesFilters(item: any, filters: QueryMap): boolean {
    return Object.entries(filters).every(([key, rawExpected]) => {
      const values = this.collectValuesByKey(item, key);
      if (!values.length) return false;

      return values.some((candidate) => this.compareValues(candidate, rawExpected));
    });
  }

  private collectValuesByKey(input: any, key: string, acc: any[] = []): any[] {
    if (input === null || input === undefined) return acc;

    if (Array.isArray(input)) {
      for (const item of input) {
        this.collectValuesByKey(item, key, acc);
      }
      return acc;
    }

    if (typeof input === "object") {
      for (const [k, value] of Object.entries(input)) {
        if (k === key) acc.push(value);
        this.collectValuesByKey(value, key, acc);
      }
    }

    return acc;
  }

  private compareValues(candidate: any, expected: any): boolean {
    if (candidate === null || candidate === undefined) return false;

    const raw = Array.isArray(expected) ? expected[0] : expected;
    const target = String(raw);

    if (typeof candidate === "boolean") {
      return String(candidate) === target.toLowerCase();
    }

    if (typeof candidate === "number") {
      return Number(target) === candidate;
    }

    if (candidate instanceof Date) {
      return candidate.toISOString().includes(target);
    }

    return normalizeComparable(String(candidate)).includes(normalizeComparable(target));
  }

  private async findPonenteByDocumento(documento: string) {
    const all = await this.prisma.ponente.findMany();
    return all.find((p) => areEquivalent(p.documento, documento)) ?? null;
  }

  private async findEvaluadorByDocumento(documento: string) {
    const all = await this.prisma.evaluador.findMany();
    return all.find((e) => areEquivalent(e.documento, documento)) ?? null;
  }

  private async resolveEvaluadores(ids?: string[], documentos?: string[]) {
    const byIds = ids?.length
      ? await this.prisma.evaluador.findMany({ where: { id: { in: ids } } })
      : [];

    const all = documentos?.length ? await this.prisma.evaluador.findMany() : [];
    const byDocs =
      documentos?.length
        ? all.filter((ev) => documentos.some((doc) => areEquivalent(ev.documento, doc)))
        : [];

    const map = new Map<string, any>();
    [...byIds, ...byDocs].forEach((ev) => map.set(ev.id, ev));

    return [...map.values()];
  }

  private getPonenteUniversitySet(ponente: any): Set<string> {
    const set = new Set<string>();

    if (ponente.universidad) {
      const n = normalizeComparable(ponente.universidad);
      if (n) set.add(n);
    }

    return set;
  }

  private getEvaluadorUniversitySet(evaluador: any): Set<string> {
    const set = new Set<string>();

    [evaluador.universidad, evaluador.universidadPosgrado, evaluador.universidadDocencia]
      .filter(Boolean)
      .forEach((value) => {
        const n = normalizeComparable(value);
        if (n) set.add(n);
      });

    return set;
  }

  private isEvaluadorCompatibleConPonente(ponente: any, evaluador: any): boolean {
    const ponenteUniversities = this.getPonenteUniversitySet(ponente);
    const evaluadorUniversities = this.getEvaluadorUniversitySet(evaluador);

    if (!ponenteUniversities.size) return true;

    for (const pUni of ponenteUniversities) {
      if (evaluadorUniversities.has(pUni)) {
        return false;
      }
    }

    return true;
  }

  private isBlank(value: any): boolean {
    return value === null || value === undefined || String(value).trim() === "";
  }

    async asignarProgramacionManual(dto: AsignarProgramacionManualDto) {
    const ponente = dto.ponenteId
      ? await this.prisma.ponente.findUnique({ where: { id: dto.ponenteId } })
      : await this.findPonenteByDocumento(dto.ponenteDocumento ?? "");

    if (!ponente) throw new NotFoundException("Ponente no encontrado.");

    const salon = await this.prisma.salon.findUnique({
      where: { id: dto.salonId },
    });

    if (!salon) throw new NotFoundException("Salón no encontrado.");
    if (!salon.activo) throw new BadRequestException("El salón está inactivo.");

    this.validateTimeRange(dto.inicio, dto.fin);
    const fecha = new Date(`${dto.fecha}T00:00:00.000Z`);

    const existente = await this.prisma.programacionPonencia.findUnique({
      where: { ponenteId: ponente.id },
      include: { salon: true },
    });

    if (existente) {
      throw new BadRequestException(
        `El ponente ya está programado en el salón ${existente.salon.nombre} de ${existente.inicio} a ${existente.fin}.`,
      );
    }

    const delSalonEseDia = await this.prisma.programacionPonencia.findMany({
      where: {
        salonId: salon.id,
        fecha,
      },
    });

    const cruzaSalon = delSalonEseDia.some((item) =>
      this.timeRangesOverlap(dto.inicio, dto.fin, item.inicio, item.fin),
    );

    if (cruzaSalon) {
      throw new BadRequestException("Ese salón ya tiene una ponencia en ese rango horario.");
    }

    const totalEseDiaEnSalon = delSalonEseDia.length;
    if (totalEseDiaEnSalon >= salon.capacidadPonente) {
      throw new BadRequestException("Ese salón ya alcanzó su capacidad de ponentes para la jornada.");
    }

    const creada = await this.prisma.programacionPonencia.create({
      data: {
        ponenteId: ponente.id,
        salonId: salon.id,
        fecha,
        inicio: dto.inicio,
        fin: dto.fin,
      },
      include: {
        ponente: true,
        salon: true,
      },
    });

    return { ok: true, data: creada };
  }

  async asignarProgramacionAutomatica(dto: AsignarProgramacionAutomaticaDto) {
    const agruparPorLineaTematica = dto.agruparPorLineaTematica ?? true;
    const fecha = new Date(`${dto.fecha}T00:00:00.000Z`);
    const duracion = Number(dto.duracionMinutosPorPonencia);

    if (!Number.isFinite(duracion) || duracion <= 0) {
      throw new BadRequestException("La duración por ponencia debe ser válida.");
    }

    this.validateTimeRange(dto.horaInicioJornada, dto.horaFinJornada);

    const [salones, ponentes, programadas] = await Promise.all([
      this.prisma.salon.findMany({
        where: { activo: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.ponente.findMany({
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.programacionPonencia.findMany({
        where: { fecha },
        include: {
          ponente: true,
          salon: true,
        },
      }),
    ]);

    if (!salones.length) {
      throw new BadRequestException("No hay salones activos.");
    }

    const yaProgramados = new Set(programadas.map((x) => x.ponenteId));
    const pendientes = ponentes.filter((p) => !yaProgramados.has(p.id));

    if (!pendientes.length) {
      return {
        ok: true,
        totalAsignacionesCreadas: 0,
        message: "Todos los ponentes ya están programados para esa fecha.",
      };
    }

    const slotsPorSalon = salones.map((salon) => ({
      salon,
      slots: this.buildSlots(dto.horaInicioJornada, dto.horaFinJornada, duracion),
    }));

    const usadosPorSalon = new Map<string, Array<{ inicio: string; fin: string }>>();
    const lineasPorSalon = new Map<string, Set<string>>();

    for (const salon of salones) {
      usadosPorSalon.set(
        salon.id,
        programadas
          .filter((x) => x.salonId === salon.id)
          .map((x) => ({ inicio: x.inicio, fin: x.fin })),
      );

      lineasPorSalon.set(
        salon.id,
        new Set(
          programadas
            .filter((x) => x.salonId === salon.id)
            .map((x) => normalizeComparable(x.ponente.lineaTematica)),
        ),
      );
    }

    const inserts: Array<{
      ponenteId: string;
      salonId: string;
      fecha: Date;
      inicio: string;
      fin: string;
    }> = [];

    const resumen: any[] = [];

    const ordenados = [...pendientes].sort((a, b) =>
      normalizeComparable(a.lineaTematica).localeCompare(normalizeComparable(b.lineaTematica)),
    );

    for (const ponente of ordenados) {
      const linea = normalizeComparable(ponente.lineaTematica);

      let candidatos = slotsPorSalon
        .map((item) => {
          const usados = usadosPorSalon.get(item.salon.id) ?? [];
          const libre = item.slots.find(
            (slot) => !usados.some((u) => this.timeRangesOverlap(slot.inicio, slot.fin, u.inicio, u.fin)),
          );

          if (!libre) return null;

          return {
            salon: item.salon,
            slot: libre,
            lineas: lineasPorSalon.get(item.salon.id) ?? new Set<string>(),
            usadosCount: usados.length,
          };
        })
        .filter(Boolean) as Array<{
        salon: any;
        slot: { inicio: string; fin: string };
        lineas: Set<string>;
        usadosCount: number;
      }>;

      if (agruparPorLineaTematica) {
        const mismos = candidatos.filter((c) => c.lineas.has(linea));
        if (mismos.length) candidatos = mismos;
      }

      candidatos.sort((a, b) => a.usadosCount - b.usadosCount);

      const elegido = candidatos[0];

      if (!elegido) {
        resumen.push({
          ponenteId: ponente.id,
          documento: ponente.documento,
          tituloPonencia: ponente.tituloPonencia,
          lineaTematica: ponente.lineaTematica,
          asignado: false,
          motivo: "No hay slot disponible.",
        });
        continue;
      }

      inserts.push({
        ponenteId: ponente.id,
        salonId: elegido.salon.id,
        fecha,
        inicio: elegido.slot.inicio,
        fin: elegido.slot.fin,
      });

      const usados = usadosPorSalon.get(elegido.salon.id) ?? [];
      usados.push({ inicio: elegido.slot.inicio, fin: elegido.slot.fin });
      usadosPorSalon.set(elegido.salon.id, usados);

      const lineas = lineasPorSalon.get(elegido.salon.id) ?? new Set<string>();
      lineas.add(linea);
      lineasPorSalon.set(elegido.salon.id, lineas);

      resumen.push({
        ponenteId: ponente.id,
        documento: ponente.documento,
        tituloPonencia: ponente.tituloPonencia,
        lineaTematica: ponente.lineaTematica,
        asignado: true,
        salonId: elegido.salon.id,
        salonNombre: elegido.salon.nombre,
        fecha: dto.fecha,
        inicio: elegido.slot.inicio,
        fin: elegido.slot.fin,
      });
    }

    if (inserts.length) {
      await this.prisma.programacionPonencia.createMany({
        data: inserts,
        skipDuplicates: true,
      });
    }

    return {
      ok: true,
      totalAsignacionesCreadas: inserts.length,
      totalPendientesSinProgramar: resumen.filter((x) => !x.asignado).length,
      resumen,
    };
  }

  async getProgramacion(query: Record<string, any>) {
    const where: any = {};

    if (query.fecha) {
      where.fecha = new Date(`${query.fecha}T00:00:00.000Z`);
    }

    if (query.salonId) {
      where.salonId = query.salonId;
    }

    const data = await this.prisma.programacionPonencia.findMany({
      where,
      include: {
        ponente: true,
        salon: true,
      },
      orderBy: [{ fecha: "asc" }, { inicio: "asc" }],
    });

    return data;
  }

  private validateTimeRange(inicio: string, fin: string) {
    const i = this.timeToMinutes(inicio);
    const f = this.timeToMinutes(fin);

    if (Number.isNaN(i) || Number.isNaN(f)) {
      throw new BadRequestException("Formato de hora inválido. Usa HH:mm.");
    }

    if (f <= i) {
      throw new BadRequestException("La hora fin debe ser mayor que la hora inicio.");
    }
  }

  private timeToMinutes(value: string): number {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  private minutesToTime(total: number): string {
    const hours = Math.floor(total / 60)
      .toString()
      .padStart(2, "0");
    const minutes = (total % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  private timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
    const a1 = this.timeToMinutes(aStart);
    const a2 = this.timeToMinutes(aEnd);
    const b1 = this.timeToMinutes(bStart);
    const b2 = this.timeToMinutes(bEnd);

    return a1 < b2 && b1 < a2;
  }

  private buildSlots(inicioJornada: string, finJornada: string, duracion: number) {
    const start = this.timeToMinutes(inicioJornada);
    const end = this.timeToMinutes(finJornada);

    const slots: Array<{ inicio: string; fin: string }> = [];
    let current = start;

    while (current + duracion <= end) {
      slots.push({
        inicio: this.minutesToTime(current),
        fin: this.minutesToTime(current + duracion),
      });
      current += duracion;
    }

    return slots;
  }
}