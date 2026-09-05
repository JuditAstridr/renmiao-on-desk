# Renmi on Desk

Renmi es una mascota de escritorio y un espacio de concentración basado en Electron. Permanece en tu escritorio mientras programas o estudias, refleja mediante animaciones la actividad de los agentes de programación con IA compatibles y conecta las sesiones Pomodoro con la respuesta visual y sonora de Renmi.

Este repositorio desarrolla el producto Renmi sobre el runtime existente de Clawd on Desk. El nombre del producto, el tema predeterminado, el flujo de autenticación y las entradas visibles para el usuario siguen el modelo de Renmi.

**Idiomas:** [English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [한국어](README.ko-KR.md) · [日本語](README.ja-JP.md)

## Funciones

### Mascota de escritorio

- El tema predeterminado de Renmi incluye estados idle, thinking/working, notification, attention, sleeping y mini mode.
- Ventanas flotantes transparentes, seguimiento del cursor, posición mediante arrastre, mini mode en el borde y memoria de posición en varios monitores.
- Reacciones al clic, comportamiento de sueño/despertar, avisos sonoros y menú de la bandeja del sistema.
- La mascota puede ser controlada por una sesión de un agente de programación con IA o por una fase de concentración de Study Companion. Si hay una sesión de coding agent activa, su estado tiene prioridad visual.
- Settings → Theme permite cambiar entre temas integrados, personalizar cada tema e importar paquetes de animación Codex Pet compatibles. Los temas integrados actuales son Renmi, Clawd y Calico.

### Estado de los agentes de programación con IA

El repositorio incluye un runtime multiagente capaz de distinguir varias sesiones. Sus adaptadores cubren:

Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Antigravity CLI, Cursor Agent, CodeBuddy, WorkBuddy, Kiro CLI, Kimi Code CLI, Qwen Code, ZCode, CodeWhale, opencode, MiMo Code, Pi, OpenClaw, Hermes Agent, Qoder, QoderWork, QwenWork, Reasonix CLI y DeepSeek Harness.

Las capacidades varían según el agente: algunos solo informan del estado y otros también admiten globos de permisos locales, vistas de sesiones o enfoque del terminal. El estado de instalación, activación y las acciones disponibles se muestran en Settings → Agents. El perfil de Renmi no modifica silenciosamente los archivos de integración externos del equipo del usuario.

### Study Companion y Pomodoro

Abre `Open Study Dashboard` desde el menú contextual de la mascota o desde la bandeja del sistema para entrar en la ventana independiente de Study Companion:

- Lista de tareas con título, duración estimada, fecha límite, etiquetas/categorías y prioridad de cuatro cuadrantes.
- Subtareas con progreso de finalización y asociación a sesiones de concentración.
- Ordenación por fecha de creación, fecha límite, duración estimada o prioridad; agrupación por etiqueta o cuadrante.
- Temporizadores de cuenta atrás y cuenta ascendente, con opciones de concentración de 15, 25, 30 y 45 minutos y descansos cortos configurables.
- Las subtareas largas se pueden dividir en varios ciclos de concentración, con continuación automática o manual entre ciclos.
- El modo de concentración a pantalla completa oculta la lista de tareas y reduce las distracciones.
- Al completar un ciclo se activan el estado, la animación y el sonido de Renmi. Las tareas terminadas se marcan automáticamente y pasan al final de la lista.
- Las tareas, el estado de Pomodoro y los puntos se guardan en `study-data.json`, dentro del directorio de datos de usuario de Electron, separados del estado de las sesiones de coding agent.

### Cuenta y autenticación

Renmi utiliza un servicio de autenticación independiente. El lanzador de desarrollo inicia una API de autenticación local y pasa su dirección a Electron automáticamente. La interfaz actual está pensada para cuentas de correo verificadas `@ruc.edu.cn` y admite:

- Registro de cuenta con verificación por correo.
- Inicio de sesión con contraseña o código por correo.
- Restablecimiento de contraseña y verificación al cambiar el correo.
- Inicio de sesión de administrador y consola de administración.

Los datos locales de cuentas y auditoría se guardan por defecto en `~/.renmiao/auth-dev.json`. Los códigos de verificación se envían mediante Resend y nunca se muestran en el terminal. Guarda los secretos de autenticación en `cloud/.env` o en el gestor de secretos del entorno de despliegue; no los incluyas en el código del renderer ni en los recursos empaquetados del cliente.

## Desarrollo

### Requisitos

- Node.js `>= 22.12.0`
- npm
- Windows, macOS o Linux con soporte para Electron
- Una clave API de Resend y una dirección de remitente verificada para la verificación por correo

### Instalación y ejecución

```bash
npm install
cp cloud/.env.example cloud/.env
```

Para la autenticación local, configura como mínimo `RENMI_ADMIN_PASSWORD_HASH`, `RESEND_API_KEY` y una dirección verificada `AUTH_EMAIL_FROM` en `cloud/.env`. Genera el hash de la contraseña de administrador con:

```bash
npm run cloud:hash-password
```

Inicia la aplicación de escritorio con cualquiera de estos comandos:

```bash
npm start
# o
npm run dev
```

Ambos utilizan `scripts/renmiao-dev.js`. El lanzador elige un puerto disponible entre `8787–8791`, inicia la API de autenticación local, espera su comprobación de salud y después abre Electron con la URL de API seleccionada. Para iniciar solo la API de autenticación:

```bash
npm run cloud:dev
```

### Pruebas y compilación

```bash
npm test
npm run verify:electron
npm run audit:assets

npm run build
npm run build:mac
npm run build:linux
npm run build:win:x64
npm run build:win:arm64
npm run build:all
```

El empaquetado de producción requiere un endpoint HTTPS de autenticación desplegado, indicado mediante `RENMI_AUTH_API_URL`:

```bash
RENMI_AUTH_API_URL=https://auth.example.com npm run build:mac
```

Las credenciales de base de datos, las claves service-role de Supabase, las credenciales de administrador y los secretos del servicio de correo deben permanecer únicamente en el servidor de autenticación.

## Estructura del proyecto

| Directorio/archivo | Responsabilidad |
| --- | --- |
| `src/main.js` | Composición del proceso principal de Electron, ciclo de vida, IPC y conexión del runtime |
| `src/renderer.js` | Renderizado de la mascota, cambio de animaciones y seguimiento de los ojos |
| `src/pet-window-runtime.js` | Ventanas de visualización/entrada, posición e interacción de la mascota |
| `src/state.js`, `src/agent-runtime-main.js` | Máquina de estados de sesiones, combinación multi-sesión y actualizaciones |
| `src/study-runtime.js` | Lógica runtime de tareas, subtareas, Pomodoro y puntos |
| `src/study-window.js`, `src/study-dashboard.html` | Ventana e interfaz de Study Companion |
| `src/auth-runtime.js`, `src/auth-client.js`, `src/auth.html` | Ventana de autenticación, sesión y cliente API del lado de Electron |
| `cloud/api/` | API de autenticación local/nube, envío de correo y repositorios |
| `src/settings-*.js` | Interfaz de Settings, validación, persistencia y efectos de runtime |
| `agents/`, `hooks/` | Registro de agentes, monitores e instaladores de hooks/plugins |
| `themes/` | Temas integrados, recursos y configuración de temas |
| `test/` | Pruebas de Node.js y fixtures de runtime/contrato |

## Convenciones de desarrollo

- El proyecto utiliza CommonJS. Construye las rutas de recursos con `path.join(__dirname, ...)`.
- La persistencia de Settings sigue `prefs.js` → `settings-controller.js` → `settings-store.js`; los cambios deben pasar por controller/actions.
- Los datos de Study Companion y de las sesiones de agentes son contratos independientes. Si cambias uno, revisa sus consumidores de IPC, ventana y renderer.
- Las capacidades de los agentes tienen como fuente de verdad `agents/registry.js`; no dupliques la lista de agentes en otro módulo.
- Copia los recursos fuente a `assets/source/` antes de editarlos. No modifiques directamente recursos cuyo origen no esté claro.
- No hagas commit de `cloud/.env`, datos de autenticación ni datos locales de usuario de Electron.

## Documentación

- [Arquitectura del runtime de agentes](docs/project/agent-runtime-architecture.md)
- [Temas, estados y Settings](docs/project/theme-state-ui.md)
- [Guía para crear temas](docs/guides/guide-theme-creation.md)
- [Guía de agentes HTTP personalizados](docs/guides/custom-agent-http.md)
- [Guía del servicio de autenticación](cloud/README.md)

## Licencia

Este proyecto está disponible bajo la licencia [AGPL-3.0-only](LICENSE).
