---
name: clima-local
description: Obtiene el clima actual y el pronóstico de la ubicación local del usuario (o de una ciudad indicada). Úsala cuando el usuario pregunte por el clima, la temperatura, la lluvia o el pronóstico.
argument-hint: "[ciudad opcional]"
allowed-tools: Bash(curl *)
---

# Clima local

Consulta el clima con `wttr.in` (gratis, sin API key).

## Pasos

1. Determina la ubicación:
   - Si el usuario pasó una ciudad en `$ARGUMENTS`, úsala (reemplaza espacios por `+`).
   - Si no, déjala vacía: `wttr.in` detecta la ubicación aproximada por IP.
   - No envíes datos personales del usuario (nombre, correo, etc.) en la petición.

2. Ejecuta:

   ```bash
   curl -s --max-time 10 "https://wttr.in/<ciudad>?format=j1&lang=es"
   ```

   Con ubicación vacía queda `https://wttr.in/?format=j1&lang=es`.

3. Del JSON, extrae:
   - `nearest_area[0].areaName[0].value` y `country[0].value`: ubicación detectada.
   - `current_condition[0]`: `temp_C`, `FeelsLikeC`, `humidity`, `windspeedKmph`, `winddir16Point`, `precipMM`, `lang_es[0].value` (descripción).
   - `weather[0..2]`: `date`, `mintempC`, `maxtempC`, y `hourly[*].chanceofrain` (máximo del día).

4. Responde en español, breve:
   - Ubicación y condición actual.
   - Temperatura (sensación térmica), humedad, viento, lluvia.
   - Pronóstico de los próximos 3 días (mín/máx y probabilidad de lluvia).

## Errores

- Si `curl` falla o no devuelve JSON válido, dilo y sugiere indicar la ciudad manualmente.
- Si la ubicación detectada por IP parece incorrecta, pide al usuario la ciudad.
