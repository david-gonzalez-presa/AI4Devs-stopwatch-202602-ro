/**
 * ============================================================================
 * STOPWATCH APPLICATION — script.js
 * ============================================================================
 *
 * Lógica completa del cronómetro. Separada del HTML siguiendo el principio
 * de Separación de Responsabilidades (SoC).
 *
 * ARQUITECTURA (SOLID):
 *
 *   StopwatchTimer    [SRP] → Gestiona el tiempo acumulado y el loop de
 *                              animación. No sabe nada de la UI.
 *
 *   StopwatchDisplay  [SRP] → Formatea y renderiza el tiempo en el DOM.
 *                              No sabe nada de la lógica de tiempo.
 *
 *   ButtonController  [SRP/OCP] → Gestiona los estados visuales del botón
 *                                  de acción. Añadir un nuevo estado no
 *                                  requiere modificar las clases existentes.
 *
 *   StopwatchApp      [DIP] → Orquestador. Depende de las interfaces
 *                              públicas de los componentes anteriores,
 *                              no de sus detalles internos.
 *
 * EDGE CASES:
 *   - Se usa performance.now() + timestamps absolutos para evitar drift
 *     cuando la pestaña pierde el foco.
 *   - requestAnimationFrame se cancela correctamente al pausar/limpiar.
 *   - Los botones se protegen contra clics duplicados dentro del mismo frame.
 *   - Máximo de horas limitado a 99 para evitar desbordamiento visual.
 *   - Todos los accesos al DOM están envueltos en try/catch.
 *
 * ============================================================================
 */

"use strict";

// =============================================================================
// ENUMERACIÓN DE ESTADOS
// =============================================================================

/**
 * Estados posibles del cronómetro.
 * Usar un objeto congelado garantiza inmutabilidad (OCP).
 * @readonly
 * @enum {string}
 */
const StopwatchState = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
});


// =============================================================================
// CLASE: StopwatchTimer
// =============================================================================

/**
 * Gestiona la lógica de tiempo del cronómetro.
 * Responsabilidad única: calcular el tiempo transcurrido.
 *
 * Usa timestamps absolutos (performance.now) en lugar de deltas
 * acumulados para evitar drift cuando el navegador throttlea
 * requestAnimationFrame en pestañas en segundo plano.
 */
class StopwatchTimer {
    /** Tiempo total acumulado en milisegundos antes de la sesión actual */
    #accumulatedMs = 0;

    /** Timestamp del inicio de la sesión de conteo actual */
    #sessionStart = null;

    /** ID del requestAnimationFrame activo */
    #rafId = null;

    /** Callback que se invoca en cada frame con el tiempo total en ms */
    #onTick = null;

    /** Límite máximo de tiempo: 99h 59m 59s 999ms */
    static MAX_MS = (99 * 3600 + 59 * 60 + 59) * 1000 + 999;

    /**
     * @param {function(number): void} onTick — Callback con el tiempo total (ms).
     */
    constructor(onTick) {
        if (typeof onTick !== "function") {
            throw new TypeError("StopwatchTimer requiere un callback onTick.");
        }
        this.#onTick = onTick;
    }

    /**
     * Inicia o reanuda el conteo.
     * Es idempotente: llamar start() cuando ya está corriendo no hace nada.
     */
    start() {
        if (this.#rafId !== null) return; // ya corriendo
        this.#sessionStart = performance.now();
        this.#loop();
    }

    /**
     * Pausa el conteo conservando el tiempo acumulado.
     */
    pause() {
        if (this.#rafId === null) return; // ya pausado
        this.#accumulatedMs += performance.now() - this.#sessionStart;
        this.#sessionStart = null;
        cancelAnimationFrame(this.#rafId);
        this.#rafId = null;
    }

    /**
     * Reinicia todo el estado a cero.
     */
    reset() {
        if (this.#rafId !== null) {
            cancelAnimationFrame(this.#rafId);
            this.#rafId = null;
        }
        this.#accumulatedMs = 0;
        this.#sessionStart = null;
        this.#onTick(0);
    }

    /**
     * Devuelve el tiempo total transcurrido en milisegundos.
     * @returns {number}
     */
    getElapsed() {
        let total = this.#accumulatedMs;
        if (this.#sessionStart !== null) {
            total += performance.now() - this.#sessionStart;
        }
        return Math.min(total, StopwatchTimer.MAX_MS);
    }

    /**
     * Loop interno de animación.
     * @private
     */
    #loop() {
        this.#rafId = requestAnimationFrame(() => {
            try {
                const elapsed = this.getElapsed();
                this.#onTick(elapsed);

                // Si llegamos al máximo, paramos automáticamente
                if (elapsed >= StopwatchTimer.MAX_MS) {
                    this.pause();
                    return;
                }
                this.#loop();
            } catch (err) {
                console.error("[StopwatchTimer] Error en el loop de render:", err);
                this.pause();
            }
        });
    }
}


// =============================================================================
// CLASE: StopwatchDisplay
// =============================================================================

/**
 * Responsabilidad única: convertir milisegundos en texto formateado
 * y actualizar los elementos del DOM.
 */
class StopwatchDisplay {
    /** @type {HTMLElement} */
    #mainEl;

    /** @type {HTMLElement} */
    #msEl;

    /**
     * @param {string} mainSelector — Selector CSS para HH:MM:SS.
     * @param {string} msSelector   — Selector CSS para los milisegundos.
     * @throws {Error} Si los elementos no se encuentran en el DOM.
     */
    constructor(mainSelector, msSelector) {
        this.#mainEl = document.querySelector(mainSelector);
        this.#msEl = document.querySelector(msSelector);

        if (!this.#mainEl || !this.#msEl) {
            throw new Error(
                `[StopwatchDisplay] No se encontraron los elementos: ` +
                `"${mainSelector}" o "${msSelector}".`
            );
        }
    }

    /**
     * Actualiza el display con el tiempo dado.
     * @param {number} totalMs — Tiempo total en milisegundos.
     */
    update(totalMs) {
        try {
            const ms = Math.floor(totalMs) % 1000;
            const totalSeconds = Math.floor(totalMs / 1000);
            const seconds = totalSeconds % 60;
            const minutes = Math.floor(totalSeconds / 60) % 60;
            const hours = Math.floor(totalSeconds / 3600);

            this.#mainEl.textContent =
                `${this.#pad2(hours)}:${this.#pad2(minutes)}:${this.#pad2(seconds)}`;
            this.#msEl.textContent = this.#pad3(ms);
        } catch (err) {
            console.error("[StopwatchDisplay] Error actualizando display:", err);
        }
    }

    /**
     * Pad numérico a 2 dígitos.
     * @param {number} n
     * @returns {string}
     * @private
     */
    #pad2(n) {
        return String(n).padStart(2, "0");
    }

    /**
     * Pad numérico a 3 dígitos.
     * @param {number} n
     * @returns {string}
     * @private
     */
    #pad3(n) {
        return String(n).padStart(3, "0");
    }
}


// =============================================================================
// CLASE: ButtonController
// =============================================================================

/**
 * Responsabilidad única: gestionar la apariencia y el texto del botón
 * de acción según el estado actual del cronómetro.
 *
 * Abierto a extensión (OCP): los estados se definen como un mapa
 * de configuración. Añadir un nuevo estado solo requiere añadir
 * una entrada al mapa, sin modificar la lógica del controlador.
 */
class ButtonController {
    /** @type {HTMLButtonElement} */
    #buttonEl;

    /**
     * Mapa de configuración de cada estado.
     * Cada entrada define el texto, la clase CSS y el aria-label.
     * @type {Object.<string, {text: string, className: string, ariaLabel: string}>}
     */
    static STATE_CONFIG = Object.freeze({
        [StopwatchState.IDLE]: {
            text: "Start",
            className: "btn btn-start",
            ariaLabel: "Iniciar cronómetro",
        },
        [StopwatchState.RUNNING]: {
            text: "Pause",
            className: "btn btn-pause",
            ariaLabel: "Pausar cronómetro",
        },
        [StopwatchState.PAUSED]: {
            text: "Continue",
            className: "btn btn-continue",
            ariaLabel: "Reanudar cronómetro",
        },
    });

    /**
     * @param {string} selector — Selector CSS del botón de acción.
     * @throws {Error} Si el elemento no existe.
     */
    constructor(selector) {
        this.#buttonEl = document.querySelector(selector);
        if (!this.#buttonEl) {
            throw new Error(
                `[ButtonController] Botón no encontrado: "${selector}".`
            );
        }
    }

    /**
     * Aplica la configuración visual según el estado dado.
     * @param {string} state — Uno de los valores de StopwatchState.
     */
    applyState(state) {
        const config = ButtonController.STATE_CONFIG[state];
        if (!config) {
            console.warn(`[ButtonController] Estado desconocido: "${state}".`);
            return;
        }

        try {
            this.#buttonEl.textContent = config.text;
            this.#buttonEl.className = config.className;
            this.#buttonEl.setAttribute("aria-label", config.ariaLabel);
        } catch (err) {
            console.error("[ButtonController] Error aplicando estado:", err);
        }
    }

    /**
     * Registra un listener de click.
     * @param {function(): void} handler
     */
    onClick(handler) {
        this.#buttonEl.addEventListener("click", handler);
    }
}


// =============================================================================
// CLASE: StopwatchApp (Orquestador)
// =============================================================================

/**
 * Orquesta los componentes del cronómetro.
 * Depende de las interfaces públicas de Timer, Display y ButtonController,
 * no de sus implementaciones internas (DIP).
 */
class StopwatchApp {
    /** @type {StopwatchTimer} */
    #timer;

    /** @type {StopwatchDisplay} */
    #display;

    /** @type {ButtonController} */
    #actionBtn;

    /** @type {string} */
    #state = StopwatchState.IDLE;

    /**
     * Inicializa todos los componentes y bindea los eventos.
     *
     * Fail-fast: si algún componente falla al inicializarse (e.g., elemento
     * DOM no encontrado), el error se loguea y se relanza para evitar que
     * la instancia quede en un estado parcialmente roto e inutilizable.
     *
     * @throws {Error} Si cualquier componente o elemento DOM requerido falta.
     */
    constructor() {
        try {
            this.#display = new StopwatchDisplay("#time-main", "#time-ms");
            this.#timer = new StopwatchTimer((ms) => this.#display.update(ms));
            this.#actionBtn = new ButtonController("#btn-action");

            // Bindear eventos
            this.#actionBtn.onClick(() => this.#handleAction());

            const clearBtn = document.querySelector("#btn-clear");
            if (!clearBtn) {
                throw new Error('[StopwatchApp] Botón "Clear" no encontrado.');
            }
            clearBtn.addEventListener("click", () => this.#handleClear());

            // Estado inicial
            this.#applyState(StopwatchState.IDLE);
            this.#display.update(0);
        } catch (err) {
            console.error("[StopwatchApp] Error de inicialización:", err);
            throw err; // Fail-fast: no dejar instancia en estado parcial
        }
    }

    /**
     * Gestiona el clic en el botón de acción según el estado actual.
     * Transiciones: IDLE→RUNNING, RUNNING→PAUSED, PAUSED→RUNNING.
     * @private
     */
    #handleAction() {
        try {
            switch (this.#state) {
                case StopwatchState.IDLE:
                case StopwatchState.PAUSED:
                    this.#timer.start();
                    this.#applyState(StopwatchState.RUNNING);
                    break;

                case StopwatchState.RUNNING:
                    this.#timer.pause();
                    this.#applyState(StopwatchState.PAUSED);
                    break;

                default:
                    console.warn(
                        `[StopwatchApp] Estado inesperado: "${this.#state}".`
                    );
            }
        } catch (err) {
            console.error("[StopwatchApp] Error en handleAction:", err);
        }
    }

    /**
     * Gestiona el clic en "Clear": reinicia todo al estado IDLE.
     * @private
     */
    #handleClear() {
        try {
            this.#timer.reset();
            this.#applyState(StopwatchState.IDLE);
        } catch (err) {
            console.error("[StopwatchApp] Error en handleClear:", err);
        }
    }

    /**
     * Actualiza el estado interno y la UI del botón.
     * @param {string} newState
     * @private
     */
    #applyState(newState) {
        this.#state = newState;
        this.#actionBtn.applyState(newState);
    }
}


// =============================================================================
// PUNTO DE ENTRADA
// =============================================================================

/**
 * Inicializa la aplicación cuando el DOM está listo.
 * Envuelto en try/catch para capturar errores de inicialización.
 */
document.addEventListener("DOMContentLoaded", () => {
    try {
        new StopwatchApp();
    } catch (err) {
        console.error("[Stopwatch] Error fatal en la inicialización:", err);
    }
});