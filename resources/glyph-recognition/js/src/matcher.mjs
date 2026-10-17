// Deterministic matching, refusal reasons and page coordinates; mirrors matcher.py.

import { similarityFromStats } from './color.mjs';

export const DEFAULT_THRESHOLDS = {
  detector_confidence: 0.25,
  identity_confidence: 0.0,
  orientation_confidence: 0.0,
  colour_similarity: 0.7,
  report_confidence: 0.0,
};

function slotMatches(object, slot, thresholds) {
  if ((object.detector_confidence ?? 1) < thresholds.detector_confidence) return false;
  if (slot.identity != null && object.identity !== slot.identity) return false;
  if (slot.orientation != null && object.orientation !== slot.orientation) return false;
  if (slot.color != null && object.color !== slot.color) return false;
  return true;
}

function summary(object) {
  return {
    id: object.id,
    bbox_xyxy: [...(object.bbox_xyxy || [])],
    identity: object.identity,
    orientation: object.orientation,
    color: object.color,
    detector_confidence: object.detector_confidence,
    identity_confidence: object.identity_confidence,
    orientation_confidence: object.orientation_confidence,
    color_score: object.color_score,
  };
}

function attributeSimilarity(attribute, reference, candidate) {
  if (attribute === 'orientation') {
    if (reference.orientation == null || candidate.orientation == null) return null;
    return reference.orientation === candidate.orientation ? 1 : 0;
  }
  if (!reference.color_stats || !candidate.color_stats) {
    if (reference.color == null || candidate.color == null) return null;
    return reference.color === candidate.color ? 1 : 0;
  }
  return similarityFromStats(reference.color_stats, candidate.color_stats);
}

function build(query, status, reason, objects, candidates, scored) {
  const payload = {
    schemaVersion: '1.0',
    status,
    objects: objects.map(summary),
    targetId: null,
    pointInImage: null,
    reason,
    query,
    candidates: candidates.map((object) => (object && object.id !== undefined ? object.id : object)),
  };
  if (scored) payload.candidateScores = scored.map(([object, score]) => ({ id: object.id, score }));
  return payload;
}

export function matchQuery(query, objects, thresholds = {}) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const usable = objects.filter((object) => (object.detector_confidence ?? 1) >= limits.detector_confidence);
  const reference = query.reference;
  let referenceObject = null;
  if (reference) {
    const referenceCandidates = usable.filter((object) => slotMatches(object, reference, limits));
    if (!referenceCandidates.length) return build(query, 'uncertain', 'reference_missing', objects, []);
    if (referenceCandidates.length > 1) return build(query, 'uncertain', 'reference_ambiguous', objects, referenceCandidates);
    referenceObject = referenceCandidates[0];
  }
  const candidates = usable.filter((object) => slotMatches(object, query.target || {}, limits));
  const scored = [];
  for (const object of candidates) {
    if ((object.identity_confidence ?? 1) < limits.identity_confidence) continue;
    const scores = [object.identity_confidence ?? 1];
    if (query.target && query.target.orientation != null) {
      if ((object.orientation_confidence ?? 1) < limits.orientation_confidence) continue;
      scores.push(object.orientation_confidence ?? 1);
    }
    let dropped = false;
    for (const attribute of query.match_attributes || []) {
      const similarity = attributeSimilarity(attribute, referenceObject || {}, object);
      if (similarity === null) return build(query, 'uncertain', `reference_${attribute}_unknown`, objects, candidates);
      if (attribute === 'color' && similarity < limits.colour_similarity) {
        dropped = true;
        break;
      }
      if (attribute === 'orientation' && similarity < 1) {
        dropped = true;
        break;
      }
      scores.push(similarity);
    }
    if (!dropped) scored.push([object, Math.min(...scores)]);
  }
  if (!scored.length) return build(query, 'uncertain', 'target_missing', objects, candidates);
  scored.sort((a, b) => b[1] - a[1]);
  if (scored.length > 1) return build(query, 'uncertain', 'target_ambiguous', objects, scored.map(([object]) => object), scored);
  const [[best, score]] = scored;
  if (score < limits.report_confidence) return build(query, 'uncertain', 'low_confidence', objects, [best], scored);
  const result = build(query, 'matched', null, objects, [best], scored);
  result.targetId = best.id;
  result.pointInImage = boxCenter(best.bbox_xyxy);
  return result;
}

export function boxCenter(box) {
  return { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
}

export function toPagePoint(point, naturalWidth, naturalHeight, rect) {
  if (!naturalWidth || !naturalHeight) throw new Error('natural image size must be positive');
  return {
    x: rect.x + (point.x * rect.width) / naturalWidth,
    y: rect.y + (point.y * rect.height) / naturalHeight,
  };
}
