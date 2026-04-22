const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const isDev = process.env.NODE_ENV !== 'production';

class PromptRegistry {
    constructor() {
        this._cache = new Map();
        this._watchers = [];
        this._compiled = new Map();
    }

    init() {
        this._loadAll();
        if (isDev) this._watch();
    }

    _loadAll() {
        const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.txt'));
        for (const file of files) {
            const name = path.basename(file, '.txt');
            const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
            this._cache.set(name, content);
        }
        console.log(`[Prompts] Loaded ${this._cache.size} templates`);
    }

    _compile(tpl) {
        return (vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
    }

    get(name) {
        return this._cache.get(name) || '';
    }

    render(name, vars = {}) {
        let compiled = this._compiled.get(name);
        if (!compiled) {
            const tpl = this.get(name);
            if (!tpl) return '';
            compiled = this._compile(tpl);
            this._compiled.set(name, compiled);
        }
        return compiled(vars);
    }

    compose(names, vars = {}) {
        return names.map(n => this.render(n, vars)).join('\n\n');
    }

    _watch() {
        let debounce = null;
        fs.watch(TEMPLATES_DIR, { recursive: false }, (eventType, filename) => {
            if (!filename || !filename.endsWith('.txt')) return;
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const name = path.basename(filename, '.txt');
                try {
                    const content = fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf-8');
                    this._cache.set(name, content);
                    console.log(`[Prompts] Reloaded: ${name}`);
                } catch (e) {
                    console.warn(`[Prompts] Failed to reload ${name}:`, e.message);
                }
            }, 100);
        });
    }
}

module.exports = new PromptRegistry();
