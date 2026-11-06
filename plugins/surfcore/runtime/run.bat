@echo off
cd /d "%~dp0"
if defined DSH_HOME set "SURFCORE_EMBED_DISCOVERY=%DSH_HOME%\surfcore\embedding-service.json"
set "SURFCORE_EMBED_PORT=18765"
set "SURFCORE_EMBED_DEFAULT_MODEL=bge-m3"
node embedding-service.mjs > service.log 2>&1
