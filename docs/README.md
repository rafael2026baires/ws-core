# twybox-ws-core
WebSocket core for Twybox

🟢 1. .env (estructura final)
ENV=local
#ENV=prod

PORT=3000

INGEST_URL_LOCAL=http://localhost/apps/geo-system/web/api/gps/ingest_position.php
INGEST_URL_PROD=http://mi-dominio.com/apps/geo-system/web/api/gps/ingest_position.php


🟢 2. server.js (arriba de todo)
require('dotenv').config();


🟢 3. Definir URL según entorno

👉 Reemplazá el uso directo de process.env.INGEST_URL por:

const INGEST_URL = process.env.ENV === 'prod'
  ? process.env.INGEST_URL_PROD
  : process.env.INGEST_URL_LOCAL;


🟢 4. Usar la variable

👉 Donde tenés:

fetch(process.env.INGEST_URL, { ... })

👉 cambiá por:

fetch(INGEST_URL, { ... })
🟢 5. Uso en LOCAL

.env:

ENV=local
#ENV=prod
node server.js


🔵 6. Uso en VPS

.env:

#ENV=local
ENV=prod
node server.js


🔴 7. Regla

👉 Cada cambio en .env:

1. detener proceso actual:
   Ctrl + C

2. volver a ejecutar:
   node server.js

🧠 RESUMEN

👉 ws-core y simulator quedan iguales en lógica
👉 solo cambia .env
👉 nunca más tocás código