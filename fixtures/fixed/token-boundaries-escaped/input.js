import { switchBuildCondition } from '@memebattle/build-conditions';
import { a, b, obj, table } from './values';

export const kind = typeof(0, switchBuildCondition)({ desktop: \u0061, mobile: {} });
export const braced = typeof(0, switchBuildCondition)({ desktop: \u{61}, mobile: b });
export const found = switchBuildCondition({ desktop: \u{61}, mobile: b })in obj;
export const plain = switchBuildCondition({ desktop: \u0061, mobile: b })in table;
export const astral = typeof(0, switchBuildCondition)({ desktop: 𝑥, mobile: b });
export const astralRight = switchBuildCondition({ desktop: 𝑥, mobile: b })in table;
export const object = switchBuildCondition({ desktop: {}, mobile: b })in table;
