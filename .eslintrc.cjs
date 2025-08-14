/*module.exports = {
  // Specifica che questo è il parser che ESLint deve usare.
  // `@typescript-eslint/parser` permette a ESLint di capire la sintassi di TypeScript.
  parser: '@typescript-eslint/parser',

  // Opzioni specifiche per il parser.
  parserOptions: {
    ecmaVersion: 2020, // Permette di usare le feature moderne di ECMAScript
    sourceType: 'module', // Permette l'uso di 'import'
    // Questa opzione è importante per le regole che richiedono informazioni sui tipi.
    // Dice al parser dove trovare la configurazione di TypeScript.
    project: './tsconfig.json',
  },

  // I plugin che ESLint deve usare.
  // `@typescript-eslint` contiene tutte le regole specifiche per TypeScript.
  plugins: ['@typescript-eslint'],

  // Estende delle configurazioni predefinite. Questo è il modo più semplice per iniziare.
  extends: [
    // Regole di base raccomandate da ESLint
    'eslint:recommended',
    
    // Regole raccomandate dal plugin TypeScript-ESLint.
    // Disabilita le regole di base di ESLint che sono in conflitto con TypeScript.
    'plugin:@typescript-eslint/recommended',

    // (Opzionale, ma consigliato) Aggiunge regole più strette che usano le informazioni sui tipi.
    // Richiede l'opzione `project` in `parserOptions`.
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],

  // Specifica che questo è il file di configurazione principale.
  // ESLint smetterà di cercare file di configurazione nelle cartelle superiori.
  root: true,

  // Qui puoi personalizzare o sovrascrivere le regole.
  // 'off' = disattivata, 'warn' = avviso, 'error' = errore (interrompe la build in CI)
  rules: {
    // Esempio: Rende un errore l'uso di variabili dichiarate ma non usate.
    '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],

    // Esempio: Permette l'uso di `require` (utile in alcuni file di configurazione Node.js).
    '@typescript-eslint/no-var-requires': 'off',

    // Esempio: Rende un errore l'uso di `any` come tipo.
    // Puoi disattivarlo se stai iniziando e hai molto codice legacy.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};*/