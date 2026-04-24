const registry = require('./registry');
const { getGenrePreset, GENRE_PRESETS } = require('./presets/genrePresets');
const { gameTools } = require('./tools/gameTools');

registry.init();

module.exports = {
    registry,
    getGenrePreset,
    GENRE_PRESETS,
    gameTools,
};
