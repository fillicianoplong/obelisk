import { DOMParser } from '@xmldom/xmldom';
import katex from 'katex';
import { mml2omml } from 'mathml2omml';

export interface ConvertedFormula {
  latex: string;
  displayMode: boolean;
  mathml: string;
  omml: string;
  warnings: string[];
  sameWithDisableDecode: boolean;
}

export function renderMathMl(latex: string, displayMode: boolean): string {
  const html = katex.renderToString(latex, {
    throwOnError: true,
    trust: false,
    displayMode,
    maxSize: 50,
    maxExpand: 1000,
    macros: {},
    strict: (code) => (code === 'htmlExtension' ? 'error' : 'ignore'),
    output: 'mathml',
  });
  const start = html.indexOf('<math');
  const end = html.lastIndexOf('</math>');
  if (start < 0 || end < start) {
    throw new Error(`KaTeX did not return a math element for ${latex}`);
  }
  return html.slice(start, end + '</math>'.length);
}

export function convertFormula(latex: string, displayMode: boolean): ConvertedFormula {
  const mathml = renderMathMl(latex, displayMode);
  const warnings: string[] = [];
  const previous = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };
  let omml: string;
  try {
    omml = mml2omml(mathml);
  } finally {
    console.warn = previous;
  }
  console.warn = () => {};
  let disabled: string;
  try {
    disabled = mml2omml(mathml, { disableDecode: true });
  } finally {
    console.warn = previous;
  }
  return { latex, displayMode, mathml, omml, warnings, sameWithDisableDecode: omml === disabled };
}

export interface LessThanProbe {
  defaultOmml: string;
  disabledDecodeOmml: string;
  defaultWellFormed: boolean;
  disabledDecodeWellFormed: boolean;
  defaultError: string | null;
}

// Not an SRS sample. mathml2omml's default decode turns &lt; back into < inside m:t.
export function probeLessThan(): LessThanProbe {
  const mathml =
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi><mo>&lt;</mo><mn>0</mn></math>';
  const previous = console.warn;
  console.warn = () => {};
  let defaultOmml: string;
  let disabledDecodeOmml: string;
  try {
    defaultOmml = mml2omml(mathml);
    disabledDecodeOmml = mml2omml(mathml, { disableDecode: true });
  } finally {
    console.warn = previous;
  }
  const defaultParse = parseProbe(defaultOmml);
  const disabledParse = parseProbe(disabledDecodeOmml);
  return {
    defaultOmml,
    disabledDecodeOmml,
    defaultWellFormed: defaultParse.ok,
    disabledDecodeWellFormed: disabledParse.ok,
    defaultError: defaultParse.error,
  };
}

function parseProbe(xml: string): { ok: boolean; error: string | null } {
  const errors: string[] = [];
  const parser = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (message: unknown) => {
        errors.push(String(message));
      },
      fatalError: (message: unknown) => {
        errors.push(String(message));
      },
    },
  });
  parser.parseFromString(xml, 'text/xml');
  return { ok: errors.length === 0, error: errors[0] ?? null };
}
