// The six rows of the SRS formula reference. The LaTeX is the text in that table.

export interface FormulaSample {
  id: string;
  name: string;
  latex: string;
  file: string;
}

export const samples: readonly FormulaSample[] = [
  { id: 'fraction', name: 'Fraction', latex: '\\frac{a+b}{c}', file: 'fraction.docx' },
  { id: 'root-and-power', name: 'Root and power', latex: '\\sqrt{x^2+y^2}', file: 'root-and-power.docx' },
  { id: 'sum', name: 'Sum', latex: '\\sum_{i=1}^{n} i^2', file: 'sum.docx' },
  { id: 'integral', name: 'Integral', latex: '\\int_0^1 x\\,dx', file: 'integral.docx' },
  {
    id: 'matrix',
    name: 'Matrix',
    latex: '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}',
    file: 'matrix.docx',
  },
  {
    id: 'greek-and-accents',
    name: 'Greek and accents',
    latex: '\\hat{\\theta} = \\alpha + \\beta',
    file: 'greek-and-accents.docx',
  },
];

export const allSamplesFile = 'all-samples.docx';

// The fraction inserted as the raw fromXmlString() return value, so the wrapper is visible.
export const naiveFile = 'naive-fromxmlstring.docx';
