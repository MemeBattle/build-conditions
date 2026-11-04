import { switchBuildCondition } from '@memebattle/build-conditions';
import { b } from './b';
export const x = switchBuildCondition({
    mobile: b,
});
