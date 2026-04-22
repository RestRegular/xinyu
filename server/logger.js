const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function formatTime() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatMsg(level, module, msg, meta) {
    const ts = formatTime();
    const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${module}]`;
    if (meta) {
        return `${prefix} ${msg} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
    }
    return `${prefix} ${msg}`;
}

class Logger {
    constructor(module = 'app') {
        this.module = module;
    }

    _log(level, msg, meta) {
        if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;
        const formatted = formatMsg(level, this.module, msg, meta);
        if (level === 'error') console.error(formatted);
        else if (level === 'warn') console.warn(formatted);
        else console.log(formatted);
    }

    debug(msg, meta) { this._log('debug', msg, meta); }
    info(msg, meta) { this._log('info', msg, meta); }
    warn(msg, meta) { this._log('warn', msg, meta); }
    error(msg, meta) { this._log('error', msg, meta); }

    child(subModule) {
        return new Logger(`${this.module}:${subModule}`);
    }

    timer() {
        const start = Date.now();
        const self = this;
        return {
            done(label = 'operation') {
                const ms = Date.now() - start;
                self.info(`${label} completed in ${ms}ms`);
                return ms;
            }
        };
    }
}

module.exports = new Logger('xinyu');
