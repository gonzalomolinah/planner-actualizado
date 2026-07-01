const app = document.querySelector("#app");

const state = {
  data: null,
  planSummaries: [],
  plan: null,
  selectedSpec: null,
  selectedSemester: 0,
  search: "",
  tab: "add",
  selectedSlot: null,
  leftPanelOpen: true,
  rightPanelOpen: true,
  status: "Cargando",
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || response.statusText);
  }
  return response.json();
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const programName = (kind, code) => {
  if (!code) return "";
  const table = state.data.programs[kind] ?? [];
  return table.find((item) => item.code === code)?.name ?? "";
};

const cYearOptions = () => state.data.programs.cYears ?? [];

const programOptions = (kind, cyear, allowedCodes = null) =>
  (state.data.programs[kind] ?? [])
    .filter((program) => program.cYears?.includes(cyear))
    .filter((program) => !allowedCodes || allowedCodes.has(program.code))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));

const minorOptionsFor = (cyear, major) => {
  const associations = state.data.programs.majorMinors ?? {};
  const hasAssociation = Object.prototype.hasOwnProperty.call(associations, major);
  const allowedCodes = hasAssociation ? new Set(associations[major]) : null;
  return programOptions("minors", cyear, allowedCodes);
};

const defaultSpec = () => {
  const cyear = cYearOptions().includes("C2022") ? "C2022" : cYearOptions()[0];
  const majors = programOptions("majors", cyear);
  const major = majors.find((item) => item.code === "M245")?.code ?? majors[0]?.code ?? "";
  return { cyear, major, minor: "", title: "" };
};

const normalizeSpec = (spec = {}) => {
  let cyear = spec.cyear;
  if (!cYearOptions().includes(cyear)) cyear = defaultSpec().cyear;

  const majors = programOptions("majors", cyear);
  let major = spec.major;
  if (!majors.some((item) => item.code === major)) {
    major = majors.find((item) => item.code === "M245")?.code ?? majors[0]?.code ?? "";
  }

  const minors = minorOptionsFor(cyear, major);
  const minor = spec.minor && minors.some((item) => item.code === spec.minor) ? spec.minor : "";

  const titles = programOptions("titles", cyear);
  const title = spec.title && titles.some((item) => item.code === spec.title) ? spec.title : "";

  return { cyear, major, minor, title };
};

const curriculumKeyFromSpec = (specInput) => {
  const spec = normalizeSpec(specInput);
  return [spec.cyear, spec.major || "M", spec.minor || "N", spec.title || "T"].join("-");
};

const specFromCurriculumKey = (key) => {
  const [cyear, major, minor, title] = String(key ?? "").split("-");
  return {
    cyear,
    major: major && major !== "M" ? major : "",
    minor: minor && minor !== "N" ? minor : "",
    title: title && title !== "T" ? title : "",
  };
};

const planSpec = (plan = state.plan) => normalizeSpec(plan?.curriculum ?? specFromCurriculumKey(plan?.curriculumKey) ?? state.selectedSpec);

const specLabel = (specInput) => {
  const spec = normalizeSpec(specInput);
  const minor = spec.minor ? ` / ${spec.minor}` : "";
  const title = spec.title ? ` / ${spec.title}` : "";
  const name = programName("majors", spec.major);
  return `${spec.cyear} ${spec.major}${minor}${title}${name ? ` - ${name}` : ""}`;
};

const curriculumLabel = (curriculum) => specLabel(curriculum.spec);

const pieceKey = (kind, spec) => {
  if (kind === "major") return [spec.cyear, spec.major || "M", "N", "T"].join("-");
  if (kind === "minor") return [spec.cyear, "M", spec.minor || "N", "T"].join("-");
  return [spec.cyear, "M", "N", spec.title || "T"].join("-");
};

const blockSpecFromId = (id) => {
  const [key] = String(id ?? "").split(":");
  const [cyear, major, minor, title] = key.split("-");
  return { cyear, major, minor, title };
};

const blockKind = (block) => {
  if (!block) return "";
  const blockSpec = blockSpecFromId(block.id);
  if (blockSpec.title && blockSpec.title !== "T") return "Titulo";
  if (blockSpec.minor && blockSpec.minor !== "N") return "Minor";

  const normalized = normalizeText(block.academicBlock);
  const firstWord = normalized.split(/\s+/)[0] ?? "";
  if (["ciencias", "base", "matematicas", "fundamentos"].includes(firstWord)) return "PlanComun";
  if (firstWord === "formacion") return "FormacionGeneral";
  if (firstWord === "major") return "Major";
  if (normalized.includes("plan comun") || normalized.includes("ciencias basicas")) return "PlanComun";
  return "";
};

const shouldIncludeBlock = (block) => {
  const normalizedBlock = normalizeText(block.academicBlock);
  const normalizedName = normalizeText(block.name);
  if (
    Number(block.credits ?? 0) === 0 &&
    normalizedBlock.includes("requisitos adicionales") &&
    !normalizedName.includes("practica")
  ) {
    return false;
  }
  return true;
};

const composeCurriculum = (specInput) => {
  const spec = normalizeSpec(specInput);
  const key = curriculumKeyFromSpec(spec);
  const blocks = [];
  const bySemester = [];
  const missing = [];

  const addPart = (kind, enabled) => {
    if (!enabled) return;
    const part = state.data.curricula[pieceKey(kind, spec)];
    if (!part) {
      missing.push(kind);
      return;
    }
    const included = new Set();
    for (const block of part.blocks) {
      if (shouldIncludeBlock(block)) {
        blocks.push(block);
        included.add(block.id);
      }
    }
    part.bySemester.forEach((blockIds, index) => {
      const filtered = (blockIds ?? []).filter((blockId) => included.has(blockId));
      if (!filtered.length) return;
      bySemester[index] ??= [];
      bySemester[index].push(...filtered);
    });
  };

  addPart("major", spec.major);
  addPart("minor", spec.minor);
  addPart("title", spec.title);

  return {
    key,
    spec,
    label: specLabel(spec),
    blocks,
    bySemester,
    missing,
  };
};

const blockById = (curriculum, id) => curriculum?.blocks.find((block) => block.id === id) ?? null;

const blockClass = (kind) => {
  if (kind === "PlanComun") return "block-plan-comun";
  if (kind === "FormacionGeneral") return "block-formacion";
  if (kind === "Minor") return "block-minor";
  if (kind === "Titulo") return "block-title";
  if (kind === "Major") return "block-major";
  return "";
};

const itemName = (item) => {
  if (item.kind === "slot") return item.name || state.data.lists[item.code]?.name || item.code;
  return state.data.catalog[item.code]?.name || item.code;
};

const itemCredits = (item) => {
  if (item.kind === "slot") return Number(item.credits ?? 0);
  return Number(state.data.catalog[item.code]?.credits ?? 0);
};

const itemBlock = (item) => blockById(composeCurriculum(planSpec()), item.blockId);

const equivalentCodes = (code) => {
  const info = state.data.catalog[code];
  return new Set([code, ...(info?.equivalents ?? [])]);
};

const isKnownCourse = (code) => Boolean(state.data.catalog[code]);

const effectiveRequirements = (requirements = []) =>
  requirements.filter((req) => req.code && isKnownCourse(req.code));

const itemFromBlock = (block) => {
  if (block.code) return { kind: "course", code: block.code, blockId: block.id };
  return {
    kind: "slot",
    code: block.listCode,
    name: block.name,
    credits: block.credits,
    blockId: block.id,
  };
};

const superblockOrder = (kind) =>
  ({ PlanComun: 0, Major: 1, Minor: 2, Titulo: 3, FormacionGeneral: 4 })[kind] ?? 9;

const defaultStartSemester = (block) => {
  const kind = blockKind(block);
  if (kind === "Minor") return Math.max(5, Number(block.suggestedSemester || 1));
  return Math.max(1, Number(block.suggestedSemester || 1));
};

const findScheduledSemester = (scheduledCourses, code) => {
  let found = null;
  for (const possible of equivalentCodes(code)) {
    const sem = scheduledCourses.get(possible);
    if (sem != null && (found == null || sem < found)) found = sem;
  }
  return found;
};

const blockMinSemester = (block, scheduledCourses) => {
  let minSemester = defaultStartSemester(block);
  if (!block.code) return minSemester;

  const requirements = effectiveRequirements(block.requirements);
  for (const req of requirements) {
    const reqSemester = findScheduledSemester(scheduledCourses, req.code);
    if (reqSemester == null) return null;
    const reqSemesterOneBased = reqSemester + 1;
    minSemester = Math.max(minSemester, req.type === "coreq" ? reqSemesterOneBased : reqSemesterOneBased + 1);
  }
  return minSemester;
};

const semesterMatchesAvailability = (block, semIndex) => {
  if (!block.code) return true;
  const flags = state.data.catalog[block.code]?.semestrality ?? {};
  if (flags.first == null || flags.second == null) return true;
  const firstSemester = semIndex % 2 === 0;
  return firstSemester ? flags.first : flags.second;
};

const addScheduledCourse = (scheduledCourses, code, semIndex) => {
  for (const possible of equivalentCodes(code)) {
    if (!scheduledCourses.has(possible)) scheduledCourses.set(possible, semIndex);
  }
};

const addScheduledItem = (scheduledCourses, item, semIndex) => {
  if (item.kind === "course") {
    addScheduledCourse(scheduledCourses, item.code, semIndex);
    return;
  }
  for (const course of state.data.lists[item.code]?.courses ?? []) {
    addScheduledCourse(scheduledCourses, course.code, semIndex);
  }
};

const scheduledCreditsBefore = (semesterCredits, semIndex) =>
  semesterCredits.slice(0, semIndex).reduce((sum, credits) => sum + Number(credits ?? 0), 0);

const minCreditsSatisfied = (block, semesterCredits, semIndex) => {
  if (!block.code) return true;
  const minCredits = state.data.catalog[block.code]?.minCredits;
  return minCredits == null || scheduledCreditsBefore(semesterCredits, semIndex) >= minCredits;
};

const scheduleCurriculum = (curriculum) => {
  const semesters = [];
  const semesterCredits = [];
  const scheduledConcrete = new Map();
  const requirementCoverage = new Map();
  const remaining = [...curriculum.blocks].sort(
    (a, b) =>
      defaultStartSemester(a) - defaultStartSemester(b) ||
      superblockOrder(blockKind(a)) - superblockOrder(blockKind(b)) ||
      Number(a.order ?? 0) - Number(b.order ?? 0),
  );

  const placeBlock = (block, force = false) => {
    if (block.code && findScheduledSemester(scheduledConcrete, block.code) != null) return true;

    const minSemester = blockMinSemester(block, requirementCoverage);
    if (minSemester == null && !force) return false;

    const credits = Number(block.credits ?? 0);
    let semIndex = Math.max(0, (minSemester ?? defaultStartSemester(block)) - 1);
    while (true) {
      semesters[semIndex] ??= [];
      semesterCredits[semIndex] ??= 0;
      const fits = semesterCredits[semIndex] + credits <= 50;
      const available = semesterMatchesAvailability(block, semIndex);
      const hasCredits = minCreditsSatisfied(block, semesterCredits, semIndex);
      if ((fits && available && hasCredits) || force) break;
      semIndex += 1;
    }

    const item = itemFromBlock(block);
    semesters[semIndex].push(item);
    semesterCredits[semIndex] += credits;
    if (item.kind === "course") addScheduledCourse(scheduledConcrete, item.code, semIndex);
    addScheduledItem(requirementCoverage, item, semIndex);
    return true;
  };

  while (remaining.length) {
    let progress = false;
    for (let index = 0; index < remaining.length; index += 1) {
      if (placeBlock(remaining[index])) {
        remaining.splice(index, 1);
        index -= 1;
        progress = true;
      }
    }
    if (!progress) {
      placeBlock(remaining.shift(), true);
    }
  }

  return Array.from({ length: semesters.length }, (_, index) => semesters[index] ?? []).map((semester) =>
    semester.sort((a, b) => {
      const blockA = blockById(curriculum, a.blockId);
      const blockB = blockById(curriculum, b.blockId);
      return (
        superblockOrder(blockKind(blockA)) - superblockOrder(blockKind(blockB)) ||
        Number(blockA?.order ?? 0) - Number(blockB?.order ?? 0)
      );
    }),
  );
};

const createPlanFromSpec = (specInput) => {
  const spec = normalizeSpec(specInput);
  const curriculum = composeCurriculum(spec);
  const semesters = scheduleCurriculum(curriculum);
  return {
    version: "0.1.0",
    name: "Plan local",
    curriculum: spec,
    curriculumKey: curriculum.key,
    semesters,
  };
};

const createPlanFromCurriculum = (key) => createPlanFromSpec(specFromCurriculumKey(key));

const defaultCurriculumKey = () => curriculumKeyFromSpec(defaultSpec());

const refreshPlans = async () => {
  state.planSummaries = await api("/api/plans");
};

const diagnose = (kind, severity, message, location = null) => ({
  kind,
  severity,
  message,
  location,
});

const addDiagnostic = (bag, diag) => {
  bag.items.push(diag);
  if (diag.location?.type === "course") {
    const key = `${diag.location.semester}:${diag.location.index}`;
    bag.byCourse[key] ??= [];
    bag.byCourse[key].push(diag);
  }
  if (diag.location?.type === "semester") {
    bag.bySemester[diag.location.semester] ??= [];
    bag.bySemester[diag.location.semester].push(diag);
  }
};

const earliestFor = (passed, code) => {
  let best = null;
  for (const possible of equivalentCodes(code)) {
    const sem = passed.get(possible);
    if (sem != null && (best == null || sem < best)) best = sem;
  }
  return best;
};

const planHasConcrete = (semesters, code) => {
  const accepted = equivalentCodes(code);
  return semesters.some((semester) =>
    semester.some((item) => item.kind === "course" && accepted.has(item.code)),
  );
};

const planHasListCourse = (semesters, listCode) => {
  const list = state.data.lists[listCode]?.courses ?? [];
  const accepted = new Set(list.flatMap((course) => [...equivalentCodes(course.code)]));
  return semesters.some((semester) =>
    semester.some((item) => item.kind === "course" && accepted.has(item.code)),
  );
};

const validatePlan = (plan) => {
  const bag = {
    items: [],
    byCourse: {},
    bySemester: {},
    summary: {
      credits: 0,
      courses: 0,
      blocksDone: 0,
      blocksTotal: 0,
    },
  };
  const passed = new Map();
  const approvedCredits = [0];
  let creditAccumulator = 0;

  plan.semesters.forEach((semester, semIndex) => {
    const seenThisSemester = new Set();
    let semesterCredits = 0;
    semester.forEach((item, index) => {
      const credits = itemCredits(item);
      semesterCredits += credits;
      bag.summary.credits += credits;
      if (item.kind === "course") bag.summary.courses += 1;

      if (item.kind === "slot") {
        addDiagnostic(
          bag,
          diagnose("slot", "warning", `Selecciona un curso para ${item.name || item.code}.`, {
            type: "course",
            semester: semIndex,
            index,
          }),
        );
        for (const course of state.data.lists[item.code]?.courses ?? []) {
          for (const code of equivalentCodes(course.code)) {
            if (!passed.has(code)) passed.set(code, semIndex);
          }
        }
        return;
      }

      if (seenThisSemester.has(item.code)) {
        addDiagnostic(
          bag,
          diagnose("duplicate", "error", `${item.code} esta repetido en el semestre ${semIndex + 1}.`, {
            type: "course",
            semester: semIndex,
            index,
          }),
        );
      }
      seenThisSemester.add(item.code);

      for (const code of equivalentCodes(item.code)) {
        if (!passed.has(code)) passed.set(code, semIndex);
      }
    });

    if (semesterCredits > 65) {
      addDiagnostic(
        bag,
        diagnose("credits", "error", `Semestre ${semIndex + 1}: ${semesterCredits} creditos supera el maximo de 65.`, {
          type: "semester",
          semester: semIndex,
        }),
      );
    } else if (semesterCredits > 55) {
      addDiagnostic(
        bag,
        diagnose("credits", "warning", `Semestre ${semIndex + 1}: ${semesterCredits} creditos supera la carga recomendada de 55.`, {
          type: "semester",
          semester: semIndex,
        }),
      );
    }

    creditAccumulator += semesterCredits;
    approvedCredits[semIndex + 1] = creditAccumulator;
  });

  plan.semesters.forEach((semester, semIndex) => {
    semester.forEach((item, index) => {
      if (item.kind !== "course") return;
      const info = state.data.catalog[item.code];
      if (!info) {
        addDiagnostic(
          bag,
          diagnose("unknown", "error", `${item.code} no esta en el catalogo local.`, {
            type: "course",
            semester: semIndex,
            index,
          }),
        );
        return;
      }

      const flags = info.semestrality ?? {};
      const firstSemester = semIndex % 2 === 0;
      if (flags.first != null && flags.second != null) {
        const available = firstSemester ? flags.first : flags.second;
        if (!available) {
          addDiagnostic(
            bag,
            diagnose("semestrality", "warning", `${item.code} normalmente no se dicta en este semestre.`, {
              type: "course",
              semester: semIndex,
              index,
            }),
          );
        }
      }

      if (info.minCredits != null && approvedCredits[semIndex] < info.minCredits) {
        addDiagnostic(
          bag,
          diagnose("minCredits", "error", `${item.code} requiere ${info.minCredits} creditos aprobados antes.`, {
            type: "course",
            semester: semIndex,
            index,
          }),
        );
      }

      for (const req of effectiveRequirements(info.requirements)) {
        const reqSem = earliestFor(passed, req.code);
        const ok = req.type === "coreq" ? reqSem != null && reqSem <= semIndex : reqSem != null && reqSem < semIndex;
        if (!ok) {
          const suffix = req.type === "coreq" ? "como correquisito" : "como requisito previo";
          addDiagnostic(
            bag,
            diagnose("requirement", "error", `${item.code} necesita ${req.code} ${suffix}.`, {
              type: "course",
              semester: semIndex,
              index,
            }),
          );
        }
      }
    });
  });

  const curriculum = composeCurriculum(planSpec(plan));
  if (curriculum) {
    for (const missing of curriculum.missing) {
      addDiagnostic(
        bag,
        diagnose("curriculum", "warning", `No hay malla local para la pieza ${missing} seleccionada.`),
      );
    }
    bag.summary.blocksTotal = curriculum.blocks.length;
    for (const block of curriculum.blocks) {
      let done = false;
      if (block.code) {
        done = planHasConcrete(plan.semesters, block.code);
      } else if (block.listCode) {
        done =
          planHasListCourse(plan.semesters, block.listCode) ||
          plan.semesters.some((semester) =>
            semester.some((item) => item.kind === "slot" && item.blockId === block.id),
          );
      }
      if (done) {
        bag.summary.blocksDone += 1;
      } else {
        addDiagnostic(
          bag,
          diagnose("curriculum", "error", `Falta cubrir ${block.name || block.code || block.listCode}.`),
        );
      }
    }
  }

  return bag;
};

const activeDiagnostics = () => validatePlan(state.plan);

const renderPlanList = () => {
  if (!state.planSummaries.length) return `<p class="empty-state">Sin planes guardados.</p>`;
  return `<div class="plan-list">${state.planSummaries
    .map((plan) => {
      const active = state.plan?.id === plan.id ? " active" : "";
      const updated = plan.updatedAt ? new Date(plan.updatedAt).toLocaleDateString() : "";
      return `
        <div class="plan-row${active}" data-load-plan="${escapeHtml(plan.id)}">
          <div>
            <strong>${escapeHtml(plan.name)}</strong>
            <span>${escapeHtml(updated)}</span>
          </div>
          <button class="mini-button" data-delete-plan="${escapeHtml(plan.id)}" title="Eliminar">x</button>
        </div>
      `;
    })
    .join("")}</div>`;
};

const renderLeftPanel = () => `
  <aside class="panel panel-left ${state.leftPanelOpen ? "" : "collapsed"}">
    <div class="panel-head">
      <h2>${state.leftPanelOpen ? "Planes" : "P"}</h2>
      <button
        class="button icon panel-toggle"
        data-toggle-panel="left"
        title="${state.leftPanelOpen ? "Contraer planes" : "Desplegar planes"}"
      >${state.leftPanelOpen ? "&lt;" : "&gt;"}</button>
    </div>
    ${state.leftPanelOpen ? `<div class="panel-body">${renderPlanList()}</div>` : ""}
  </aside>
`;

const renderSummary = (validation) => {
  const errors = validation.items.filter((item) => item.severity === "error").length;
  const warnings = validation.items.filter((item) => item.severity === "warning").length;
  const progress = validation.summary.blocksTotal
    ? Math.round((validation.summary.blocksDone / validation.summary.blocksTotal) * 100)
    : 0;
  return `
    <div class="summary">
      <div class="metric"><span>Creditos</span><strong>${validation.summary.credits}</strong></div>
      <div class="metric"><span>Cursos</span><strong>${validation.summary.courses}</strong></div>
      <div class="metric"><span>Malla</span><strong>${progress}%</strong></div>
      <div class="metric"><span>Alertas</span><strong>${errors}/${warnings}</strong></div>
    </div>
  `;
};

const renderCourseCard = (item, semIndex, index, validation) => {
  const block = itemBlock(item);
  const diags = validation.byCourse[`${semIndex}:${index}`] ?? [];
  const hasError = diags.some((diag) => diag.severity === "error");
  const hasWarning = !hasError && diags.length > 0;
  const code = item.kind === "slot" ? item.code : item.code;
  const name = itemName(item);
  const credits = itemCredits(item);
  const kind = blockKind(block);
  const classes = ["course-card", blockClass(kind)];
  if (hasError) classes.push("has-error");
  if (hasWarning) classes.push("has-warning");
  const slotButton =
    item.kind === "slot"
      ? `<button class="mini-button" data-open-slot="${semIndex}:${index}">Elegir</button>`
      : "";
  const statusChip = hasError
    ? `<span class="chip error" title="${escapeHtml(diags[0]?.message ?? "Error")}">Error</span>`
    : hasWarning
      ? `<span class="chip warn" title="${escapeHtml(diags[0]?.message ?? "Aviso")}">Aviso</span>`
      : `<span class="chip ok">OK</span>`;

  return `
    <article class="${classes.join(" ")}" draggable="true" data-drag-course="${semIndex}:${index}" data-card-index="${index}">
      <div class="block-initial">${escapeHtml(shortBlock(kind))}</div>
      <div class="course-code">${escapeHtml(code)}</div>
      <div class="course-name">${escapeHtml(name)}</div>
      <div class="course-meta">${credits} cred.</div>
      <div class="card-actions">
        ${statusChip}
        ${slotButton}
        <button class="mini-button" data-remove-course="${semIndex}:${index}">x</button>
      </div>
    </article>
  `;
};

const shortBlock = (kind) => {
  if (kind === "PlanComun") return "PC";
  if (kind === "FormacionGeneral") return "FG";
  if (kind === "Minor") return "m";
  if (kind === "Titulo") return "T";
  if (kind === "Major") return "M";
  return "";
};

const renderBoard = (validation) => {
  const semesters = state.plan.semesters.length ? state.plan.semesters : [[]];
  return `
    <div class="board" id="board">
      ${semesters
        .map((semester, semIndex) => {
          const credits = semester.reduce((sum, item) => sum + itemCredits(item), 0);
          const semDiags = validation.bySemester[semIndex] ?? [];
          const selected = state.selectedSemester === semIndex ? " drop-target" : "";
          return `
            <section class="semester${selected}" data-drop-semester="${semIndex}">
              <header class="semester-head" data-select-semester="${semIndex}">
                <strong>Semestre ${semIndex + 1}</strong>
                <span>${credits} cr. ${semDiags.length ? ` / ${semDiags.length} alertas` : ""}</span>
              </header>
              <div class="semester-body" data-drop-body="${semIndex}">
                ${semester.map((item, index) => renderCourseCard(item, semIndex, index, validation)).join("")}
              </div>
              <footer class="semester-foot">
                <button class="button icon" data-select-semester="${semIndex}" title="Seleccionar">+</button>
              </footer>
            </section>
          `;
        })
        .join("")}
      ${[0, 1]
        .map((offset) => {
          const semIndex = semesters.length + offset;
          return `
            <section class="semester" data-drop-semester="${semIndex}">
              <header class="semester-head"><strong>Semestre ${semIndex + 1}</strong><span>0 cr.</span></header>
              <div class="semester-body" data-drop-body="${semIndex}"></div>
              <footer class="semester-foot">
                <button class="button icon" data-add-semester="${semIndex}" title="Agregar ramo">+</button>
              </footer>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
};

const searchResults = () => {
  const query = normalizeText(state.search).trim();
  if (query.length < 2) return [];
  const parts = query.split(/\s+/).filter(Boolean);
  return Object.values(state.data.catalog)
    .filter((course) => {
      const haystack = normalizeText(`${course.code} ${course.name}`);
      return parts.every((part) => haystack.includes(part));
    })
    .sort((a, b) => {
      const aCode = normalizeText(a.code).startsWith(query) ? 0 : 1;
      const bCode = normalizeText(b.code).startsWith(query) ? 0 : 1;
      return aCode - bCode || a.code.localeCompare(b.code);
    })
    .slice(0, 30);
};

const renderAddPanel = () => {
  const results = searchResults();
  return `
    <div class="panel-body">
      <input class="input compact" id="course-search" value="${escapeHtml(state.search)}" placeholder="Buscar ramo o sigla">
      <div class="search-results">
        ${
          results.length
            ? results
                .map(
                  (course) => `
                    <div class="result-row">
                      <div>
                        <strong>${escapeHtml(course.code)} ${escapeHtml(course.name)}</strong>
                        <span>${course.credits} cr. ${escapeHtml(course.semestrality.raw ?? "")}</span>
                      </div>
                      <button class="mini-button" data-add-course="${escapeHtml(course.code)}">Agregar</button>
                    </div>
                  `,
                )
                .join("")
            : `<p class="empty-state">Selecciona un semestre y busca una sigla.</p>`
        }
      </div>
    </div>
  `;
};

const renderDiagnosticsPanel = (validation) => {
  const diagnostics = [...validation.items].sort((a, b) => (a.severity === "error" ? -1 : 1) - (b.severity === "error" ? -1 : 1));
  return `
    <div class="panel-body">
      <div class="diagnostics">
        ${
          diagnostics.length
            ? diagnostics
                .map(
                  (diag) => `
                    <div class="diag-row ${diag.severity === "error" ? "error" : ""}">
                      <strong>${diag.severity === "error" ? "Error" : "Aviso"}</strong>
                      <span>${escapeHtml(diag.message)}</span>
                    </div>
                  `,
                )
                .join("")
            : `<div class="diag-row"><strong>Listo</strong><span>No hay errores ni avisos.</span></div>`
        }
      </div>
    </div>
  `;
};

const renderOptionsPanel = () => {
  const slot = state.selectedSlot;
  const item = slot ? state.plan.semesters[slot.semester]?.[slot.index] : null;
  const options = item?.kind === "slot" ? state.data.lists[item.code]?.courses ?? [] : [];
  return `
    <div class="panel-body">
      ${
        item
          ? `<div class="option-row"><strong>${escapeHtml(item.name || item.code)}</strong><span>${options.length} opciones</span></div>`
          : `<p class="empty-state">Selecciona una lista en el tablero.</p>`
      }
      <div class="options-list">
        ${
          options.length
            ? options
                .map(
                  (course) => `
                    <div class="result-row">
                      <div>
                        <strong>${escapeHtml(course.code)} ${escapeHtml(course.name)}</strong>
                        <span>${course.credits} cr. ${escapeHtml(course.semestrality.raw ?? "")}</span>
                      </div>
                      <button class="mini-button" data-use-option="${escapeHtml(course.code)}">Usar</button>
                    </div>
                  `,
                )
                .join("")
            : `<p class="empty-state">Sin opciones en el snapshot local.</p>`
        }
      </div>
    </div>
  `;
};

const renderRightPanel = (validation) => `
  <aside class="panel panel-right ${state.rightPanelOpen ? "" : "collapsed"}">
    <div class="panel-head">
      <h2>${state.rightPanelOpen ? "Menu" : "M"}</h2>
      <button
        class="button icon panel-toggle"
        data-toggle-panel="right"
        title="${state.rightPanelOpen ? "Contraer menu" : "Desplegar menu"}"
      >${state.rightPanelOpen ? "&gt;" : "&lt;"}</button>
    </div>
    ${state.rightPanelOpen
      ? `
        <div class="tabs">
          <button class="tab ${state.tab === "add" ? "active" : ""}" data-tab="add">Agregar</button>
          <button class="tab ${state.tab === "diagnostics" ? "active" : ""}" data-tab="diagnostics">Alertas</button>
        </div>
        ${
          state.tab === "add"
            ? renderAddPanel()
            : state.tab === "options"
              ? renderOptionsPanel()
              : renderDiagnosticsPanel(validation)
        }
      `
      : ""}
  </aside>
`;

const renderSelectOptions = (items, value, includeEmpty = false) => `
  ${includeEmpty ? `<option value="" ${value ? "" : "selected"}>Por seleccionar</option>` : ""}
  ${items
    .map(
      (item) => `
        <option value="${escapeHtml(item.value ?? item.code)}" ${(item.value ?? item.code) === value ? "selected" : ""}>
          ${escapeHtml(item.label ?? `${item.name} (${item.code})`)}
        </option>
      `,
    )
    .join("")}
`;

const renderCurriculumControls = () => {
  const spec = planSpec();
  const cYears = cYearOptions().map((cyear) => ({
    value: cyear,
    label: cyear === "C2020" ? "Admision 2020 y 2021 (C2020)" : `${cyear === "C2022" ? "Admision 2022 y posteriores" : cyear} (${cyear})`,
  }));
  const majors = programOptions("majors", spec.cyear);
  const minors = minorOptionsFor(spec.cyear, spec.major);
  const titles = programOptions("titles", spec.cyear);

  return `
    <div class="curriculum-strip">
      <label class="curriculum-field">
        <span>Admision</span>
        <select class="select" id="cyear-select">${renderSelectOptions(cYears, spec.cyear)}</select>
      </label>
      <label class="curriculum-field">
        <span>Major</span>
        <select class="select" id="major-select">${renderSelectOptions(majors, spec.major)}</select>
      </label>
      <label class="curriculum-field">
        <span>Minor</span>
        <select class="select" id="minor-select">${renderSelectOptions(minors, spec.minor, true)}</select>
      </label>
      <label class="curriculum-field">
        <span>Titulo</span>
        <select class="select" id="title-select">${renderSelectOptions(titles, spec.title, true)}</select>
      </label>
    </div>
  `;
};

const render = () => {
  if (!state.data || !state.plan) {
    app.innerHTML = `<main class="app-shell"><div class="topbar">Cargando...</div></main>`;
    return;
  }
  const validation = activeDiagnostics();
  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img src="/logo.png" alt="">
          <div class="brand-title">
            <strong>Planner Local</strong>
            <span>Archivo JSON</span>
          </div>
        </div>
        <div class="toolbar">
          <input class="input" id="plan-name" value="${escapeHtml(state.plan.name)}" placeholder="Nombre del plan">
          ${renderCurriculumControls()}
        </div>
        <div class="actions">
          <span class="status">${escapeHtml(state.status)}</span>
          <button class="button" data-new-plan>Nuevo</button>
          <button class="button primary" data-save-plan>Guardar</button>
        </div>
      </header>
      <section class="workspace ${state.leftPanelOpen ? "" : "left-collapsed"} ${state.rightPanelOpen ? "" : "right-collapsed"}">
        ${renderLeftPanel()}
        <section class="panel board-shell">
          ${renderSummary(validation)}
          ${renderBoard(validation)}
        </section>
        ${renderRightPanel(validation)}
      </section>
    </main>
  `;
};

const setStatus = (message) => {
  state.status = message;
};

const replacePlanForSpec = (specInput) => {
  const previous = state.plan ?? {};
  const next = createPlanFromSpec(specInput);
  state.plan = {
    ...previous,
    ...next,
    id: previous.id,
    createdAt: previous.createdAt,
    updatedAt: previous.updatedAt,
    name: previous.name ?? next.name,
  };
  state.selectedSpec = next.curriculum;
  state.selectedSemester = 0;
  state.selectedSlot = null;
  state.tab = "add";
};

const savePlan = async () => {
  setStatus("Guardando");
  render();
  const curriculum = planSpec();
  const payload = {
    name: state.plan.name,
    curriculum,
    curriculumKey: curriculumKeyFromSpec(curriculum),
    semesters: state.plan.semesters,
  };
  if (state.plan.id) {
    state.plan = await api(`/api/plans/${state.plan.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } else {
    state.plan = await api("/api/plans", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  await refreshPlans();
  setStatus("Guardado");
  render();
};

const loadPlan = async (id) => {
  setStatus("Cargando plan");
  render();
  state.plan = await api(`/api/plans/${id}`);
  state.plan.curriculum = planSpec(state.plan);
  state.plan.curriculumKey = curriculumKeyFromSpec(state.plan.curriculum);
  state.selectedSpec = state.plan.curriculum;
  state.selectedSemester = 0;
  state.selectedSlot = null;
  state.tab = "add";
  setStatus("Listo");
  render();
};

const deletePlan = async (id) => {
  await api(`/api/plans/${id}`, { method: "DELETE" });
  await refreshPlans();
  if (state.plan?.id === id) {
    state.plan = createPlanFromSpec(state.selectedSpec ?? defaultSpec());
  }
  setStatus("Eliminado");
  render();
};

const addCourseToSelectedSemester = (code) => {
  while (state.selectedSemester >= state.plan.semesters.length) state.plan.semesters.push([]);
  state.plan.semesters[state.selectedSemester].push({ kind: "course", code });
  setStatus(`${code} agregado`);
  render();
};

const removeCourse = (semIndex, index) => {
  state.plan.semesters[semIndex].splice(index, 1);
  while (state.plan.semesters.length > 1 && state.plan.semesters.at(-1).length === 0) {
    state.plan.semesters.pop();
  }
  state.selectedSlot = null;
  setStatus("Actualizado");
  render();
};

const moveCourse = (from, to) => {
  const toSemester = to.semester;
  const source = state.plan.semesters[from.semester];
  const item = source?.[from.index];
  if (!item) return;

  let targetIndex = to.index;
  const targetSemester = state.plan.semesters[toSemester] ?? [];
  if (targetIndex == null || targetIndex < 0) targetIndex = targetSemester.length;
  if (from.semester === toSemester && from.index < targetIndex) targetIndex -= 1;
  if (from.semester === toSemester && from.index === targetIndex) return;

  source.splice(from.index, 1);
  while (toSemester >= state.plan.semesters.length) state.plan.semesters.push([]);
  const destination = state.plan.semesters[toSemester];
  destination.splice(Math.min(targetIndex, destination.length), 0, item);
  while (state.plan.semesters.length > 1 && state.plan.semesters.at(-1).length === 0) {
    state.plan.semesters.pop();
  }
  state.selectedSemester = toSemester;
  setStatus("Movido");
  render();
};

const openSlot = (semIndex, index) => {
  state.selectedSlot = { semester: semIndex, index };
  state.tab = "options";
  state.rightPanelOpen = true;
  render();
};

const useOptionForSlot = (code) => {
  const slot = state.selectedSlot;
  if (!slot) return;
  const current = state.plan.semesters[slot.semester]?.[slot.index];
  if (!current) return;
  state.plan.semesters[slot.semester][slot.index] = {
    kind: "course",
    code,
    blockId: current.blockId,
  };
  state.tab = "add";
  state.selectedSlot = null;
  setStatus(`${code} seleccionado`);
  render();
};

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "plan-name") {
    state.plan.name = target.value;
    state.status = "Sin guardar";
  }
  if (target.id === "course-search") {
    state.search = target.value;
    render();
    const input = document.querySelector("#course-search");
    input?.focus();
    input?.setSelectionRange(state.search.length, state.search.length);
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  const specFields = {
    "cyear-select": "cyear",
    "major-select": "major",
    "minor-select": "minor",
    "title-select": "title",
  };
  const field = specFields[target.id];
  if (field) {
    replacePlanForSpec({ ...planSpec(), [field]: target.value });
    setStatus("Malla recalculada");
    render();
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("button, [data-load-plan], [data-select-semester]");
  if (!target) return;

  if (target.dataset.togglePanel === "left") {
    state.leftPanelOpen = !state.leftPanelOpen;
    render();
    return;
  }
  if (target.dataset.togglePanel === "right") {
    state.rightPanelOpen = !state.rightPanelOpen;
    render();
    return;
  }
  if (target.dataset.deletePlan) {
    event.stopPropagation();
    await deletePlan(target.dataset.deletePlan);
    return;
  }
  if (target.dataset.loadPlan) {
    await loadPlan(target.dataset.loadPlan);
    return;
  }
  if (target.dataset.newPlan != null) {
    state.plan = createPlanFromSpec(state.selectedSpec ?? defaultSpec());
    state.selectedSemester = 0;
    state.selectedSlot = null;
    setStatus("Nuevo plan");
    render();
    return;
  }
  if (target.dataset.savePlan != null) {
    await savePlan();
    return;
  }
  if (target.dataset.addSemester != null) {
    const semIndex = Number(target.dataset.addSemester);
    while (semIndex >= state.plan.semesters.length) state.plan.semesters.push([]);
    state.selectedSemester = semIndex;
    render();
    return;
  }
  if (target.dataset.selectSemester != null) {
    state.selectedSemester = Number(target.dataset.selectSemester);
    state.tab = "add";
    render();
    return;
  }
  if (target.dataset.addCourse) {
    addCourseToSelectedSemester(target.dataset.addCourse);
    return;
  }
  if (target.dataset.removeCourse) {
    const [semIndex, index] = target.dataset.removeCourse.split(":").map(Number);
    removeCourse(semIndex, index);
    return;
  }
  if (target.dataset.openSlot) {
    const [semIndex, index] = target.dataset.openSlot.split(":").map(Number);
    openSlot(semIndex, index);
    return;
  }
  if (target.dataset.useOption) {
    useOptionForSlot(target.dataset.useOption);
    return;
  }
  if (target.dataset.tab) {
    state.tab = target.dataset.tab;
    render();
  }
});

app.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-drag-course]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.dragCourse);
  event.dataTransfer.effectAllowed = "move";
});

app.addEventListener("dragover", (event) => {
  const drop = event.target.closest("[data-drop-semester]");
  if (!drop) return;
  event.preventDefault();
});

app.addEventListener("drop", (event) => {
  const drop = event.target.closest("[data-drop-semester]");
  if (!drop) return;
  event.preventDefault();
  const raw = event.dataTransfer.getData("text/plain");
  if (!raw) return;
  const [semester, index] = raw.split(":").map(Number);
  const toSemester = Number(drop.dataset.dropSemester);
  const targetCard = event.target.closest("[data-drag-course]");
  let targetIndex = state.plan.semesters[toSemester]?.length ?? 0;
  if (targetCard && targetCard.closest("[data-drop-semester]") === drop) {
    const rect = targetCard.getBoundingClientRect();
    const overLowerHalf = event.clientY > rect.top + rect.height / 2;
    targetIndex = Number(targetCard.dataset.cardIndex) + (overLowerHalf ? 1 : 0);
  }
  moveCourse({ semester, index }, { semester: toSemester, index: targetIndex });
});

const init = async () => {
  state.data = await api("/api/data");
  state.selectedSpec = specFromCurriculumKey(defaultCurriculumKey());
  await refreshPlans();
  if (state.planSummaries[0]) {
    state.plan = await api(`/api/plans/${state.planSummaries[0].id}`);
    state.plan.curriculum = planSpec(state.plan);
    state.plan.curriculumKey = curriculumKeyFromSpec(state.plan.curriculum);
    state.selectedSpec = state.plan.curriculum;
  } else {
    state.plan = createPlanFromSpec(state.selectedSpec);
  }
  state.status = "Listo";
  render();
};

init().catch((error) => {
  console.error(error);
  app.innerHTML = `<main class="app-shell"><div class="topbar">Error: ${escapeHtml(error.message)}</div></main>`;
});
