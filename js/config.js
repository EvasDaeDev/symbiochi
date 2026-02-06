export const APPENDAGE_MAX_BODY_MULT = 2;

export function getMaxAppendageLen(bodyLen){
  return Math.max(0, (bodyLen || 0) * APPENDAGE_MAX_BODY_MULT);
}
