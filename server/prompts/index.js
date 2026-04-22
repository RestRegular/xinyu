const registry = require('./registry');
const { getGenrePreset, GENRE_PRESETS } = require('./presets/genrePresets');
const { gameTools } = require('./tools/gameTools');
const { characterTools } = require('./tools/characterTools');

registry.init();

module.exports = {
    registry,
    getGenrePreset,
    GENRE_PRESETS,
    gameTools,
    characterTools,
};
