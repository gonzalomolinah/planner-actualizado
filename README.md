# planner-actualizado

Planner local simple construido a partir de los datos en `referencia/`.

## Uso local

```sh
npm run dev
```

Luego abre:

```txt
http://localhost:5177
```

No requiere instalar dependencias. Usa solo Node.js.

## Datos

Los datos normalizados viven en `data/`:

- `course-catalog.json`: catalogo local de cursos.
- `course-lists.json`: listas/equivalencias de malla.
- `curricula.json`: mallas sugeridas normalizadas.
- `programs.json`: majors, minors y titulos.
- `plans.json`: planificaciones guardadas localmente.

Para regenerar los snapshots desde `referencia/planner/siding-mock-data/`:

```sh
npm run build:data
```
