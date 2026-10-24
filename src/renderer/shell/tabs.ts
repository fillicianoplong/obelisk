export interface PageTab {
  id: string;
  title: string;
  text: string;
}

export function untitledTitle(number: number): string {
  return `Untitled ${number}`;
}

export function createTab(number: number): PageTab {
  return {
    id: `untitled-${number}`,
    title: untitledTitle(number),
    text: '',
  };
}
