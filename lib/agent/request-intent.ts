/** Only self-contained copy edits bypass the operating workflow. */
export function isDirectCopyRewrite(text: string): boolean {
  if (/https?:\/\//i.test(text)) return false;
  const rewrite = /改写|润色|重写|rewrite|rephrase|polish/i.exec(text);
  if (!rewrite) return false;
  // Separate instructions from supplied prose so a story about publishing is
  // not confused with a request to publish it. Prefer an explicit source label.
  const source = /(?:原文|源文|source text|original text)\s*[:：]/i.exec(text);
  const separator = source
    ? source.index + source[0].length
    : text.slice(rewrite.index).search(/[:：\n]/) + rewrite.index + 1;
  if (separator <= rewrite.index || text.slice(separator).trim().length < 12) return false;
  const instructions = text.slice(0, separator)
    .replace(/(?:不需要|不要|无需|不用|不必)\s*(?:再|进行|自动)?\s*(?:调研|搜索|查证|核实|发布|排期|配图|封面|故事板|工作流|保存|存入|导出)/g, "")
    .replace(/(?:do not|don't|no need to)\s+(?:research|search|verify|publish|schedule|save|export)/gi, "");
  if (/(?:然后|并且|并|再|帮我|please|then)\s*(?:发布|排期|保存|存入|导出|publish|schedule|save|export)/i.test(text.slice(separator))) return false;
  return !/(?:调研|搜索|查证|核实|发布|排期|配图|封面|故事板|保存|存入|导出|整套|一站式|工作流|research|search|verify|publish|schedule|save|export|campaign|storyboard)/i.test(instructions);
}
