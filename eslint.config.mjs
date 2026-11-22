import globals from 'globals';

export default [
  {
    files: ['js/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        // Межфайловые глобалы страниц (inline-скрипты и общие модули).
        OGEProgress: 'readonly',
        NayanovaProgress: 'readonly',
        NayanovaTrack: 'readonly',
        ym: 'readonly',
        trackHint: 'readonly',
        trackTaskStart: 'readonly',
        trackTaskComplete: 'readonly',
        trackSolution: 'readonly',
        runCode: 'readonly'
      }
    },
    rules: {
      // Ловит класс ошибок с необъявленной localDone в progress-sync.
      // Остальные правила пока не включаем: в старом коде много шума.
      'no-undef': 'error'
    }
  }
];
