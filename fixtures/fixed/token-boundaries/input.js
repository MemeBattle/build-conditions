import { isBuildConditions, switchBuildCondition } from '@memebattle/build-conditions';
import * as ns from '@memebattle/build-conditions';
import { value, other } from './values';

export const found = isBuildConditions('desktop')in table;
export const typed = typeof(0, ns.isBuildConditions)('mobile');
export const inst = switchBuildCondition({ desktop: value, mobile: other })instanceof Object;
export const kind = typeof(0, ns.switchBuildCondition)({ desktop: value, mobile: other });
export const flags = switchBuildCondition({ desktop: /x/, mobile: other })in table;
