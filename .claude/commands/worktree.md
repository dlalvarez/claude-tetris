---
description: Crea un git worktree aislado en .trees/[nombre] y ejecuta ahí el requerimiento dado
argument-hint: <requerimiento a ejecutar en el worktree>
---

Requerimiento: $ARGUMENTS

Sigue estos pasos en orden:

1. Si `$ARGUMENTS` está vacío, pide al usuario el requerimiento y detente.
2. Determina un `[nombre]` corto para el worktree a partir del requerimiento: kebab-case, minúsculas, sin acentos ni espacios, máximo 3-4 palabras (ej. `pieza-tuerca`, `fix-pausa`). Si `.trees/[nombre]` ya existe, añade un sufijo para hacerlo único.
3. Crea el worktree desde la raíz del repositorio con exactamente:
   `git worktree add .trees/[nombre]`
4. Ejecuta TODO el requerimiento dentro de `.trees/[nombre]`:
   - Usa rutas absolutas dentro del worktree para leer y editar archivos.
   - Ejecuta los comandos de shell con `cd .trees/[nombre] && ...`.
   - No modifiques archivos del directorio principal ni de otros worktrees.
5. Respeta las instrucciones de `CLAUDE.md` (el README está en español; mantenlo así).
6. No hagas commit, push ni PR a menos que el requerimiento lo pida explícitamente.
7. Al terminar informa: nombre del worktree, ruta (`.trees/[nombre]`), rama creada y resumen de los cambios.
