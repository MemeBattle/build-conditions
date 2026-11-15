import { switchBuildCondition } from '@memebattle/build-conditions';
import { fallback } from './fallback';

switchBuildCondition({ desktop: { run() {} }.run, mobile: fallback })();
switchBuildCondition({ desktop: function () { return () => 1; }(), mobile: fallback })();
switchBuildCondition({ desktop: class {}.name, mobile: fallback }).trim();
export const arrow = () => switchBuildCondition({ desktop: { a: 1 }.a, mobile: fallback });
export default switchBuildCondition({ desktop: function named() {}.name, mobile: fallback });
