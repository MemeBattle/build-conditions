import { switchBuildCondition } from '@memebattle/build-conditions';
import { a } from './a';
import { b } from './b';
export const x = switchBuildCondition({ desktpo: a, mobile: b });
