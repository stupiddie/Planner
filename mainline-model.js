(function (root) {
  const model = {
    questions: ['如果目标完成了会怎么样？', '如果目标没有完成会有哪些后果？'],
    tag(name) { return `[主线-${name}]`; },
    validName(name, lines) { return Boolean(name && name.length <= 60 && !/[\[\]\r\n]/.test(name) && !lines.some(line => line.name === name)); },
    // The current draft overrides its archived date, so edits never create duplicate log entries.
    logs(lines, draft, name) {
      const plans = new Map(lines.map(plan => [plan.date, plan]));
      if (draft?.date) plans.set(draft.date, draft);
      return [...plans.values()].sort((a, b) => b.date.localeCompare(a.date)).flatMap(plan =>
        plan.groups.flatMap(group => group.tasks).filter(task => task.text.includes(model.tag(name)))
          .map(task => ({ date: plan.date, text: task.text, done: Boolean(task.done) })));
    },
    completion(text, caret) {
      // Accept both a caret inside [] and just after its closing bracket.
      const endCaret = text[caret - 1] === ']' ? caret - 1 : caret;
      const start = text.lastIndexOf('[', endCaret - 1);
      if (start < 0) return null;
      const close = text.indexOf(']', start);
      if (close >= 0 && close < endCaret) return null;
      const end = close < 0 ? endCaret : close + 1;
      const value = text.slice(start + 1, close < 0 ? endCaret : close);
      if (/[\[\]\n]/.test(value)) return null;
      if (value === '' || value === '主' || value === '主线') return { start, end, stage: 'kind', query: '' };
      if (value.startsWith('主线-')) return { start, end, stage: 'name', query: value.slice(3) };
      return null;
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.MainlineModel = model;
})(typeof window === 'undefined' ? globalThis : window);
