// Library entry: image + instruction -> objects, target id, point and page coordinates.

import { backgroundColor, cropWithMargin } from './image-ops.mjs';
import { classifyColor, colorStats } from './color.mjs';
import { matchQuery, toPagePoint } from './matcher.mjs';
import { ParseError, parseInstruction } from './parser.mjs';
import { Detector, RoiClassifier } from './models.mjs';

export { Detector, RoiClassifier } from './models.mjs';
export { parseInstruction, ParseError } from './parser.mjs';
export { matchQuery, toPagePoint, boxCenter } from './matcher.mjs';
export { classifyColor, colorStats, PALETTE } from './color.mjs';
export { loadRgb, decodeRgb } from './image-loader.mjs';

export async function buildObjects(image, width, height, detector, classifier, background = null) {
  const detections = await detector.detect(image, width, height);
  const boxes = detections.map((detection) => detection.bbox_xyxy);
  const attributes = boxes.length ? await classifier.predict(image, width, height, boxes) : [];
  const base = background || backgroundColor(image, width, height);
  return detections.map((detection, index) => {
    const crop = cropWithMargin(image, width, height, detection.bbox_xyxy);
    const { label, score } = classifyColor(crop, base);
    const attribute = attributes[index];
    return {
      id: `o${index + 1}`,
      bbox_xyxy: detection.bbox_xyxy,
      detector_confidence: detection.detector_confidence,
      identity: attribute.identity,
      kind: attribute.kind,
      shape: attribute.shape,
      orientation: attribute.orientation,
      identity_confidence: attribute.identity_confidence,
      orientation_confidence: attribute.orientation_confidence,
      color: label,
      color_score: score,
      color_stats: colorStats(crop, base),
      top_k: attribute.top_k,
    };
  });
}

export async function recognize(image, width, height, instruction, detector, classifier, options = {}) {
  const objects = await buildObjects(image, width, height, detector, classifier, options.background || null);
  let query;
  try {
    query = parseInstruction(instruction);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    return {
      schemaVersion: '1.0',
      status: error.status === 'unsupported_instruction' ? 'unsupported_instruction' : 'uncertain',
      objects: objects.map(({ color_stats, top_k, ...rest }) => rest),
      targetId: null,
      pointInImage: null,
      reason: error.reason,
      query: null,
      instruction,
    };
  }
  const result = matchQuery(query, objects, options.thresholds || {});
  result.instruction = instruction;
  if (options.rect && result.pointInImage) {
    result.pagePoint = toPagePoint(result.pointInImage, width, height, options.rect);
  }
  return result;
}
