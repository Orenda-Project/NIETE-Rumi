/**
 * The type Meta takes for a Form init value, by component, as its Flow JSON validator applies it
 * (Flow JSON 7.3). Meta's reference lists every TextInput init-value as a string, but its validator
 * rejected the /observe2 field form on 15 Oct 2026 with "Expected property 'p2_spoke' to be of type
 * 'number' but found 'string'" at the Form's init-values: a number TextInput takes a number.
 */
function metaInitType(component) {
  if (component.type === 'TextInput' && component['input-type'] === 'number') return 'number';
  if (component.type === 'CheckboxGroup') return 'array';
  if (component.type === 'OptIn') return 'boolean';
  return 'string'; // TextInput (text), TextArea, RadioButtonsGroup, Dropdown
}

// The JSON type of a value, as Meta names it.
function jsonType(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

function namedComponents(node, out = []) {
  if (Array.isArray(node)) node.forEach((c) => namedComponents(c, out));
  else if (node && typeof node === 'object') {
    if (node.name && node.type) out.push(node);
    for (const k of ['children', 'then', 'else']) if (Array.isArray(node[k])) namedComponents(node[k], out);
  }
  return out;
}

/**
 * Every init-values entry of every screen, checked against Meta's rule: it references a declared data
 * field, the field's type is the component's, an array holds strings, and the example has that type too.
 * @returns {string[]} one line per problem; [] when the Flow is sound
 */
function initValueProblems(flow) {
  const problems = [];
  for (const s of flow.screens) {
    const form = (s.layout.children || []).find((c) => c.type === 'Form');
    const init = form && form['init-values'];
    if (!init || typeof init !== 'object') continue;
    const comps = namedComponents(form.children);
    for (const [name, ref] of Object.entries(init)) {
      const comp = comps.find((c) => c.name === name);
      const key = (/^\$\{data\.([A-Za-z0-9_]+)\}$/.exec(String(ref)) || [])[1];
      const decl = key && (s.data || {})[key];
      if (!comp) { problems.push(`${s.id}.${name}: no component of that name`); continue; }
      if (!decl) { problems.push(`${s.id}.${name}: ${ref} is not declared in the screen's data`); continue; }
      const want = metaInitType(comp);
      const what = `${comp.type}${comp['input-type'] ? `/${comp['input-type']}` : ''}`;
      if (decl.type !== want) problems.push(`${s.id}.${name}: ${what} takes ${want}, data ${key} is ${decl.type}`);
      if (want === 'array' && !(decl.items && decl.items.type === 'string')) problems.push(`${s.id}.${name}: ${key} must hold strings`);
      if ('__example__' in decl && jsonType(decl.__example__) !== want) problems.push(`${s.id}.${name}: ${key}'s example is ${jsonType(decl.__example__)}, not ${want}`);
    }
  }
  return problems;
}

module.exports = { metaInitType, jsonType, namedComponents, initValueProblems };
