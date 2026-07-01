import { readFile, mkdir, writeFile } from "node:fs/promises";

const sourceDir = new URL("../referencia/planner/", import.meta.url);
const outDir = new URL("../data/", import.meta.url);

const text = (path) => readFile(new URL(path, sourceDir), "utf8");
const clean = (value) => (value == null ? "" : String(value).trim());
const upper = (value) => clean(value).toUpperCase();

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function decodeCyears(value) {
  const raw = value?.strings?.string;
  return asArray(raw)
    .flatMap((item) => String(item).split(/\s+/))
    .filter((item) => /^C\d{4}$/.test(item));
}

function semestralityFlags(raw) {
  const value = clean(raw).toUpperCase();
  if (!value) return { first: null, second: null, raw: null };
  const first = /\bI\b/.test(value) || value.includes("I Y II") || value.includes("TODOS");
  const second = /\bII\b/.test(value) || value.includes("I Y II") || value.includes("TODOS");
  return { first, second, raw: clean(raw) };
}

function courseRef(raw) {
  if (!raw) return null;
  return {
    code: upper(raw.Sigla ?? raw.CodSigla),
    name: clean(raw.Nombre),
    credits: Number(raw.Creditos ?? 0),
    semestrality: semestralityFlags(raw.Semestralidad),
  };
}

function mergeCourse(catalog, raw, source = "curriculum") {
  const ref = courseRef(raw);
  if (!ref?.code) return;
  const existing = catalog[ref.code] ?? {
    code: ref.code,
    name: ref.name,
    credits: ref.credits,
    semestrality: ref.semestrality,
    requirements: [],
    minCredits: null,
    equivalents: [],
    blocks: [],
    sources: [],
  };

  if (!existing.name && ref.name) existing.name = ref.name;
  if (!existing.credits && ref.credits) existing.credits = ref.credits;
  if (existing.semestrality.first == null && ref.semestrality.first != null) {
    existing.semestrality = ref.semestrality;
  }
  if (!existing.sources.includes(source)) existing.sources.push(source);
  catalog[ref.code] = existing;
}

function requirementsFrom(raw) {
  return asArray(raw?.Cursos)
    .map((item) => ({
      code: upper(item.Sigla),
      name: clean(item.Nombre),
      type: clean(item.TipoRequisito).toLowerCase().includes("coreq")
        ? "coreq"
        : "req",
      credits: Number(item.Creditos ?? 0),
      semestrality: semestralityFlags(item.Semestralidad),
    }))
    .filter((item) => item.code);
}

function minCreditsFrom(raw) {
  const restrictions = asArray(raw?.Restricciones);
  const creditValues = restrictions
    .map((item) => Number(item.CreditoMin ?? item.Creditos ?? 0))
    .filter((item) => Number.isFinite(item) && item > 0);
  return creditValues.length ? Math.max(...creditValues) : null;
}

function equivalentsFrom(raw) {
  return asArray(raw?.Cursos)
    .map(courseRef)
    .filter((item) => item?.code);
}

function normalizePrograms(source) {
  const majors = source.getListadoMajor?.["{}"] ?? [];
  const minors = source.getListadoMinor?.["{}"] ?? [];
  const titles = source.getListadoTitulo?.["{}"] ?? [];

  return {
    majors: majors.map((item) => ({
      code: upper(item.CodMajor),
      name: clean(item.Nombre),
      version: clean(item.VersionMajor),
      cYears: decodeCyears(item.Curriculum),
    })),
    minors: minors.map((item) => ({
      code: upper(item.CodMinor),
      name: clean(item.Nombre),
      version: clean(item.VersionMinor),
      type: clean(item.TipoMinor),
      cYears: decodeCyears(item.Curriculum),
    })),
    titles: titles.map((item) => ({
      code: upper(item.CodTitulo),
      name: clean(item.Nombre),
      version: clean(item.VersionTitulo),
      type: clean(item.TipoTitulo),
      cYears: decodeCyears(item.Curriculum),
    })),
    cYears: [],
    majorMinors: {},
  };
}

function normalizeMajorMinorAssociations(source) {
  const associations = {};
  for (const [rawKey, rawMinors] of Object.entries(source.getMajorMinorAsociado ?? {})) {
    const major = upper(JSON.parse(rawKey).CodMajor);
    if (!major) continue;
    associations[major] = [
      ...new Set(
        asArray(rawMinors)
          .map((item) => upper(item.CodMinor))
          .filter(Boolean),
      ),
    ].sort();
  }
  return associations;
}

function curriculumKey(spec) {
  return [
    upper(spec.CodCurriculum),
    upper(spec.CodMajor || "M"),
    upper(spec.CodMinor || "N"),
    upper(spec.CodTitulo || "T"),
  ].join("-");
}

function normalizeCurricula(mallas, lists, catalog) {
  const curricula = {};
  const allLists = {};
  const groupByCode = new Map();

  for (const [rawKey, rawCourses] of Object.entries(lists)) {
    const parsed = JSON.parse(rawKey);
    const code = upper(parsed.CodLista);
    const courses = asArray(rawCourses)
      .map((item) => {
        mergeCourse(catalog, item, `list:${code}`);
        return courseRef(item);
      })
      .filter((item) => item?.code);
    allLists[code] = { code, courses };
  }

  for (const [rawKey, rawBlocks] of Object.entries(mallas)) {
    const spec = JSON.parse(rawKey);
    const key = curriculumKey(spec);
    const blocks = asArray(rawBlocks)
      .map((block, index) => {
        const code = upper(block.CodSigla);
        const listCode = upper(block.CodLista);
        const requirements = requirementsFrom(block.Requisitos);
        const equivalents = equivalentsFrom(block.Equivalencias);
        const minCredits = minCreditsFrom(block.Restricciones);

        mergeCourse(catalog, block, `curriculum:${key}`);
        for (const req of requirements) mergeCourse(catalog, req, "requirement");
        for (const eq of equivalents) mergeCourse(catalog, eq, "equivalence");

        if (code) {
          const record = catalog[code];
          for (const req of requirements) {
            if (!record.requirements.some((item) => item.code === req.code && item.type === req.type)) {
              record.requirements.push({ code: req.code, type: req.type, name: req.name });
            }
          }
          if (minCredits != null) record.minCredits = Math.max(record.minCredits ?? 0, minCredits);
          for (const eq of equivalents) {
            if (!record.equivalents.includes(eq.code)) record.equivalents.push(eq.code);
          }
          if (!record.blocks.includes(clean(block.BloqueAcademico))) {
            record.blocks.push(clean(block.BloqueAcademico));
          }
        }

        return {
          id: `${key}:${index + 1}`,
          name: clean(block.Nombre),
          code: code || null,
          listCode: listCode || null,
          credits: Number(block.Creditos ?? 0),
          suggestedSemester: Number(block.SemestreBloque ?? 1),
          order: Number(block.OrdenSemestre ?? index + 1),
          academicBlock: clean(block.BloqueAcademico),
          requirements,
          minCredits,
          equivalents: equivalents.map((item) => item.code),
        };
      })
      .sort((a, b) => a.suggestedSemester - b.suggestedSemester || a.order - b.order);

    const bySemester = [];
    for (const block of blocks) {
      const idx = Math.max(0, block.suggestedSemester - 1);
      bySemester[idx] ??= [];
      bySemester[idx].push(block.id);
    }

    curricula[key] = {
      key,
      spec: {
        cyear: upper(spec.CodCurriculum),
        major: upper(spec.CodMajor || ""),
        minor: upper(spec.CodMinor || ""),
        title: upper(spec.CodTitulo || ""),
      },
      label: `${upper(spec.CodCurriculum)} ${upper(spec.CodMajor || "")}`.trim(),
      blocks,
      bySemester,
    };

    const major = upper(spec.CodMajor || "");
    if (major) {
      const count = groupByCode.get(major) ?? 0;
      groupByCode.set(major, count + 1);
    }
  }

  return { curricula, lists: allLists };
}

function enrichProgramAvailability(programs, curricula, source) {
  const byKind = {
    majors: new Map(),
    minors: new Map(),
    titles: new Map(),
  };
  const allCyears = new Set();

  const add = (kind, code, cyear) => {
    if (!code || !cyear) return;
    byKind[kind].set(code, byKind[kind].get(code) ?? new Set());
    byKind[kind].get(code).add(cyear);
    allCyears.add(cyear);
  };

  for (const curriculum of Object.values(curricula)) {
    const { cyear, major, minor, title } = curriculum.spec;
    if (major && major !== "M") add("majors", major, cyear);
    if (minor && minor !== "N") add("minors", minor, cyear);
    if (title && title !== "T") add("titles", title, cyear);
  }

  for (const kind of ["majors", "minors", "titles"]) {
    programs[kind] = programs[kind]
      .map((program) => ({
        ...program,
        cYears: [...(byKind[kind].get(program.code) ?? new Set())].sort(),
      }))
      .filter((program) => program.cYears.length > 0);
  }

  programs.cYears = [...allCyears].sort();
  programs.majorMinors = normalizeMajorMinorAssociations(source);
}

function addEquivalenceSymmetry(catalog) {
  for (const course of Object.values(catalog)) {
    for (const equivalent of course.equivalents) {
      const target = catalog[equivalent];
      if (target && !target.equivalents.includes(course.code)) {
        target.equivalents.push(course.code);
      }
    }
  }
}

const [mallasRaw, versionedRaw] = await Promise.all([
  text("siding-mock-data/mallas.json"),
  text("siding-mock-data/listado-con-versiones.json"),
]);

const mallas = JSON.parse(mallasRaw);
const versioned = JSON.parse(versionedRaw);
const catalog = {};
const programs = normalizePrograms(versioned);
const { curricula, lists } = normalizeCurricula(mallas.getMallaSugerida, mallas.getListaPredefinida, catalog);
enrichProgramAvailability(programs, curricula, mallas);
addEquivalenceSymmetry(catalog);

await mkdir(outDir, { recursive: true });
await Promise.all([
  writeFile(new URL("programs.json", outDir), `${JSON.stringify(programs, null, 2)}\n`),
  writeFile(new URL("curricula.json", outDir), `${JSON.stringify(curricula, null, 2)}\n`),
  writeFile(new URL("course-catalog.json", outDir), `${JSON.stringify(catalog, null, 2)}\n`),
  writeFile(new URL("course-lists.json", outDir), `${JSON.stringify(lists, null, 2)}\n`),
]);

console.log(`Programs: ${programs.majors.length} majors, ${programs.minors.length} minors, ${programs.titles.length} titles`);
console.log(`Curricula: ${Object.keys(curricula).length}`);
console.log(`Courses: ${Object.keys(catalog).length}`);
console.log(`Lists: ${Object.keys(lists).length}`);
