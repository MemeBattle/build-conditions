import { switchBuildCondition } from '@memebattle/build-conditions';
import { obj, Alpha, Beta, Gamma, left, right, other } from './values';

for (let fn = switchBuildCondition({ desktop: 'a' in obj ? Alpha : Beta, mobile: Gamma }); fn; ) break;

let target;
for (target = switchBuildCondition({ desktop: 'a' in left, mobile: other });;) break;

for (const getter = () => switchBuildCondition({ desktop: 'a' in right, mobile: other });;) break;

for (var arrow = switchBuildCondition({ desktop: () => 'x' in obj, mobile: other }); arrow;) break;

for (let safe = switchBuildCondition({ desktop: ['a' in obj], mobile: other }); safe;) break;
