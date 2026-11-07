import { switchBuildCondition } from '@memebattle/build-conditions';
import { fallback } from './fallback';

export const value = switchBuildCondition({
    desktop: switchBuildCondition({ desktop: () => 1, mobile: () => 2 }),
    mobile: fallback,
})();
