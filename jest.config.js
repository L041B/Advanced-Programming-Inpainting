/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Indica a Jest di usare il preset di ts-jest per trasformare i file .ts
  preset: "ts-jest",

  // Specifica l'ambiente di test. 'node' è essenziale per testare applicazioni backend.
  testEnvironment: "node",

  // Esegue questo file di setup prima di ogni suite di test.
  // Utile per configurare mock globali o altre impostazioni.
  setupFilesAfterEnv: ["./jest.setup.js"],

  // Pulisce automaticamente i mock tra ogni test per garantire l'isolamento.
  // Equivalente a chiamare jest.clearAllMocks() dopo ogni test.
  clearMocks: true,

  // Imposta una regola per risolvere i percorsi (se usi alias come @/src)
  // Questo riprende la struttura del tuo esempio.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
};