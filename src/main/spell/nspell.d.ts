declare module 'nspell' {
  interface Hunspell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): Hunspell;
  }

  function nspell(aff: Buffer | string, dic: Buffer | string): Hunspell;
  export default nspell;
}
