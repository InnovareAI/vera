declare module 'html2pdf.js' {
  // html2pdf.js ships no types; we use a thin chainable surface.
  type Html2Pdf = {
    set: (opt: Record<string, unknown>) => Html2Pdf
    from: (el: HTMLElement | string) => Html2Pdf
    save: () => Promise<void>
  }
  const html2pdf: () => Html2Pdf
  export default html2pdf
}
