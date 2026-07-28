export const buildConfig = Object.freeze({
  outputDirectory: 'dist/fushenglu',
  files: Object.freeze([
    'manifest.json',
    'README.md',
    'src/index.js',
    'src/style.css',
    'src/core/chat-state.js',
    'src/core/character-state.js',
    'src/core/analysis-schema.js',
    'src/core/api-client.js',
    'src/core/turn-sync.js',
    'src/integrations/tauritavern.js',
    'src/ui/app.js',
  ]),
});

export default buildConfig;
