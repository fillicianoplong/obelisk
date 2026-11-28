/** LaTeX samples from the SRS Equation reference. */
export const FORMULA_REFERENCE_SAMPLES: ReadonlyArray<{ readonly id: string; readonly latex: string }> = [
  { id: 'fraction', latex: '\\frac{a+b}{c}' },
  { id: 'root', latex: '\\sqrt{x^2+y^2}' },
  { id: 'sum', latex: '\\sum_{i=1}^{n} i^2' },
  { id: 'integral', latex: '\\int_0^1 x\\,dx' },
  { id: 'matrix', latex: '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}' },
  { id: 'greek', latex: '\\hat{\\theta} = \\alpha + \\beta' },
];