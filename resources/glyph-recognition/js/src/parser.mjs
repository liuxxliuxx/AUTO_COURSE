// Deterministic rule parser; mirrors parser.py and the frozen query schema.

import { COLOR_WORDS, UNSUPPORTED_COLOR_WORDS } from './color.mjs';

export const ORIENTATION_WORDS = { 正向: 'front', 侧向: 'side' };
export const CASE_WORDS = { 大写: 'upper', 小写: 'lower', 数字: 'digit' };
export const SHAPE_WORDS = { 圆柱: 'shape:cylinder', 立方体: 'shape:cube', 圆锥: 'shape:cone', 球: 'shape:sphere' };
export const FRONT_ONLY_IDENTITIES = new Set(['shape:cylinder', 'shape:cone', 'shape:sphere']);
export const UNSUPPORTED_COLORS = ['purple', 'black'];
const CHARACTERS = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split(''));
const SLOT = /^(红|黄|绿|青|蓝|紫|灰|黑|白)?色?(正向|侧向)?(大写|小写|数字)?(圆柱|立方体|圆锥|球|[A-Za-z0-9])?$/;

export class ParseError extends Error {
  constructor(status, reason, detail = '') {
    super(`${status}: ${reason}`);
    this.status = status;
    this.reason = reason;
    this.detail = detail;
  }
}

function clean(text) {
  return String(text).replace(/\u3000/g, ' ').replace(/\s+/g, '').replace(/圆柱体/g, '圆柱');
}

export function parseSlot(raw) {
  const text = String(raw).replace(/的/g, '').replace(/^[和与]+/, '').trim();
  if (!text) throw new ParseError('unsupported_instruction', 'empty_slot');
  const match = SLOT.exec(text);
  if (!match || !match[4]) throw new ParseError('unsupported_instruction', 'unrecognised_slot', text);
  const [, colorWord, orientationWord, caseWord, identityWord] = match;
  if (colorWord && UNSUPPORTED_COLOR_WORDS[colorWord]) {
    throw new ParseError('unsupported_instruction', 'colour_outside_palette', UNSUPPORTED_COLOR_WORDS[colorWord]);
  }
  const identity = SHAPE_WORDS[identityWord] || identityWord;
  const isShape = identity.startsWith('shape:');
  if (caseWord) {
    if (isShape) throw new ParseError('ambiguous_instruction', 'case_word_on_shape', text);
    const upper = identityWord === identityWord.toUpperCase() && /[A-Z]/.test(identityWord);
    const lower = identityWord === identityWord.toLowerCase() && /[a-z]/.test(identityWord);
    const digit = /^[0-9]$/.test(identityWord);
    if (caseWord === '大写' && !upper) throw new ParseError('ambiguous_instruction', 'case_word_contradicts_character', text);
    if (caseWord === '小写' && !lower) throw new ParseError('ambiguous_instruction', 'case_word_contradicts_character', text);
    if (caseWord === '数字' && !digit) throw new ParseError('ambiguous_instruction', 'case_word_contradicts_character', text);
  }
  return {
    identity,
    color: colorWord ? COLOR_WORDS[colorWord] : null,
    orientation: orientationWord ? ORIENTATION_WORDS[orientationWord] : null,
  };
}

export function validateQuery(query) {
  const target = query.target;
  if (!target || typeof target !== 'object') throw new ParseError('unsupported_instruction', 'missing_target');
  for (const name of ['target', 'reference']) {
    const slot = query[name];
    if (!slot) continue;
    const identity = slot.identity;
    if (!identity) throw new ParseError('ambiguous_instruction', `${name}_without_identity`);
    if (!identity.startsWith('shape:') && !CHARACTERS.has(identity)) throw new ParseError('unsupported_instruction', `${name}_unknown_character`, identity);
    if (identity.startsWith('shape:') && !['cube', 'cylinder', 'cone', 'sphere'].includes(identity.split(':')[1])) {
      throw new ParseError('unsupported_instruction', `${name}_unknown_shape`, identity);
    }
    if (UNSUPPORTED_COLORS.includes(slot.color)) throw new ParseError('unsupported_instruction', `${name}_colour_outside_palette`, slot.color);
    if (slot.orientation && !['front', 'side'].includes(slot.orientation)) throw new ParseError('unsupported_instruction', `${name}_unknown_orientation`);
  }
  const attributes = query.match_attributes || [];
  for (const attribute of attributes) {
    if (!['color', 'orientation'].includes(attribute)) throw new ParseError('unsupported_instruction', 'unknown_match_attribute', attribute);
  }
  if (attributes.length && !query.reference) throw new ParseError('ambiguous_instruction', 'match_attribute_without_reference');
  if (query.reference && !attributes.length) throw new ParseError('ambiguous_instruction', 'reference_without_match_attribute');
}

export function parseInstruction(instruction) {
  if (typeof instruction !== 'string' || !instruction.trim()) {
    throw new ParseError('unsupported_instruction', 'empty_instruction');
  }
  const text = clean(instruction);
  if (!text.startsWith('请点击')) throw new ParseError('unsupported_instruction', 'missing_prefix', text);
  const body = text.slice(3);
  if (!body) throw new ParseError('unsupported_instruction', 'empty_request', text);
  const reference = /^(.*?)(颜色|朝向)一样(?:的)?(.*)$/.exec(body);
  let query;
  if (reference) {
    const head = reference[1];
    const tail = reference[3];
    if (!head || !tail) throw new ParseError('ambiguous_instruction', 'incomplete_reference_form', text);
    query = {
      instruction,
      target: parseSlot(tail),
      reference: parseSlot(head),
      match_attributes: [reference[2] === '颜色' ? 'color' : 'orientation'],
    };
  } else {
    if (body.includes('一样') || body.includes('相同')) throw new ParseError('ambiguous_instruction', 'missing_match_attribute', text);
    query = { instruction, target: parseSlot(body), reference: null, match_attributes: [] };
  }
  validateQuery(query);
  return query;
}
